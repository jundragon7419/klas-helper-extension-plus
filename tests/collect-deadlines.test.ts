import { describe, expect, it } from 'vitest';
import { parseKlasDate } from '@/utils/date';
import { KLAS_PATHS } from '@/utils/klas/api';
import { collectDeadlines } from '@/utils/klas/collect-deadlines';
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
