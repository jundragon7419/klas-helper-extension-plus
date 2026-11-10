// KLAS 응답 검사.
//
// 확장이 쓰는 필드만 확인하고 나머지는 무시한다. KLAS가 필드를 더하는 것은 괜찮고,
// 쓰는 필드가 없어지거나 형식이 바뀌면 "schema" 실패로 알린다.

import { parseSemester } from './semester';

/** 학기별 수강 과목 */
export interface KlasSemester {
  /** 예: "2026,2" */
  value: string;
  /** 예: "2026년도 2학기" */
  label: string;
  subjList: KlasSubject[];
}

export interface KlasSubject {
  /** 과목 코드. 다른 API의 selectSubj로 넘긴다. */
  value: string;
  label: string;
  name: string;
}

/** 온라인 강의 목록의 한 줄. 강의(`lesson`)와 퀴즈(`quiz`)가 섞여 온다. */
export interface KlasOnlineRow {
  evltnSe: string;
  sbjt: string;
  moduletitle: string;
  startDate: string;
  endDate: string;
  /** 강의(`lesson`)에만 있다. */
  isonoff?: string;
  /** 강의(`lesson`)에만 있다. 진도율(%) */
  prog?: number;
  /** 강의 콘텐츠 ID. 검사하지 않고, 항목을 구분하는 데만 쓴다. */
  oid?: unknown;
}

/** 과제와 팀 프로젝트 목록의 한 줄 */
export interface KlasTaskRow {
  title: string;
  startdate: string;
  expiredate: string;
  /** 추가 제출 기한. 없으면 null */
  reexpiredate: string | null;
  submityn: string;
  /** 과제 번호. 검사하지 않고, 항목을 구분하는 데만 쓴다. */
  taskNo?: unknown;
  /** 순번. 검사하지 않고, 항목을 구분하는 데만 쓴다. */
  ordseq?: unknown;
}

/** 퀴즈 목록의 한 줄 */
export interface KlasQuizRow {
  papernm: string;
  sdt: string;
  edt: string;
  issubmit: string;
  /** 퀴즈 번호. 검사하지 않고, 항목을 구분하는 데만 쓴다. */
  papernum?: unknown;
}

type Check = (value: unknown) => boolean;

const isString: Check = (value) => typeof value === 'string';
const isNumber: Check = (value) => typeof value === 'number' && Number.isFinite(value);
const isStringOrNull: Check = (value) => value === null || typeof value === 'string';

type Shape = Record<string, Check>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** 객체가 모양에 맞는지 본다. 맞지 않으면 무엇이 틀렸는지 문장으로 돌려준다. */
function describeMismatch(value: unknown, shape: Shape, where: string): string | null {
  if (!isRecord(value)) return `${where}: 객체가 아님`;
  for (const [field, check] of Object.entries(shape)) {
    if (!check(value[field])) {
      return `${where}.${field}: 형식이 다름 (${JSON.stringify(value[field]) ?? 'undefined'})`;
    }
  }
  return null;
}

/** 배열의 모든 항목을 검사한다. */
function describeRowsMismatch(
  rows: unknown,
  rowShape: (row: Record<string, unknown>) => Shape,
  name: string,
): string | null {
  if (!Array.isArray(rows)) return `${name}: 배열이 아님`;
  for (const [index, row] of rows.entries()) {
    const shape = isRecord(row) ? rowShape(row) : {};
    const mismatch = describeMismatch(row, shape, `${name}[${index}]`);
    if (mismatch) return mismatch;
  }
  return null;
}

const SUBJECT_SHAPE: Shape = { value: isString, label: isString, name: isString };
const SEMESTER_SHAPE: Shape = { value: isString, label: isString };
const ONLINE_SHAPE: Shape = {
  evltnSe: isString,
  sbjt: isString,
  moduletitle: isString,
  startDate: isString,
  endDate: isString,
};
const LESSON_SHAPE: Shape = { ...ONLINE_SHAPE, isonoff: isString, prog: isNumber };
const TASK_SHAPE: Shape = {
  title: isString,
  startdate: isString,
  expiredate: isString,
  reexpiredate: isStringOrNull,
  submityn: isString,
};
const QUIZ_SHAPE: Shape = { papernm: isString, sdt: isString, edt: isString, issubmit: isString };

/** 검사 결과. 실패하면 무엇이 틀렸는지 담는다. */
export type SchemaResult<T> = { ok: true; data: T } | { ok: false; reason: string };

function result<T>(data: unknown, mismatch: string | null): SchemaResult<T> {
  return mismatch === null ? { ok: true, data: data as T } : { ok: false, reason: mismatch };
}

export function checkSemesters(data: unknown): SchemaResult<KlasSemester[]> {
  let mismatch = describeRowsMismatch(data, () => SEMESTER_SHAPE, 'semesters');
  if (mismatch === null && Array.isArray(data)) {
    for (const [index, semester] of data.entries()) {
      const { value, subjList } = semester as KlasSemester;
      if (parseSemester(value) === null) {
        return { ok: false, reason: `semesters[${index}].value: 지원하지 않는 학기 코드` };
      }
      mismatch = describeRowsMismatch(
        subjList,
        () => SUBJECT_SHAPE,
        `semesters[${index}].subjList`,
      );
      if (mismatch) break;
    }
  }
  return result(data, mismatch);
}

export function checkOnlineRows(data: unknown): SchemaResult<KlasOnlineRow[]> {
  return result(
    data,
    describeRowsMismatch(
      data,
      (row) => (row.evltnSe === 'lesson' ? LESSON_SHAPE : ONLINE_SHAPE),
      'online',
    ),
  );
}

export function checkTaskRows(data: unknown, name = 'task'): SchemaResult<KlasTaskRow[]> {
  return result(
    data,
    describeRowsMismatch(data, () => TASK_SHAPE, name),
  );
}

export function checkQuizRows(data: unknown): SchemaResult<KlasQuizRow[]> {
  return result(
    data,
    describeRowsMismatch(data, () => QUIZ_SHAPE, 'quiz'),
  );
}
