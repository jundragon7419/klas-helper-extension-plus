// KLAS 응답에서 개인정보를 지운다.
//
// 원칙: 판단에 쓰는 값(날짜, 숫자, Y/N, 짧은 상태 코드)은 남기고,
// 사람이나 과목을 알아볼 수 있는 값은 가짜 값으로 바꾼다.
// 처음 보는 필드의 문자열도 안전한 형식이 아니면 바꾼다.

/** 같은 원본 값이 늘 같은 가짜 값이 되도록 바꾼다. 과목 코드처럼 여러 곳에 나오는 값의 연결을 유지한다. */
export const ID_FIELDS = new Set(['userId', 'grcode', 'subj', 'value', 'oid', 'selectSubj']);

/** 과목명이 들어 있는 필드. 같은 과목은 같은 이름이 되도록 한 표를 같이 쓴다. */
export const SUBJECT_NAME_FIELDS = new Set(['label', 'name', 'sbjt', 'sdesc']);

/** 사용자가 실제로 공부한 시각. 판단에 쓰지 않고 활동 기록이 드러나므로 고정값으로 바꾼다. */
export const ACTIVITY_TIME_FIELDS = new Set(['firstEdu', 'firstEnd', 'started']);
export const ACTIVITY_TIME_PLACEHOLDER = '2000-01-01 00:00';

/** 그대로 둬도 되는 값. 학기 표시는 개인정보가 아니고 학기 선택 규칙을 시험하는 데 필요하다. */
const KEEP_FIELD_PATTERNS: Record<string, RegExp> = {
  value: /^\d{4},\d$/,
  label: /^\d{4}년도 \d학기$/,
};

/** 판단에 쓰는 형식의 문자열. 이 형식이면 필드 이름과 관계없이 남긴다. */
const SAFE_STRING_PATTERNS: RegExp[] = [
  /^$/,
  /^[YN]$/,
  /^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}(:\d{2})?)?$/,
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?([+-]\d{2}:\d{2}|Z)$/,
  /^\d{1,4}$/,
  /^\d{8}$/,
  /^\d{12}$/,
  // 상태 코드: lesson, quiz, ON, OFF, Q, L 같은 짧은 영문
  /^[a-z]{2,10}$/,
  /^[A-Z]{1,3}$/,
];

/** 학번처럼 보이는 10자리 숫자. 결과에 남아 있으면 안 된다. */
export const STUDENT_NUMBER_PATTERN = /(?<!\d)(19|20)\d{8}(?!\d)/;

export interface AnonymizeResult<T> {
  data: T;
  /** 결과 JSON에 그대로 남아 있는 원본 값. 비어 있어야 한다. */
  leaks: string[];
}

class Replacer {
  private readonly ids = new Map<string, string>();
  private readonly subjects = new Map<string, string>();
  private readonly texts = new Map<string, string>();
  /** 바꾼 원본 값. 결과에 남았는지 검사하는 데 쓴다. */
  readonly originals = new Set<string>();

  id(original: string): string {
    return this.lookup(this.ids, original, (n) => fakeId(original, n));
  }

  subject(original: string): string {
    return this.lookup(this.subjects, original, (n) => `과목 ${n}`);
  }

  text(field: string, original: string): string {
    return this.lookup(this.texts, `${field}\u0000${original}`, (n) => `${field} ${n}`, original);
  }

  private lookup(
    table: Map<string, string>,
    key: string,
    make: (n: number) => string,
    original = key,
  ): string {
    let fake = table.get(key);
    if (fake === undefined) {
      fake = make(table.size + 1);
      table.set(key, fake);
    }
    this.originals.add(original);
    return fake;
  }
}

/** 원본과 길이가 같고, 숫자 자리는 숫자로, 나머지는 영문 대문자로 채운 가짜 ID. */
function fakeId(original: string, n: number): string {
  const serial = String(n);
  const chars = [...original];
  let out = '';
  for (let i = 0; i < chars.length; i += 1) {
    const fromEnd = chars.length - 1 - i;
    const digit = fromEnd < serial.length ? serial[serial.length - 1 - fromEnd] : '0';
    out += /\d/.test(chars[i] ?? '') ? digit : 'X';
  }
  return out;
}

function isSafeString(value: string): boolean {
  return SAFE_STRING_PATTERNS.some((pattern) => pattern.test(value));
}

function anonymizeValue(field: string, value: unknown, r: Replacer): unknown {
  if (Array.isArray(value)) return value.map((item) => anonymizeValue(field, item, r));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, anonymizeValue(key, child, r)]),
    );
  }
  if (typeof value !== 'string') return value;

  if (ACTIVITY_TIME_FIELDS.has(field)) return value === '' ? value : ACTIVITY_TIME_PLACEHOLDER;
  const keep = KEEP_FIELD_PATTERNS[field];
  if (keep?.test(value)) return value;
  if (ID_FIELDS.has(field)) return value === '' ? value : r.id(value);
  if (SUBJECT_NAME_FIELDS.has(field)) return value === '' ? value : r.subject(value);
  if (isSafeString(value)) return value;
  return r.text(field, value);
}

function collectStrings(value: unknown, out: string[]): string[] {
  if (Array.isArray(value)) value.forEach((item) => collectStrings(item, out));
  else if (value !== null && typeof value === 'object') {
    Object.values(value).forEach((child) => collectStrings(child, out));
  } else if (typeof value === 'string') out.push(value);
  return out;
}

/** 결과의 값(키 이름은 제외)에 원본 값이나 학번 형식이 남아 있는지 찾는다. */
export function findLeaks(output: unknown, originals: Iterable<string>): string[] {
  const text = collectStrings(output, []).join('\u0000');
  const leaks: string[] = [];
  for (const original of originals) {
    // 너무 짧은 값은 다른 값의 일부와 우연히 겹칠 수 있어 건너뛴다.
    if (original.length >= 3 && text.includes(original)) leaks.push(original);
  }
  const studentNumber = STUDENT_NUMBER_PATTERN.exec(text);
  if (studentNumber) leaks.push(`학번 형식: ${studentNumber[0]}`);
  return leaks;
}

export function anonymize<T>(data: T): AnonymizeResult<T> {
  const r = new Replacer();
  const result = anonymizeValue('', data, r) as T;
  return { data: result, leaks: findLeaks(result, r.originals) };
}
