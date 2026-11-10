import { EMPTY_CACHE, type DeadlineCache } from './deadline-cache';
import type { AccountCheck } from './klas/account';
import type { CollectOutcome } from './klas/collect-deadlines';

export interface RefreshDeps {
  collect: (now: number) => Promise<CollectOutcome>;
  now: () => number;
  checkAccount: () => Promise<AccountCheck>;
}

function accountFailure(kind: 'session' | 'unexpected', at: number): DeadlineCache {
  return { ...EMPTY_CACHE, lastError: { kind, at, path: '', message: '' } };
}

export async function refreshDeadlines(
  deps: RefreshDeps,
  account: AccountCheck,
  previous: DeadlineCache,
): Promise<DeadlineCache> {
  if ('error' in account) return accountFailure(account.error, deps.now());

  try {
    const outcome = await deps.collect(deps.now());
    if (!outcome.ok && outcome.error.kind === 'session') {
      return { ...EMPTY_CACHE, lastError: { ...outcome.error, at: deps.now() } };
    }
    const verified = await deps.checkAccount();
    if ('error' in verified) return accountFailure(verified.error, deps.now());
    if (verified.hash === account.hash) {
      if (outcome.ok) return { snapshot: outcome.snapshot, lastError: null };
      return { ...previous, lastError: { ...outcome.error, at: deps.now() } };
    }
  } catch (error) {
    console.warn('[KLAS Helper Plus] 마감 일정을 확인하지 못했습니다.', error);
  }
  return accountFailure('unexpected', deps.now());
}
