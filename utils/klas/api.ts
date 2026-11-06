// KLAS 내부 API 조회. KLAS 탭의 content script에서 같은 출처로 요청한다.
// 경로와 본문은 docs/ARCHITECTURE.md의 "KLAS 내부 API"를 따른다.

import {
  checkOnlineRows,
  checkQuizRows,
  checkSemesters,
  checkTaskRows,
  type KlasOnlineRow,
  type KlasQuizRow,
  type KlasSemester,
  type KlasTaskRow,
  type SchemaResult,
} from './schema';

export const KLAS_ORIGIN = 'https://klas.kw.ac.kr';

export const KLAS_PATHS = {
  semesters: '/std/cmn/frame/YearhakgiAtnlcSbjectList.do',
  online: '/std/lis/evltn/SelectOnlineCntntsStdList.do',
  task: '/std/lis/evltn/TaskStdList.do',
  project: '/std/lis/evltn/PrjctStdList.do',
  quiz: '/std/lis/evltn/AnytmQuizStdList.do',
} as const;

/**
 * 실패 종류
 * - session: 로그인이 끊겨 로그인 페이지가 왔다.
 * - network: 요청이 실패했거나, 시간이 초과됐거나, HTTP 오류가 났다.
 * - not-json: 로그인 페이지도 JSON도 아닌 응답이 왔다.
 * - schema: JSON은 왔지만 쓰는 필드가 없거나 형식이 다르다. KLAS가 바뀌었을 가능성이 크다.
 */
export type KlasErrorKind = 'session' | 'network' | 'not-json' | 'schema';

export interface KlasError {
  kind: KlasErrorKind;
  /** 요청한 경로 */
  path: string;
  /** 사람이 읽을 설명. 화면에 그대로 보여 주지는 않는다. */
  message: string;
}

export type KlasResult<T> = { ok: true; data: T } | { ok: false; error: KlasError };

/** 이 모듈이 쓰는 fetch의 모양. 테스트에서 가짜 fetch를 넣기 쉽게 좁혀 둔다. */
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface KlasRequestOptions {
  /** 테스트에서 바꿔 넣는다. 기본은 전역 fetch */
  fetch?: FetchLike;
  /** 요청 제한 시간(ms) */
  timeoutMs?: number;
  /** 상대 경로를 붙일 출처. 기본은 KLAS */
  origin?: string;
}

const DEFAULT_TIMEOUT_MS = 15_000;

/** 로그인 페이지로 넘어간 응답인지 본다. KLAS는 세션이 끊겨도 HTTP 200과 로그인 페이지를 준다. */
function isLoginPage(response: Response): boolean {
  return /\/usr\/cmn\/login\//i.test(response.url);
}

function fail(kind: KlasErrorKind, path: string, message: string): KlasResult<never> {
  return { ok: false, error: { kind, path, message } };
}

/** KLAS API에 JSON 본문으로 POST하고, 응답을 JSON으로 읽는다. 응답 검사는 하지 않는다. */
export async function klasPost(
  path: string,
  body: unknown,
  options: KlasRequestOptions = {},
): Promise<KlasResult<unknown>> {
  const doFetch: FetchLike = options.fetch ?? ((url, init) => fetch(url, init));
  const url = new URL(path, options.origin ?? KLAS_ORIGIN).href;

  let response: Response;
  try {
    response = await doFetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch (error) {
    const reason = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    return fail('network', path, `요청 실패 (${reason})`);
  }

  if (isLoginPage(response)) return fail('session', path, '로그인 페이지로 이동됨');
  if (!response.ok) return fail('network', path, `HTTP ${response.status}`);

  const contentType = response.headers.get('content-type') ?? '';
  if (!/\bjson\b/i.test(contentType)) {
    return fail('not-json', path, `JSON이 아닌 응답 (${contentType || 'content-type 없음'})`);
  }

  try {
    return { ok: true, data: (await response.json()) as unknown };
  } catch {
    return fail('not-json', path, 'JSON을 읽을 수 없음');
  }
}

async function request<T>(
  path: string,
  body: unknown,
  check: (data: unknown) => SchemaResult<T>,
  options?: KlasRequestOptions,
): Promise<KlasResult<T>> {
  const response = await klasPost(path, body, options);
  if (!response.ok) return response;
  const checked = check(response.data);
  return checked.ok ? checked : fail('schema', path, checked.reason);
}

/** 과목 목록 API 등에 넘기는 과목 공통 본문 */
export interface SubjectQuery {
  /** 과목 코드 (KlasSubject.value) */
  subject: string;
  /** 학기 (KlasSemester.value, 예: "2026,2") */
  semester: string;
}

function subjectBody({ subject, semester }: SubjectQuery) {
  return { selectSubj: subject, selectYearhakgi: semester, selectChangeYn: 'Y' };
}

/** 학기별 수강 과목. 최근 학기가 먼저 온다. */
export function fetchSemesters(options?: KlasRequestOptions): Promise<KlasResult<KlasSemester[]>> {
  return request(KLAS_PATHS.semesters, {}, checkSemesters, options);
}

/** 온라인 강의 (강의와 퀴즈가 섞여 온다) */
export function fetchOnlineRows(
  query: SubjectQuery,
  options?: KlasRequestOptions,
): Promise<KlasResult<KlasOnlineRow[]>> {
  return request(KLAS_PATHS.online, subjectBody(query), checkOnlineRows, options);
}

/** 과제 */
export function fetchTasks(
  query: SubjectQuery,
  options?: KlasRequestOptions,
): Promise<KlasResult<KlasTaskRow[]>> {
  return request(KLAS_PATHS.task, subjectBody(query), (data) => checkTaskRows(data), options);
}

/** 팀 프로젝트 */
export function fetchProjects(
  query: SubjectQuery,
  options?: KlasRequestOptions,
): Promise<KlasResult<KlasTaskRow[]>> {
  return request(
    KLAS_PATHS.project,
    subjectBody(query),
    (data) => checkTaskRows(data, 'project'),
    options,
  );
}

/** 퀴즈 */
export function fetchQuizzes(
  query: SubjectQuery,
  options?: KlasRequestOptions,
): Promise<KlasResult<KlasQuizRow[]>> {
  return request(KLAS_PATHS.quiz, subjectBody(query), checkQuizRows, options);
}
