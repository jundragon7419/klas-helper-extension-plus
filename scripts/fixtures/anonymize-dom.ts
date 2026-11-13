// KLAS 화면 DOM 발췌에서 개인정보를 지운다.
//
// 원칙: 구조, 태그, class, id, 속성 이름은 그대로 두고 텍스트와 속성 값만 바꾼다.
// 텍스트는 낱말 단위로 본다. 날짜, 시각, 짧은 숫자, 기호, 짧은 영문 코드는 남기고
// 한글 낱말과 긴 숫자는 자리표시값(`텍스트N`)으로 바꾼다. 화면 이름표처럼 남겨야 할 한글 낱말은 keepText로 받는다.
// 결과에 학번, 한글, 전화번호, 이메일이 남으면 leaks에 담는다. leaks가 있으면 파일을 만들지 않는다.

import { STUDENT_NUMBER_PATTERN } from './anonymize.ts';

/** 발췌 파일 맨 앞의 정보 줄 표시. */
export const DOM_FIXTURE_TAG = 'klas-dom:v1';

/** 페이지 이름 규칙. 파일 이름이 `<페이지 이름>.html`이 된다. */
export const PAGE_NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** 자리표시값. 같은 원본은 같은 번호가 된다. */
export const PLACEHOLDER_PATTERN = /텍스트\d+/g;

/** 값을 그대로 남기는 속성. 구조를 찾는 데 쓰는 값이라 바꾸면 선택자가 맞지 않는다. 검사는 그대로 한다. */
export const KEEP_ATTRIBUTES = new Set([
  'class',
  'id',
  'name',
  'for',
  'type',
  'role',
  'colspan',
  'rowspan',
  'scope',
]);

const PHONE_PATTERN = /(?<!\d)0\d{1,2}[-. ]?\d{3,4}[-. ]?\d{4}(?!\d)/;
const EMAIL_PATTERN = /[\w.+-]+@[\w-]+\.[\w.-]+/;
const CONTACT_PATTERN = new RegExp(`${EMAIL_PATTERN.source}|${PHONE_PATTERN.source}`, 'g');
const HANGUL_WORD_PATTERN = /\p{Script=Hangul}+/u;

// 한글 낱말, 영문 낱말, 숫자, 그 밖의 글자, 공백과 기호
const TOKEN_PATTERN = /(\p{Script=Hangul}+)|([A-Za-z]+)|(\d+)|(\p{L}+)|([^\p{L}\d]+)/gu;

export interface DomFixtureInfo {
  page: string;
  /** 발췌한 화면 경로. 쿼리는 남기지 않는다. */
  path: string;
  selector: string;
  /** 수집한 날 (YYYY-MM-DD) */
  collectedOn: string;
  /** 남긴 한글 낱말(화면 이름표) */
  keepText: string[];
  /**
   * 실제 화면에서 모으지 않고 단위 테스트와 이슈에 적힌 구조로 직접 쓴 파일이면 true.
   * 실제 화면 발췌를 모으면 그 파일로 바꾼다.
   */
  handwritten?: boolean;
}

export interface DomAnonymizeResult {
  /** 익명화한 발췌 HTML(정보 줄 제외) */
  html: string;
  /** 결과에 남은 개인정보 형식. 비어 있어야 한다. */
  leaks: string[];
  /** 서로 다른 자리표시값 수. 원문은 콘솔에도 내지 않는다. */
  replacedCount: number;
}

class DomReplacer {
  private readonly table = new Map<string, string>();
  readonly originals = new Set<string>();

  get size(): number {
    return this.table.size;
  }

  constructor(private readonly keep: Set<string>) {}

  /**
   * 문자열 하나를 바꾼다. 이메일과 전화번호는 낱말로 나누면 영문과 짧은 숫자로 남으므로 통째로 먼저 바꾼다.
   * 나머지는 낱말 단위로 보고, 바꿀 낱말이 공백을 사이에 두고 이어지면 한 자리표시값으로 묶는다.
   */
  replace(text: string): string {
    let out = '';
    let last = 0;
    for (const m of text.matchAll(CONTACT_PATTERN)) {
      out += this.replaceWords(text.slice(last, m.index)) + this.placeholder(m[0]);
      last = (m.index ?? 0) + m[0].length;
    }
    return out + this.replaceWords(text.slice(last));
  }

  private replaceWords(text: string): string {
    const tokens = [...text.matchAll(TOKEN_PATTERN)].map((m) => ({
      text: m[0],
      replace: this.mustReplace(m),
    }));
    let out = '';
    let run: string[] = [];
    let gap = '';
    const flush = () => {
      if (run.length) out += this.placeholder(run.join(''));
      run = [];
    };
    for (const token of tokens) {
      if (token.replace) {
        if (run.length) run.push(gap);
        else out += gap;
        gap = '';
        run.push(token.text);
      } else if (run.length && /^\s+$/.test(token.text)) {
        gap += token.text;
      } else {
        flush();
        out += gap + token.text;
        gap = '';
      }
    }
    flush();
    return out + gap;
  }

  private mustReplace(m: RegExpMatchArray): boolean {
    const [, hangul, latin, digits, other] = m;
    if (hangul) {
      return !this.keep.has(hangul);
    }
    // 상태 코드(lesson, ON, Q 등)는 남긴다. 대소문자가 섞인 낱말은 이름일 수 있다.
    if (latin) return !/^([a-z]{2,10}|[A-Z]{1,3})$/.test(latin);
    // 연도, 월, 시각, 진도율 같은 짧은 숫자와 압축 날짜(8, 12자리)는 남긴다. 학번(10자리)은 바꾼다.
    if (digits) return !(digits.length <= 4 || digits.length === 8 || digits.length === 12);
    return Boolean(other);
  }

  private placeholder(original: string): string {
    let fake = this.table.get(original);
    if (fake === undefined) {
      fake = `텍스트${this.table.size + 1}`;
      this.table.set(original, fake);
    }
    this.originals.add(original);
    return fake;
  }
}

/**
 * 텍스트나 속성 값 하나에 남은 개인정보 형식의 종류를 찾는다. 자리표시값과 keepText 낱말은 빼고 본다.
 * 결과는 콘솔과 CI 기록에 나오므로 원문 값은 넣지 않는다.
 */
export function findValueLeaks(value: string, keep: Iterable<string>): string[] {
  const keepSet = new Set(keep);
  const rest = value
    .replace(PLACEHOLDER_PATTERN, ' ')
    .replace(/\p{Script=Hangul}+/gu, (word) => (keepSet.has(word) ? ' ' : word));
  const leaks: string[] = [];
  if (STUDENT_NUMBER_PATTERN.test(rest)) leaks.push('학번 형식');
  if (HANGUL_WORD_PATTERN.test(rest)) leaks.push('한글');
  if (PHONE_PATTERN.test(rest)) leaks.push('전화번호 형식');
  if (EMAIL_PATTERN.test(rest)) leaks.push('이메일 형식');
  return leaks;
}

/** template의 내용은 childNodes가 아니라 content에 있으므로 함께 돈다. */
function childrenOf(node: Node): Node[] {
  const children = [...node.childNodes];
  const content = (node as Partial<HTMLTemplateElement>).content;
  if (node.nodeType === 1 && content) children.push(...content.childNodes);
  return children;
}

/**
 * 요소 아래의 텍스트와 속성 값을 위치와 함께 모은다.
 * 위치는 태그 이름과 순서(`div > table:nth-child(2)`)로만 적는다. id나 class 값에도 개인정보가 남을 수 있어 쓰지 않는다.
 */
function values(node: Node, where: string, out: { value: string; where: string }[] = []) {
  if (node.nodeType === 3 || node.nodeType === 8) out.push({ value: node.nodeValue ?? '', where });
  if (node.nodeType === 1) {
    for (const attr of [...(node as Element).attributes]) {
      out.push({ value: attr.value, where: `${where} @${attr.name}` });
    }
  }
  let index = 0;
  for (const child of childrenOf(node)) {
    if (child.nodeType === 1) {
      index += 1;
      const tag = (child as Element).localName;
      values(child, where ? `${where} > ${tag}:nth-child(${index})` : tag, out);
    } else {
      values(child, where || '(최상위)', out);
    }
  }
  return out;
}

/**
 * 요소 아래에 남은 개인정보 형식을 찾는다. `종류 (위치)` 모양이고 원문 값은 넣지 않는다.
 * 같은 항목은 한 번만 적는다.
 */
export function findDomLeaks(root: Node, keep: Iterable<string>): string[] {
  const keepList = [...keep];
  return [
    ...new Set(
      values(root, '').flatMap(({ value, where }) =>
        findValueLeaks(value, keepList).map((kind) => `${kind} (${where})`),
      ),
    ),
  ];
}

/**
 * 정보 줄에 남은 개인정보 형식을 찾는다. 선택자와 경로는 사용자가 정한 값이라 익명화하지 않으므로 검사만 한다.
 * 남길 낱말은 한글이라 한글 검사는 하지 않지만 학번, 전화번호, 이메일 형식은 막는다.
 */
export function findInfoLeaks(info: DomFixtureInfo): string[] {
  const keep = info.keepText;
  const leaks: string[] = [];
  for (const [field, value] of [
    ['page', info.page],
    ['path', info.path],
    ['selector', info.selector],
    ['collectedOn', info.collectedOn],
    ...keep.map((word) => ['keepText', word] as const),
  ] as const) {
    for (const kind of findValueLeaks(value, keep)) leaks.push(`${kind} (정보 줄 ${field})`);
  }
  return [...new Set(leaks)];
}

function walk(node: Node, r: DomReplacer): void {
  for (const child of childrenOf(node)) {
    if (child.nodeType === 8) {
      child.parentNode?.removeChild(child);
    } else if (child.nodeType === 3) {
      child.nodeValue = r.replace(child.nodeValue ?? '');
    } else if (child.nodeType === 1) {
      const el = child as Element;
      // 스크립트에는 화면을 그리는 데이터(학번, 과목 코드)가 들어 있을 수 있어 내용을 비운다.
      if (el.localName === 'script' || el.localName === 'style') {
        el.textContent = '';
      } else {
        walk(el, r);
      }
      for (const attr of [...el.attributes]) {
        if (!KEEP_ATTRIBUTES.has(attr.name)) el.setAttribute(attr.name, r.replace(attr.value));
      }
    }
  }
}

/**
 * 요소를 복제해 익명화한다. 원본 화면은 바꾸지 않는다.
 * @param root 발췌할 요소
 * @param keepText 그대로 남길 한글 낱말(화면 이름표). 사람이나 과목 이름은 넣지 않는다.
 */
export function anonymizeDom(root: Element, keepText: string[] = []): DomAnonymizeResult {
  const r = new DomReplacer(new Set(keepText));
  const wrapper = root.ownerDocument.createElement('div');
  wrapper.appendChild(root.cloneNode(true));
  walk(wrapper, r);
  const html = wrapper.innerHTML;
  const leaks = findDomLeaks(wrapper, keepText);
  // 바꾼 원본이 다른 자리(속성 값 일부 등)에 그대로 남았는지도 본다.
  for (const original of r.originals) {
    if (original.trim().length >= 3 && html.includes(original)) {
      leaks.push('바꾼 원본 값이 다른 자리에 남음');
      break;
    }
  }
  return { html, leaks, replacedCount: r.size };
}

/** 정보 줄을 만든다. JSON 안의 `--`는 주석을 끝내지 않도록 이스케이프한다. */
export function formatDomFixture(info: DomFixtureInfo, html: string): string {
  const json = JSON.stringify(info).replace(/-(?=-)/g, '\\u002d');
  return `<!-- ${DOM_FIXTURE_TAG} ${json} -->\n${html.trim()}\n`;
}

/** 발췌 파일에서 정보 줄과 본문을 읽는다. 형식이 다르면 null. */
export function parseDomFixture(text: string): { info: DomFixtureInfo; html: string } | null {
  const match = new RegExp(`^<!-- ${DOM_FIXTURE_TAG} (\\{.*\\}) -->\\n`).exec(text);
  if (!match) return null;
  try {
    return {
      info: JSON.parse(match[1] ?? '') as DomFixtureInfo,
      html: text.slice(match[0].length),
    };
  } catch {
    return null;
  }
}
