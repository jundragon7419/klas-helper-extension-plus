// 디자인 토큰 미리보기. utils/ui/tokens.ts를 직접 읽으므로 값을 복사해 두지 않는다.
import {
  CONTRAST_PAIRS,
  contrastRatio,
  cssVar,
  resolvePair,
  TOKEN_GROUPS,
  tokenNotes,
  tokens,
  tokensToCss,
  type TokenGroup,
  type TokenSet,
} from '../../utils/ui/tokens';
import { validateTokenSet } from './save';

const DRAFT_KEY = 'khp-tokens-draft';
/** 파일에 저장된 값. 이름으로 찾을 수 있게 TokenSet으로 넓혀 둔다. */
const saved: TokenSet = tokens;

const $ = <T extends HTMLElement = HTMLElement>(id: string) => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id}가 없습니다`);
  return el as T;
};

const clone = (set: TokenSet): TokenSet => structuredClone(set);

function loadDraft(): TokenSet {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (raw) return validateTokenSet(JSON.parse(raw), saved);
  } catch {
    // 토큰 이름이 바뀌었거나 저장소를 쓸 수 없으면 파일 값으로 시작한다.
  }
  return clone(saved);
}

let draft = loadDraft();

function saveDraft() {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // 저장소를 쓸 수 없어도 페이지 안에서는 계속 고칠 수 있다.
  }
}

const isChanged = (group: TokenGroup, key: string) => draft[group][key] !== saved[group][key];

function changedCount(): number {
  let n = 0;
  for (const group of Object.keys(TOKEN_GROUPS) as TokenGroup[]) {
    for (const key of Object.keys(saved[group])) if (isChanged(group, key)) n++;
  }
  return n;
}

// ---------- 화면에 반영 ----------

const liveStyle = document.createElement('style');
document.head.append(liveStyle);

function escapeHtml(text: string): string {
  return text.replace(
    /[&<>"']/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] ?? ch,
  );
}

function badge(ratio: number, min: number): string {
  const ok = ratio >= min;
  return `<span class="pv-badge ${ok ? 'pass' : 'fail'}">${ratio.toFixed(2)}:1 ${ok ? '통과' : '미달'}</span>`;
}

function renderContrast() {
  const rows = CONTRAST_PAIRS.map((pair) => {
    const [fg, bg] = resolvePair(pair, draft);
    const bgName = pair.bg.startsWith('#') ? `KLAS ${pair.bg}` : pair.bg;
    return `<tr>
      <td>${escapeHtml(pair.use)}</td>
      <td><span class="pv-pair" style="color:${fg};background:${bg}">가나다 ABC 123</span></td>
      <td><code>${pair.fg}</code></td>
      <td><code>${escapeHtml(bgName)}</code></td>
      <td>${pair.min}:1</td>
      <td>${badge(contrastRatio(fg, bg), pair.min)}</td>
    </tr>`;
  }).join('');
  $('contrast').innerHTML = `<table>
    <thead><tr><th>쓰임새</th><th>견본</th><th>글자</th><th>바탕</th><th>기준</th><th>결과</th></tr></thead>
    <tbody>${rows}</tbody></table>`;
}

function refresh() {
  liveStyle.textContent = tokensToCss(draft, { selector: ':root', reset: false });
  $('css').textContent = tokensToCss(draft);
  renderContrast();
  const n = changedCount();
  $('changed').textContent = n === 0 ? '파일과 같음' : `파일과 다른 값 ${n}개`;
  $<HTMLButtonElement>('save').disabled = n === 0;
  $<HTMLButtonElement>('reset').disabled = n === 0;
  for (const dot of document.querySelectorAll<HTMLElement>('[data-dot]')) {
    const [group, key] = (dot.dataset.dot ?? '').split('|') as [TokenGroup, string];
    dot.hidden = !isChanged(group, key);
  }
}

function setValue(group: TokenGroup, key: string, value: string | number) {
  (draft[group] as Record<string, string | number>)[key] = value;
  saveDraft();
  refresh();
}

// ---------- 편집 칸 ----------

const changedDot = (group: TokenGroup, key: string) =>
  `<span class="pv-dot" data-dot="${group}|${key}" title="파일과 다른 값" hidden></span>`;

const noteOf = (group: TokenGroup, key: string) => tokenNotes[`${group}.${key}`] ?? '';

function nameCell(group: TokenGroup, key: string): string {
  const note = noteOf(group, key);
  return `<div class="pv-row-name">
    <code>${cssVar(group, key)}</code>
    ${note ? `<span class="pv-note">${escapeHtml(note)}</span>` : ''}
  </div>`;
}

function inputFor(group: TokenGroup, key: string): string {
  const value = draft[group][key];
  const id = `in-${group}-${key}`;
  const label = `aria-label="${cssVar(group, key)}"`;
  if (typeof value === 'number') {
    const step = group === 'lineHeight' ? '0.05' : '1';
    return `<span class="pv-edit"><input class="pv-input" type="number" id="${id}" step="${step}" min="0" value="${value}" data-group="${group}" data-key="${key}" ${label}>${TOKEN_GROUPS[group].unit}${changedDot(group, key)}</span>`;
  }
  return `<span class="pv-edit"><input class="pv-input pv-input-wide" type="text" id="${id}" value="${escapeHtml(value ?? '')}" data-group="${group}" data-key="${key}" ${label}>${changedDot(group, key)}</span>`;
}

function renderColors() {
  $('colors').innerHTML = Object.keys(saved.color)
    .map((key) => {
      const value = draft.color[key] ?? '';
      const name = cssVar('color', key);
      return `<div class="pv-swatch">
        <div class="pv-swatch-chip" style="background:var(${name})"></div>
        <div class="pv-swatch-meta">
          <code>${name}</code>
          <span class="pv-note">${escapeHtml(noteOf('color', key))}</span>
          <span class="pv-edit">
            <input class="pv-input" type="color" value="${value}" data-color="${key}" aria-label="${name} 색 고르기">
            <input class="pv-input pv-input-wide" type="text" value="${value}" data-hex="${key}" aria-label="${name} 값" spellcheck="false">
            ${changedDot('color', key)}
          </span>
        </div>
      </div>`;
    })
    .join('');
}

function rows(group: TokenGroup, preview: (key: string) => string): string {
  return `<h3 class="pv-subhead">${TOKEN_GROUPS[group].label}</h3><div class="pv-rows">${Object.keys(
    saved[group],
  )
    .map(
      (key) =>
        `<div class="pv-row">${nameCell(group, key)}<div>${inputFor(group, key)}</div><div>${preview(key)}</div></div>`,
    )
    .join('')}</div>`;
}

const sampleText = '3주차 연결 리스트 구현 · 오늘 (금) 23:59 · D-4';

function renderType() {
  $('type').innerHTML = [
    rows(
      'fontFamily',
      (key) => `<span style="font-family:var(${cssVar('fontFamily', key)})">${sampleText}</span>`,
    ),
    rows(
      'fontSize',
      (key) =>
        `<span style="font-family:var(--khp-font-family-base);font-size:var(${cssVar('fontSize', key)})">${sampleText}</span>`,
    ),
    rows(
      'fontWeight',
      (key) =>
        `<span style="font-family:var(--khp-font-family-base);font-weight:var(${cssVar('fontWeight', key)})">${sampleText}</span>`,
    ),
    rows(
      'lineHeight',
      (key) =>
        `<p style="margin:0;max-width:360px;font-family:var(--khp-font-family-base);font-size:var(--khp-font-size-sm);line-height:var(${cssVar('lineHeight', key)})">KLAS 응답 형식이 바뀐 것 같습니다. 퀴즈 마감은 KLAS에서 직접 확인해 주세요. 두 줄 이상일 때 줄 사이를 봅니다.</p>`,
    ),
  ].join('');
}

function renderMetrics() {
  const bar = (name: string) => `<div class="pv-bar" style="width:min(100%, var(${name}))"></div>`;
  $('metrics').innerHTML = [
    rows('space', (key) => bar(cssVar('space', key))),
    rows(
      'radius',
      (key) =>
        `<div style="width:64px;height:40px;border:2px solid #8c959f;border-radius:var(${cssVar('radius', key)})"></div>`,
    ),
    rows('size', (key) => bar(cssVar('size', key))),
  ].join('');
}

function renderEffects() {
  $('effects').innerHTML = [
    rows(
      'shadow',
      (key) =>
        `<div style="width:120px;height:48px;background:#fff;border-radius:6px;box-shadow:var(${cssVar('shadow', key)})"></div>`,
    ),
    rows('zIndex', () => ''),
    rows('duration', () => '<span class="pv-note">위 견본의 "열고 닫기 보기"로 확인</span>'),
    rows('easing', () => '<span class="pv-note">위 견본의 "열고 닫기 보기"로 확인</span>'),
  ].join('');
}

function renderEditors() {
  renderColors();
  renderType();
  renderMetrics();
  renderEffects();
}

// ---------- 입력 처리 ----------

const HEX = /^#[0-9a-f]{6}$/;

document.addEventListener('input', (event) => {
  const el = event.target;
  if (!(el instanceof HTMLInputElement)) return;
  const { group, key, color, hex } = el.dataset;

  if (color) {
    const text = document.querySelector<HTMLInputElement>(`[data-hex="${color}"]`);
    if (text) {
      text.value = el.value;
      text.classList.remove('is-invalid');
    }
    setValue('color', color, el.value.toLowerCase());
    return;
  }
  if (hex) {
    const value = el.value.trim().toLowerCase();
    const ok = HEX.test(value);
    el.classList.toggle('is-invalid', !ok);
    if (!ok) return;
    const picker = document.querySelector<HTMLInputElement>(`[data-color="${hex}"]`);
    if (picker) picker.value = value;
    setValue('color', hex, value);
    return;
  }
  if (group && key) {
    const g = group as TokenGroup;
    if (typeof saved[g][key] === 'number') {
      const n = el.valueAsNumber;
      el.classList.toggle('is-invalid', !Number.isFinite(n));
      if (Number.isFinite(n)) setValue(g, key, n);
    } else {
      setValue(g, key, el.value);
    }
  }
});

function showMessage(text: string, error = false) {
  const box = $('message');
  box.textContent = text;
  box.classList.toggle('is-error', error);
  box.hidden = false;
}

$('reset').addEventListener('click', () => {
  draft = clone(saved);
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {
    // 무시한다.
  }
  renderEditors();
  refresh();
  showMessage('파일 값으로 되돌렸습니다.');
});

$('save').addEventListener('click', () => {
  void (async () => {
    try {
      const res = await fetch('/__tokens/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      });
      const result = (await res.json()) as { ok: boolean; message: string };
      if (!result.ok) return showMessage(`저장하지 못했습니다: ${result.message}`, true);
      // 파일이 바뀌면 Vite가 페이지를 새로 불러온다. 그때 파일 값으로 시작하도록 임시 값을 지운다.
      localStorage.removeItem(DRAFT_KEY);
      showMessage(result.message);
    } catch (error) {
      showMessage(`저장하지 못했습니다: ${String(error)}`, true);
    }
  })();
});

$('motionPlay').addEventListener('click', () => {
  const panel = $('motionPanel');
  panel.classList.toggle('is-open');
});

renderEditors();
refresh();
