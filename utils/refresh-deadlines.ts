import { EMPTY_CACHE, type DeadlineCache } from './deadline-cache';
import type { CollectOutcome } from './klas/collect-deadlines';

export interface RefreshDeps {
  collect: (now: number) => Promise<CollectOutcome>;
  now: () => number;
  readAccountHash: () => Promise<string | null>;
}

export async function refreshDeadlines(
  deps: RefreshDeps,
  accountHash: string | null,
  previous: DeadlineCache,
): Promise<DeadlineCache> {
  try {
    const outcome = await deps.collect(deps.now());
    if (!outcome.ok && outcome.error.kind === 'session') {
      return { ...EMPTY_CACHE, lastError: { ...outcome.error, at: deps.now() } };
    }
    if (accountHash !== null && (await deps.readAccountHash()) === accountHash) {
      if (outcome.ok) return { snapshot: outcome.snapshot, lastError: null };
      return { ...previous, lastError: { ...outcome.error, at: deps.now() } };
    }
  } catch (error) {
    console.warn('[KLAS Helper Plus] 마감 일정을 확인하지 못했습니다.', error);
  }
  return {
    ...EMPTY_CACHE,
    lastError: { kind: 'unexpected', at: deps.now(), path: '', message: '' },
  };
}
