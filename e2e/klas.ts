import type { BrowserContext, Route } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseDomFixture } from '../scripts/fixtures/anonymize-dom.ts';

// 가짜 KLAS. klas.kw.ac.kr로 가는 요청을 가로채 화면 요청에는 DOM fixture(tests/fixtures/klas/dom/),
// KLAS API 요청에는 API fixture(tests/fixtures/klas/2026-2.json)로 답한다. 로그인 없이 content script를 시험한다.

export const KLAS_ORIGIN = 'https://klas.kw.ac.kr';

/** 화면 경로 → DOM fixture 이름. 화면 테스트를 더하면 여기에 경로를 더한다. */
export const PAGES = {
  home: '/std/cmn/frame/Frame.do',
  onlineLectures: '/std/lis/evltn/OnlineCntntsStdPage.do',
  syllabusSearch: '/std/cps/atnlc/LectrePlanStdPage.do',
} as const;

const PAGE_FIXTURES: Record<string, string> = {
  [PAGES.home]: 'home',
  [PAGES.onlineLectures]: 'online-lectures',
  [PAGES.syllabusSearch]: 'syllabus-search',
};

/** KLAS API 경로(utils/klas/api.ts의 KLAS_PATHS와 같다)와 API fixture의 목록 이름 */
const LIST_PATHS: Record<string, 'online' | 'task' | 'project' | 'quiz'> = {
  '/std/lis/evltn/SelectOnlineCntntsStdList.do': 'online',
  '/std/lis/evltn/TaskStdList.do': 'task',
  '/std/lis/evltn/PrjctStdList.do': 'project',
  '/std/lis/evltn/AnytmQuizStdList.do': 'quiz',
};
const SEMESTERS_PATH = '/std/cmn/frame/YearhakgiAtnlcSbjectList.do';
const UPDATE_SESSION_PATH = '/usr/cmn/login/UpdateSession.do';
const SESSION_INFO_PATH = '/api/v1/session/info';

const DAY_MS = 86_400_000;

interface ApiFixture {
  collectedOn: string;
  subjects: unknown;
  lists: Record<string, Record<string, unknown[]>>;
}

/** DOM fixture 본문. 정보 줄은 뺀다. */
export function readDomFixture(name: string): string {
  const text = readFileSync(resolve('tests/fixtures/klas/dom', `${name}.html`), 'utf8');
  const parsed = parseDomFixture(text);
  if (!parsed) throw new Error(`${name}.html에 정보 줄이 없습니다.`);
  return parsed.html;
}

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

/**
 * 문자열 안의 KLAS 날짜를 days일 옮긴다. 형식은 docs/ARCHITECTURE.md의 날짜 형식 4종과 8자리 날짜다.
 * 시각은 그대로 두고 날짜만 옮기므로 한국 시각 기준 마감 시각이 유지된다.
 */
export function shiftDates(value: string, days: number): string {
  const move = (y: string, m: string, d: string) => {
    const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)) + days * DAY_MS);
    return [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()] as const;
  };
  return value
    .replace(/^(\d{4})-(\d{2})-(\d{2})(?=$|[ T])/, (_, y: string, m: string, d: string) => {
      const [yy, mm, dd] = move(y, m, d);
      return `${yy}-${pad(mm)}-${pad(dd)}`;
    })
    .replace(/^(\d{4})(\d{2})(\d{2})(?=$|\d{4}$)/, (_, y: string, m: string, d: string) => {
      const [yy, mm, dd] = move(y, m, d);
      return `${yy}${pad(mm)}${pad(dd)}`;
    });
}

function shiftAll(value: unknown, days: number): unknown {
  if (Array.isArray(value)) return value.map((item) => shiftAll(item, days));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, shiftAll(child, days)]),
    );
  }
  return typeof value === 'string' ? shiftDates(value, days) : value;
}

/**
 * API fixture를 읽고, 모은 날이 오늘이 되도록 모든 날짜를 같은 날 수만큼 옮긴다.
 * content script는 실제 현재 시각으로 남은 마감을 고르므로, 옮기지 않으면 시간이 지날수록 남은 마감이 사라진다.
 */
export function loadApiFixture(now = Date.now()): ApiFixture {
  const raw = JSON.parse(
    readFileSync(resolve('tests/fixtures/klas/2026-2.json'), 'utf8'),
  ) as ApiFixture;
  const kstToday = new Date(now + 9 * 3_600_000).toISOString().slice(0, 10);
  const days = Math.round((Date.parse(kstToday) - Date.parse(raw.collectedOn)) / DAY_MS);
  return { ...(shiftAll(raw, days) as ApiFixture), collectedOn: kstToday };
}

/** 가짜 KLAS 화면의 전체 HTML */
export function pageHtml(body: string): string {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>KLAS</title></head><body>${body}</body></html>`;
}

const json = (route: Route, body: unknown) =>
  route.fulfill({
    status: 200,
    contentType: 'application/json;charset=UTF-8',
    body: JSON.stringify(body),
  });

/**
 * 브라우저 context의 klas.kw.ac.kr 요청에 가짜 응답을 단다. 모르는 경로는 404로 답해 실제 서버로 나가지 않는다.
 * 반환값의 requests로 받은 요청 경로를 볼 수 있다.
 */
export async function mockKlas(context: BrowserContext): Promise<{ requests: string[] }> {
  const api = loadApiFixture();
  const requests: string[] = [];
  await context.route(`${KLAS_ORIGIN}/**`, async (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    requests.push(`${request.method()} ${pathname}`);

    const fixture = PAGE_FIXTURES[pathname];
    if (fixture) {
      return route.fulfill({
        status: 200,
        contentType: 'text/html;charset=UTF-8',
        body: pageHtml(readDomFixture(fixture)),
      });
    }
    if (pathname === SEMESTERS_PATH) return json(route, api.subjects);
    const list = LIST_PATHS[pathname];
    if (list) {
      const body = (request.postDataJSON() ?? {}) as { selectSubj?: string };
      return json(route, api.lists[body.selectSubj ?? '']?.[list] ?? []);
    }
    if (pathname === UPDATE_SESSION_PATH) return json(route, {});
    if (pathname === SESSION_INFO_PATH) return json(route, { remainingTime: 3600 });
    return route.fulfill({ status: 404, contentType: 'text/plain', body: 'not mocked' });
  });
  return { requests };
}
