import { describe, expect, it } from 'vitest';
import { EMPTY_CACHE, isFresh } from '@/utils/deadline-cache';
import type { CollectOutcome } from '@/utils/klas/collect-deadlines';
import { refreshDeadlines } from '@/utils/refresh-deadlines';

const T0 = 1_800_000_000_000;
const snapshot = { semester: '2026,2', checkedAt: T0, deadlines: [], skipped: [], failures: [] };
const success: CollectOutcome = { ok: true, snapshot };
const previous = { snapshot, lastError: null };

function deps(outcome: CollectOutcome, account: string | null = 'account-a') {
  return {
    collect: () => Promise.resolve(outcome),
    now: () => T0,
    readAccountHash: () => Promise.resolve(account),
  };
}

describe('페이지 마감 조회', () => {
  it('조회 전후의 계정이 같으면 현재 페이지에 표시할 결과를 반환한다', async () => {
    expect(await refreshDeadlines(deps(success), 'account-a', EMPTY_CACHE)).toEqual(previous);
  });

  it.each(['account-b', null])(
    '조회 뒤 계정이 %s이면 이전 결과와 새 결과를 표시하지 않는다',
    async (account) => {
      expect(await refreshDeadlines(deps(success, account), 'account-a', previous)).toMatchObject({
        snapshot: null,
        lastError: { kind: 'unexpected' },
      });
    },
  );

  it('조회 전 계정을 확인하지 못하면 성공 결과를 표시하지 않는다', async () => {
    expect(await refreshDeadlines(deps(success), null, EMPTY_CACHE)).toMatchObject({
      snapshot: null,
      lastError: { kind: 'unexpected' },
    });
  });

  it('같은 계정에서 일시적으로 조회가 실패하면 이전 결과를 유지한다', async () => {
    const error = { kind: 'network', path: '', message: '' } as const;
    expect(await refreshDeadlines(deps({ ok: false, error }), 'account-a', previous)).toEqual({
      snapshot,
      lastError: { ...error, at: T0 },
    });
  });

  it('마감 조회에서 로그인 만료를 확인하면 이전 결과를 비운다', async () => {
    const error = { kind: 'session', path: '', message: '' } as const;
    const result = await refreshDeadlines(deps({ ok: false, error }, null), 'account-a', previous);
    expect(result).toEqual({ snapshot: null, lastError: { ...error, at: T0 } });
    expect(isFresh(result, T0)).toBe(false);
  });
});
