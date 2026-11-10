import { describe, expect, it } from 'vitest';
import { parseKlasDate } from '@/utils/date';
import { KLAS_PATHS } from '@/utils/klas/api';
import { collectDeadlines } from '@/utils/klas/collect-deadlines';
import { refreshDeadlines } from '@/utils/refresh-deadlines';
import { fixtureFetch, json, loginPage } from './helpers/klas-fetch';

const now = parseKlasDate('2026-11-06 12:00')!;

describe('collectDeadlines', () => {
  it('현재 학기 모든 과목의 마감을 모은다 (요청: 과목 목록 1 + 과목 6 × 4)', async () => {
    const fetch = fixtureFetch();
    const outcome = await collectDeadlines(now, { fetch });
    expect(fetch).toHaveBeenCalledTimes(25);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const { snapshot } = outcome;
    expect(snapshot.semester).toBe('2026,2');
    expect(snapshot.checkedAt).toBe(now);
    expect(snapshot.deadlines).toHaveLength(19 + 14 + 1 + 2);
    expect(snapshot.failures).toEqual([]);
    expect(snapshot.skipped).toEqual([]);
  });

  it('과목 목록이 실패하면 전체가 실패다', async () => {
    const fetch = fixtureFetch(() => loginPage());
    const outcome = await collectDeadlines(now, { fetch });
    expect(outcome).toMatchObject({ ok: false, error: { kind: 'session' } });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('도중에 로그인이 끊기면 전체가 실패다', async () => {
    const fetch = fixtureFetch((path) => (path === KLAS_PATHS.quiz ? loginPage() : undefined));
    const outcome = await collectDeadlines(now, { fetch });
    expect(outcome).toMatchObject({ ok: false, error: { kind: 'session', path: KLAS_PATHS.quiz } });
    // 첫 과목의 네 요청 뒤에 멈춘다.
    expect(fetch).toHaveBeenCalledTimes(5);
  });

  it('일부 목록이 형식이 다르면 failures에 남기고 나머지 마감은 모은다', async () => {
    const fetch = fixtureFetch((path) =>
      path === KLAS_PATHS.project ? json({ changed: true }) : undefined,
    );
    const outcome = await collectDeadlines(now, { fetch });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.snapshot.failures).toHaveLength(6);
    expect(outcome.snapshot.failures.every((f) => f.kind === 'schema')).toBe(true);
    expect(outcome.snapshot.deadlines.filter((d) => d.kind === 'project')).toEqual([]);
    expect(outcome.snapshot.deadlines).toHaveLength(19 + 14 + 2);
  });

  it('형식 오류에 원본 응답 값을 남기지 않는다', async () => {
    const marker = 'synthetic-private-field';
    const fetch = fixtureFetch((path) =>
      path === KLAS_PATHS.task ? json([{ title: { marker } }]) : undefined,
    );
    const outcome = await collectDeadlines(now, { fetch });
    if (!outcome.ok) throw new Error('expected partial success');
    expect(outcome.snapshot.failures[0]).toEqual({
      kind: 'schema',
      path: KLAS_PATHS.task,
      message: 'task[0].title: 문자열 필요',
    });

    expect(JSON.stringify(outcome)).not.toContain(marker);
  });

  it('모든 마감 목록의 조회가 실패하면 전체 실패다', async () => {
    const fetch = fixtureFetch((path) =>
      path === KLAS_PATHS.semesters ? undefined : json({ changed: true }),
    );

    await expect(collectDeadlines(now, { fetch })).resolves.toMatchObject({
      ok: false,
      error: { kind: 'schema', path: KLAS_PATHS.online },
    });
    expect(fetch).toHaveBeenCalledTimes(25);
  });

  it('조회에 성공한 빈 목록이 있으면 일부 실패로 처리한다', async () => {
    const fetch = fixtureFetch((path) =>
      path === KLAS_PATHS.semesters ? undefined : json(path === KLAS_PATHS.online ? [] : {}),
    );

    const outcome = await collectDeadlines(now, { fetch });
    expect(outcome).toMatchObject({ ok: true, snapshot: { deadlines: [] } });
    if (!outcome.ok) return;
    expect(outcome.snapshot.failures).toHaveLength(18);
  });

  it.each([[['2026-2']], [['2026,9', '2026,1']]])(
    '지원하지 않는 학기 코드가 섞인 응답 %j는 실패로 처리한다',
    async (codes) => {
      const semesters = codes.map((value) => ({
        value,
        label: '테스트 학기',
        subjList: [{ value: 'S1', label: '테스트 과목', name: '테스트 과목' }],
      }));
      const fetch = fixtureFetch(() => json(semesters));
      const previous = await collectDeadlines(now, { fetch: fixtureFetch() });
      if (!previous.ok) throw new Error('expected previous snapshot');

      const outcome = await collectDeadlines(now, { fetch });
      expect(outcome).toMatchObject({
        ok: false,
        error: { kind: 'schema', path: KLAS_PATHS.semesters },
      });
      expect(fetch).toHaveBeenCalledTimes(1);
      const result = await refreshDeadlines(
        {
          collect: () => Promise.resolve(outcome),
          now: () => now + 1,
          readAccountHash: () => Promise.resolve('account-a'),
        },
        'account-a',
        { snapshot: previous.snapshot, lastError: null },
      );
      expect(result.snapshot).toBe(previous.snapshot);
    },
  );

  it('학기 목록이 비어 있으면 빈 결과다', async () => {
    const fetch = fixtureFetch(() => json([]));
    await expect(collectDeadlines(now, { fetch })).resolves.toMatchObject({
      ok: true,
      snapshot: { semester: null, deadlines: [] },
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('고를 학기가 없으면 빈 결과다 (입학 전)', async () => {
    const fetch = fixtureFetch((path) =>
      path === KLAS_PATHS.semesters
        ? json([{ value: '2027,1', label: 'l', subjList: [] }])
        : undefined,
    );
    const outcome = await collectDeadlines(parseKlasDate('2027-02-20 12:00')!, { fetch });
    expect(outcome).toMatchObject({ ok: true, snapshot: { semester: null, deadlines: [] } });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
