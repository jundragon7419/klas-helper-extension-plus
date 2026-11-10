import { describe, expect, it, vi } from 'vitest';
import { EMPTY_CACHE, isFresh } from '@/utils/deadline-cache';
import { checkAccount, type AccountCheck } from '@/utils/klas/account';
import type { CollectOutcome } from '@/utils/klas/collect-deadlines';
import { refreshDeadlines } from '@/utils/refresh-deadlines';
import { loginPage } from './helpers/klas-fetch';

const T0 = 1_800_000_000_000;
const snapshot = { semester: '2026,2', checkedAt: T0, deadlines: [], skipped: [], failures: [] };
const success: CollectOutcome = { ok: true, snapshot };
const previous = { snapshot, lastError: null };
const accountA = { hash: 'account-a' };

function deps(outcome: CollectOutcome, account: AccountCheck = accountA) {
  return {
    collect: () => Promise.resolve(outcome),
    now: () => T0,
    checkAccount: () => Promise.resolve(account),
  };
}

describe('페이지 마감 조회', () => {
  it('조회 전후의 계정이 같으면 현재 페이지에 표시할 결과를 반환한다', async () => {
    expect(await refreshDeadlines(deps(success), accountA, EMPTY_CACHE)).toEqual(previous);
  });

  it.each<AccountCheck>([{ hash: 'account-b' }, { error: 'unexpected' }])(
    '조회 뒤 계정이 바뀌거나 확인되지 않으면 이전 결과와 새 결과를 표시하지 않는다 (%j)',
    async (account) => {
      expect(await refreshDeadlines(deps(success, account), accountA, previous)).toMatchObject({
        snapshot: null,
        lastError: { kind: 'unexpected' },
      });
    },
  );

  it('조회 전 계정을 확인하지 못하면 마감 요청을 보내지 않는다', async () => {
    const collect = vi.fn(() => Promise.resolve(success));
    expect(
      await refreshDeadlines({ ...deps(success), collect }, { error: 'unexpected' }, previous),
    ).toMatchObject({
      snapshot: null,
      lastError: { kind: 'unexpected' },
    });
    expect(collect).not.toHaveBeenCalled();
  });

  it('계정 확인 요청이 로그인 화면으로 이동하면 마감 조회 없이 로그인 안내를 표시한다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(loginPage())),
    );
    const collect = vi.fn(() => Promise.resolve(success));
    try {
      expect(
        await refreshDeadlines({ ...deps(success), collect }, await checkAccount(), previous),
      ).toMatchObject({ snapshot: null, lastError: { kind: 'session' } });
      expect(collect).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('같은 계정에서 일시적으로 조회가 실패하면 이전 결과를 유지한다', async () => {
    const error = { kind: 'network', path: '', message: '' } as const;
    expect(await refreshDeadlines(deps({ ok: false, error }), accountA, previous)).toEqual({
      snapshot,
      lastError: { ...error, at: T0 },
    });
  });

  it('마감 조회에서 로그인 만료를 확인하면 이전 결과를 비운다', async () => {
    const error = { kind: 'session', path: '', message: '' } as const;
    const result = await refreshDeadlines(deps({ ok: false, error }), accountA, previous);
    expect(result).toEqual({ snapshot: null, lastError: { ...error, at: T0 } });
    expect(isFresh(result, T0)).toBe(false);
  });
});
