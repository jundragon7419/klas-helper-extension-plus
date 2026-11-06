// 테스트에서 KLAS 응답을 흉내 내는 가짜 fetch

import { vi } from 'vitest';
import { KLAS_PATHS } from '@/utils/klas/api';
import fixture from '../fixtures/klas/2026-2.json';

type Kind = 'online' | 'task' | 'project' | 'quiz';
export const fixtureLists = fixture.lists as Record<string, Record<Kind, unknown[]>>;

/** fetch가 돌려줄 응답을 만든다. Response.url은 생성자로 정할 수 없어 따로 넣는다. */
export function respond(
  body: string,
  init: { status?: number; contentType?: string; url?: string } = {},
): Response {
  const response = new Response(body, {
    status: init.status ?? 200,
    headers: init.contentType === undefined ? {} : { 'content-type': init.contentType },
  });
  Object.defineProperty(response, 'url', { value: init.url ?? 'https://klas.kw.ac.kr/x.do' });
  return response;
}

export const json = (data: unknown) =>
  respond(JSON.stringify(data), { contentType: 'application/json;charset=UTF-8' });

export const LOGIN_URL = 'https://klas.kw.ac.kr/usr/cmn/login/LoginForm.do';

/** 로그인이 끊겼을 때의 응답 */
export const loginPage = () =>
  respond('<html></html>', { contentType: 'text/html', url: LOGIN_URL });

const KIND_BY_PATH: Record<string, Kind> = {
  [KLAS_PATHS.online]: 'online',
  [KLAS_PATHS.task]: 'task',
  [KLAS_PATHS.project]: 'project',
  [KLAS_PATHS.quiz]: 'quiz',
};

/**
 * 경로별로 tests/fixtures/klas/2026-2.json의 응답을 돌려주는 가짜 fetch.
 * override로 특정 경로의 응답을 바꿀 수 있다.
 */
export function fixtureFetch(override?: (path: string, subject?: string) => Response | undefined) {
  return vi.fn((url: string, init?: RequestInit) => {
    const path = new URL(url).pathname;
    const body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as {
      selectSubj?: string;
    };
    const custom = override?.(path, body.selectSubj);
    if (custom) return Promise.resolve(custom);
    if (path === KLAS_PATHS.semesters) return Promise.resolve(json(fixture.subjects));
    const kind = KIND_BY_PATH[path];
    const rows = kind && body.selectSubj ? fixtureLists[body.selectSubj]?.[kind] : undefined;
    return Promise.resolve(json(rows ?? []));
  });
}
