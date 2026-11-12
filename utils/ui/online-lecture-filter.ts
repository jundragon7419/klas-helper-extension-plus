import { appendExtensionMarker } from './extension-marker';

const ROW_ATTR = 'data-khp-lecture';
const SPAN_ATTR = 'data-khp-rowspan';
const BAR_ATTR = 'data-khp-lecture-filter';
const RESET_SELECTS = new Set(['selectSubj', 'selectYearhakgi']);

/** 학습기간 칸의 `[53분, 100%]`처럼 진도율이 확실히 100%인 강의영상만 완료로 본다. */
const COMPLETE = /\[[^\]]*,\s*100(?:\.0+)?\s*%\s*\]/;

const isComplete = (row: Element): boolean =>
  [...row.querySelectorAll('font')].some((font) => COMPLETE.test(font.textContent ?? ''));

const bodyRows = (table: Element): Element[] =>
  [...table.querySelectorAll(':scope > tbody > tr')].filter(
    (row) => !row.querySelector(':scope > th'),
  );

function mark(element: Element, value: string | null): void {
  if (value === null) {
    if (element.hasAttribute(ROW_ATTR)) element.removeAttribute(ROW_ATTR);
  } else if (element.getAttribute(ROW_ATTR) !== value) element.setAttribute(ROW_ATTR, value);
}

interface Counts {
  total: number;
  hidden: number;
}

/**
 * 데스크톱 표. 주차의 첫 행이 rowspan 공통 칸(주차, 학습단원, 달성시간)을 갖는다.
 * 첫 행이 완료여도 행을 없애면 공통 칸이 사라지므로, 남는 행이 있으면 첫 행은 내용만 비우고 둔다.
 * rowspan은 보이는 행 수에 맞춘다. KLAS가 쓴 행과 칸은 옮기거나 지우지 않는다.
 */
function applyDesktop(table: Element, hide: boolean): Counts {
  const groups: Element[][] = [];
  for (const row of bodyRows(table)) {
    if (row.querySelector(':scope > td[rowspan]') || groups.length === 0) groups.push([row]);
    else groups[groups.length - 1]!.push(row);
  }
  const counts: Counts = { total: 0, hidden: 0 };
  for (const group of groups) {
    const done = group.map((row) => hide && isComplete(row));
    const allDone = done.every(Boolean);
    const common = [...group[0]!.querySelectorAll(':scope > td[rowspan]')];
    let visible = 0;
    group.forEach((row, index) => {
      counts.total += 1;
      let state: string | null = null;
      if (done[index]) {
        counts.hidden += 1;
        state = index === 0 && !allDone && common.length > 0 ? 'shell' : 'hidden';
      }
      if (state !== 'hidden') visible += 1;
      mark(row, state);
    });
    // 전부 숨기면 공통 칸도 함께 숨겨지므로 rowspan은 원래 값으로 둔다.
    const wanted = visible === 0 ? group.length : visible;
    const changed = wanted !== group.length;
    for (const cell of common) {
      if (!changed && !cell.hasAttribute(SPAN_ATTR)) continue;
      const value = String(wanted);
      if (cell.getAttribute('rowspan') !== value) cell.setAttribute('rowspan', value);
      if (changed) cell.setAttribute(SPAN_ATTR, '');
      else cell.removeAttribute(SPAN_ATTR);
    }
  }
  return counts;
}

/** 모바일 표. 주차마다 표 하나, 강의마다 두 행이다. 강의의 두 행을 함께 숨긴다. */
function applyMobile(table: Element, hide: boolean): Counts {
  const rows = bodyRows(table);
  const counts: Counts = { total: 0, hidden: 0 };
  for (let i = 0; i < rows.length; i += 2) {
    const pair = rows.slice(i, i + 2);
    counts.total += 1;
    const done = hide && pair.some(isComplete);
    if (done) counts.hidden += 1;
    for (const row of pair) mark(row, done ? 'hidden' : null);
  }
  // 모든 강의가 완료면 머리 행만 남지 않도록 주차 표 전체를 숨긴다.
  mark(table, hide && counts.total > 0 && counts.hidden === counts.total ? 'hidden' : null);
  return counts;
}

function statusText(hide: boolean, counts: Counts): string {
  if (!hide) return '';
  if (counts.hidden === 0) return '숨길 완료 강의가 없습니다.';
  if (counts.hidden === counts.total)
    return `완료한 강의 ${counts.hidden}개를 모두 숨겨 표시할 강의가 없습니다. 버튼을 누르면 다시 표시합니다.`;
  return `완료한 강의 ${counts.hidden}개를 숨겼습니다.`;
}

const sum = (list: Counts[]): Counts => ({
  total: list.reduce((n, c) => n + c.total, 0),
  hidden: list.reduce((n, c) => n + c.hidden, 0),
});

/**
 * 온라인 강의 목록에서 진도율 100%인 강의를 화면에서만 숨기고 다시 표시하는 버튼을 둔다.
 * 숨김 상태는 이 함수 안에만 있고 저장하지 않는다. 반환값으로 감시를 멈춘다.
 */
export function watchCompletedLectureFilter(root: Document): () => void {
  let hide = false;
  let status: HTMLElement | null = null;

  const createBar = (): HTMLElement => {
    const bar = root.createElement('div');
    bar.setAttribute(BAR_ATTR, '');
    bar.className = 'khp-lecture-filter';
    const button = root.createElement('button');
    button.type = 'button';
    button.className = 'khp-lecture-filter-button';
    button.append('완료한 강의 숨기기');
    appendExtensionMarker(button, 'light');
    button.addEventListener('click', () => {
      hide = !hide;
      render();
    });
    const text = root.createElement('span');
    text.className = 'khp-lecture-filter-status';
    text.setAttribute('role', 'status');
    bar.append(button, text);
    return bar;
  };

  const ensureBar = (anchor: Element | null): void => {
    const bars = [...root.querySelectorAll<HTMLElement>(`[${BAR_ATTR}]`)];
    const parent = anchor?.parentNode;
    if (!anchor || !parent) {
      for (const bar of bars) bar.remove();
      status = null;
      return;
    }
    const bar = bars.find((candidate) => candidate.nextElementSibling === anchor) ?? bars[0];
    for (const extra of bars) if (extra !== bar) extra.remove();
    const current = bar ?? createBar();
    if (current.nextElementSibling !== anchor) parent.insertBefore(current, anchor);
    status = current.querySelector<HTMLElement>('.khp-lecture-filter-status');
    const button = current.querySelector('button');
    if (button?.getAttribute('aria-pressed') !== String(hide))
      button?.setAttribute('aria-pressed', String(hide));
  };

  const render = () => {
    const desktop = [...root.querySelectorAll('.tablelistbox table')];
    const mobile = [...root.querySelectorAll('.mtablelistbox table')];
    ensureBar(root.querySelector('.tablelistbox') ?? root.querySelector('.mtablelistbox'));
    const desktopCounts = sum(desktop.map((table) => applyDesktop(table, hide)));
    const mobileCounts = sum(mobile.map((table) => applyMobile(table, hide)));
    // 두 표가 같은 강의를 함께 담으므로 보이는 쪽(데스크톱 우선)만 센다.
    const text = statusText(hide, desktop.length > 0 ? desktopCounts : mobileCounts);
    if (status && status.textContent !== text) status.textContent = text;
  };

  let scheduled = false;
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => {
      scheduled = false;
      render();
    }, 0);
  };

  // 과목이나 학기가 바뀌면 전체 표시로 돌아간다.
  const onChange = (event: Event) => {
    const target = event.target as Element | null;
    if (target?.tagName !== 'SELECT') return;
    if (!RESET_SELECTS.has(target.getAttribute('name') ?? '')) return;
    hide = false;
    schedule();
  };
  root.addEventListener('change', onChange, true);

  // 목록을 새로 받으면 KLAS가 같은 행을 다른 강의에 재사용하므로 매번 다시 판정한다.
  // 같은 결과면 아무것도 바꾸지 않으므로 이 감시가 반복되지 않는다.
  const observer = new MutationObserver(schedule);
  render();
  observer.observe(root.body, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['rowspan'],
  });
  return () => {
    observer.disconnect();
    root.removeEventListener('change', onChange, true);
    hide = false;
    render();
    for (const bar of root.querySelectorAll(`[${BAR_ATTR}]`)) bar.remove();
  };
}
