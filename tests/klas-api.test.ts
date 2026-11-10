import { describe, expect, it } from 'vitest';
import {
  fetchOnlineRows,
  fetchProjects,
  fetchQuizzes,
  fetchSemesters,
  fetchTasks,
  KLAS_PATHS,
  klasPost,
  type KlasResult,
} from '@/utils/klas/api';
import fixture from './fixtures/klas/2026-2.json';
import { fixtureFetch, json, respond } from './helpers/klas-fetch';

type Lists = Record<string, Record<'online' | 'task' | 'project' | 'quiz', unknown[]>>;
const lists = fixture.lists as Lists;
const semester = fixture.semester;
/** 네 종류 목록이 모두 들어 있는 과목을 고른다. */
const subjectWith = (kind: keyof Lists[string]) =>
  Object.keys(lists).find((code) => (lists[code]?.[kind].length ?? 0) > 0)!;

function expectError<T>(result: KlasResult<T>, kind: string) {
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error.kind).toBe(kind);
}

describe('KLAS API: 실제 응답 (tests/fixtures/klas/2026-2.json)', () => {
  const fetch = fixtureFetch();
  const options = { fetch };

  it('과목 목록', async () => {
    const result = await fetchSemesters(options);
    expect(result.ok && result.data[0]?.value).toBe('2026,2');
    expect(result.ok && result.data[0]?.subjList.length).toBe(6);
  });

  it('온라인 강의 (강의와 퀴즈가 섞인 목록)', async () => {
    const subject = subjectWith('online');
    const result = await fetchOnlineRows({ subject, semester }, options);
    expect(result.ok).toBe(true);
    const all = await Promise.all(
      Object.keys(lists).map((code) => fetchOnlineRows({ subject: code, semester }, options)),
    );
    const rows = all.flatMap((r) => (r.ok ? r.data : []));
    expect(rows).toHaveLength(21);
    expect(new Set(rows.map((r) => r.evltnSe))).toEqual(new Set(['lesson', 'quiz']));
  });

  it('과제', async () => {
    const result = await fetchTasks({ subject: subjectWith('task'), semester }, options);
    expect(result.ok && result.data.length).toBeGreaterThan(0);
  });

  it('팀 프로젝트', async () => {
    const result = await fetchProjects({ subject: subjectWith('project'), semester }, options);
    expect(result.ok && result.data[0]?.expiredate).toMatch(/T.*\+00:00$/);
  });

  it('퀴즈', async () => {
    const result = await fetchQuizzes({ subject: subjectWith('quiz'), semester }, options);
    expect(result.ok && result.data.length).toBe(2);
  });

  it('요청은 JSON 본문 POST이고 로그인 쿠키를 싣는다', async () => {
    fetch.mockClear();
    await fetchTasks({ subject: 'S1', semester: '2026,2' }, options);
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe(`https://klas.kw.ac.kr${KLAS_PATHS.task}`);
    expect(init?.method).toBe('POST');
    expect(init?.credentials).toBe('include');
    expect(init?.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(init?.body as string)).toEqual({
      selectSubj: 'S1',
      selectYearhakgi: '2026,2',
      selectChangeYn: 'Y',
    });
  });
});

describe('KLAS API: 실패 종류', () => {
  const run = (response: Response | Promise<never>) =>
    klasPost('/x.do', {}, { fetch: () => Promise.resolve(response) });

  it('session: 로그인 페이지로 이동한 응답 (실제 세션 만료 응답과 같은 모양)', async () => {
    const { sessionExpired } = fixture;
    const response = respond(sessionExpired.bodyStart, {
      contentType: sessionExpired.contentType,
      url: `https://klas.kw.ac.kr${sessionExpired.path}`,
    });
    expectError(await run(response), 'session');
  });

  it('network: 요청 자체가 실패', async () => {
    const result = await klasPost(
      '/x.do',
      {},
      { fetch: () => Promise.reject(new TypeError('Failed to fetch')) },
    );
    expectError(result, 'network');
  });

  it('network: 시간 초과', async () => {
    const hang = (_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason as Error));
      });
    const result = await klasPost('/x.do', {}, { fetch: hang, timeoutMs: 10 });
    expectError(result, 'network');
    expect(!result.ok && result.error.message).toMatch(/Timeout/);
  });

  it('network: HTTP 오류 (form 형식으로 보냈을 때의 500 등)', async () => {
    expectError(await run(respond('error', { status: 500, contentType: 'text/html' })), 'network');
  });

  it('not-json: 로그인 페이지도 JSON도 아님', async () => {
    expectError(
      await run(respond('<html>점검 중</html>', { contentType: 'text/html' })),
      'not-json',
    );
    expectError(await run(respond('ok')), 'not-json');
  });

  it('not-json: 응답 헤더의 원본 값은 진단에 포함하지 않는다', async () => {
    const result = await run(respond('ok', { contentType: 'text/plain; note=synthetic-private' }));
    expect(result).toMatchObject({
      ok: false,
      error: { kind: 'not-json', message: 'JSON이 아닌 응답' },
    });
    expect(JSON.stringify(result)).not.toContain('synthetic-private');
  });

  it('not-json: JSON이라면서 읽을 수 없음', async () => {
    expectError(await run(respond('{broken', { contentType: 'application/json' })), 'not-json');
  });

  describe('schema: 쓰는 필드가 없거나 형식이 다름', () => {
    const withData = (data: unknown) => ({ fetch: () => Promise.resolve(json(data)) });
    const query = { subject: 'S1', semester: '2026,2' };

    it('배열이 아님', async () => {
      expectError(await fetchTasks(query, withData({ list: [] })), 'schema');
    });

    it('과제 마감일이 없음', async () => {
      const row = { title: 't', startdate: 's', reexpiredate: null, submityn: 'N' };
      const result = await fetchTasks(query, withData([row]));
      expectError(result, 'schema');
      expect(!result.ok && result.error.message).toContain('task[0].expiredate');
    });

    it('강의 진도율이 숫자가 아님', async () => {
      const row = {
        evltnSe: 'lesson',
        sbjt: 's',
        moduletitle: 'm',
        startDate: 'a',
        endDate: 'b',
        isonoff: 'ON',
        prog: '100',
      };
      expectError(await fetchOnlineRows(query, withData([row])), 'schema');
    });

    it('온라인 목록의 퀴즈 줄에는 진도율이 없어도 된다', async () => {
      const row = { evltnSe: 'quiz', sbjt: 's', moduletitle: 'm', startDate: 'a', endDate: 'b' };
      expect((await fetchOnlineRows(query, withData([row]))).ok).toBe(true);
    });

    it('과목 목록 안의 과목 코드가 없음', async () => {
      const data = [{ value: '2026,2', label: 'l', subjList: [{ label: 'x', name: 'y' }] }];
      const result = await fetchSemesters(withData(data));
      expectError(result, 'schema');
      expect(!result.ok && result.error.message).toContain('subjList[0].value');
    });

    it('모르는 필드가 더 있는 것은 괜찮다', async () => {
      const row = { papernm: 'p', sdt: 'a', edt: 'b', issubmit: 'N', newField: 1 };
      expect((await fetchQuizzes(query, withData([row]))).ok).toBe(true);
    });

    it('빈 배열은 성공이다 (마감이 없는 과목)', async () => {
      expect(await fetchQuizzes(query, withData([]))).toEqual({ ok: true, data: [] });
    });
  });
});
