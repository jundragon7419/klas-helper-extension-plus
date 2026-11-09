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
  /** 세션 연장. GET이고 응답은 로그인 여부와 관계없이 `{}` */
  updateSession: '/usr/cmn/login/UpdateSession.do',
  /** 남은 세션 시간. GET. 세션을 연장하지 않는다. 로그인하지 않았으면 HTTP 500 */
  sessionInfo: '/api/v1/session/info',
} as const;

/**
 * 실패 종류
 * - session: 로그인이 끊겨 로그인 페이지가 왔다.
 * - network: 요청이 실패했거나, 시간이 초과됐거나, HTTP 오류가 났다.
 * - not-json: 로그인 페이지도 JSON도 아닌 응답이 왔다.
 * - schema: JSON은 왔지만 쓰는 필드가 없거나 형식이 다르다. KLAS가 바뀌었을 가능성이 크다.
 * - unexpected: 확장 코드에서 예외가 나서 조회가 중간에 멈췄다. 확장 버그다.
 */
export type KlasErrorKind = 'session' | 'network' | 'not-json' | 'schema' | 'unexpected';

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

/**
 * 로그인 페이지로 넘어간 응답인지 본다. KLAS는 세션이 끊기면 HTTP 200과 로그인 페이지(LoginForm.do)를 준다.
 * UpdateSession.do도 /usr/cmn/login/ 아래에 있으므로 경로 전체가 아니라 LoginForm.do로 판단한다.
 */
function isLoginPage(response: Response): boolean {
  return /\/usr\/cmn\/login\/LoginForm\.do/i.test(response.url);
}

function fail(kind: KlasErrorKind, path: string, message: string): KlasResult<never> {
  return { ok: false, error: { kind, path, message } };
}

/** KLAS API에 JSON 본문으로 POST하고, 응답을 JSON으로 읽는다. 응답 검사는 하지 않는다. */
export function klasPost(
  path: string,
  body: unknown,
  options: KlasRequestOptions = {},
): Promise<KlasResult<unknown>> {
  return klasRequest(path, { method: 'POST', body: JSON.stringify(body) }, options);
}

/** KLAS API에 GET으로 요청하고, 응답을 JSON으로 읽는다. 응답 검사는 하지 않는다. */
export function klasGet(
  path: string,
  options: KlasRequestOptions = {},
): Promise<KlasResult<unknown>> {
  return klasRequest(path, { method: 'GET' }, options);
}

async function klasRequest(
  path: string,
  request: { method: 'GET' | 'POST'; body?: string },
  options: KlasRequestOptions,
): Promise<KlasResult<unknown>> {
  const doFetch: FetchLike = options.fetch ?? ((url, init) => fetch(url, init));
  const url = new URL(path, options.origin ?? KLAS_ORIGIN).href;

  let response: Response;
  try {
    response = await doFetch(url, {
      ...request,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
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

/** 세션 연장 결과 */
export interface SessionStatus {
  /** 연장 뒤 남은 세션 시간(초). 남은 시간을 읽지 못했으면 null */
  remainingSeconds: number | null;
}

/**
 * 세션을 연장하고 로그인이 살아 있는지 확인한다. (docs/ARCHITECTURE.md "세션")
 *
 * 1. UpdateSession.do로 연장한다. 이 응답은 로그인 여부와 관계없이 `{}`라서 만료를 알 수 없다.
 * 2. session/info로 남은 시간을 읽는다. 세션을 연장하지 않는 요청이다.
 * 3. 2가 실패하면 과목 목록으로 확인한다. 로그인이 끊겼으면 로그인 페이지로 넘어가므로 session 실패가 된다.
 *    실패했을 때만 보내므로 평소에는 요청이 두 번이다.
 */
export async function extendSession(
  options?: KlasRequestOptions,
): Promise<KlasResult<SessionStatus>> {
  const update = await klasGet(KLAS_PATHS.updateSession, options);
  if (!update.ok) return update;

  const info = await klasGet(KLAS_PATHS.sessionInfo, options);
  if (info.ok) {
    const seconds = (info.data as { remainingTime?: unknown } | null)?.remainingTime;
    if (typeof seconds === 'number' && seconds > 0)
      return { ok: true, data: { remainingSeconds: seconds } };
  }

  const check = await fetchSemesters(options);
  return check.ok ? { ok: true, data: { remainingSeconds: null } } : check;
}
