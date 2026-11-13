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
}

export interface DomAnonymizeResult {
  /** 익명화한 발췌 HTML(정보 줄 제외) */
  html: string;
  /** 결과에 남은 개인정보 형식. 비어 있어야 한다. */
  leaks: string[];
  /** 자리표시값으로 바꾼 한글 낱말. keepText 후보를 고를 때 콘솔에서 본다. 파일에 넣지 않는다. */
  replacedWords: string[];
}

class DomReplacer {
  private readonly table = new Map<string, string>();
  readonly originals = new Set<string>();
  readonly words = new Set<string>();

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
      if (this.keep.has(hangul)) return false;
      this.words.add(hangul);
      return true;
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

/** 텍스트나 속성 값 하나에 남은 개인정보 형식을 찾는다. 자리표시값과 keepText 낱말은 빼고 본다. */
export function findValueLeaks(value: string, keep: Iterable<string>): string[] {
  const keepSet = new Set(keep);
  const rest = value
    .replace(PLACEHOLDER_PATTERN, ' ')
    .replace(/\p{Script=Hangul}+/gu, (word) => (keepSet.has(word) ? ' ' : word));
  const leaks: string[] = [];
  const number = STUDENT_NUMBER_PATTERN.exec(rest);
  if (number) leaks.push(`학번 형식: ${number[0]}`);
  const hangul = HANGUL_WORD_PATTERN.exec(rest);
  if (hangul) leaks.push(`한글: ${hangul[0]}`);
  const phone = PHONE_PATTERN.exec(rest);
  if (phone) leaks.push(`전화번호 형식: ${phone[0]}`);
  const email = EMAIL_PATTERN.exec(rest);
  if (email) leaks.push(`이메일 형식: ${email[0]}`);
  return leaks;
}

/** 요소 아래의 텍스트와 속성 값을 모두 모은다. */
function values(node: Node, out: string[] = []): string[] {
  if (node.nodeType === 3) out.push(node.nodeValue ?? '');
  if (node.nodeType === 8) out.push(node.nodeValue ?? '');
  if (node.nodeType === 1) {
    for (const attr of [...(node as Element).attributes]) out.push(attr.value);
  }
  for (const child of [...node.childNodes]) values(child, out);
  return out;
}

/** 요소 아래에 남은 개인정보 형식을 찾는다. 같은 값은 한 번만 적는다. */
export function findDomLeaks(root: Node, keep: Iterable<string>): string[] {
  const keepList = [...keep];
  return [...new Set(values(root).flatMap((value) => findValueLeaks(value, keepList)))];
}

function walk(node: Node, r: DomReplacer): void {
  for (const child of [...node.childNodes]) {
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
    if (original.trim().length >= 3 && html.includes(original)) leaks.push(`원본 값: ${original}`);
  }
  return { html, leaks, replacedWords: [...r.words].filter((w) => !keepText.includes(w)) };
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
