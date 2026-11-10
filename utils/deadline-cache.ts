// 현재 KLAS 페이지에 표시하는 마감 결과와 조회 실패 기록.

import type { KlasError } from './klas/api';
import type { DeadlineSnapshot } from './klas/collect-deadlines';

const FRESH_FOR_MS = 5 * 60_000;
const RETRY_AFTER_FAILURE_MS = 60_000;

export interface DeadlineCache {
  snapshot: DeadlineSnapshot | null;
  lastError: (KlasError & { at: number }) | null;
}

export const EMPTY_CACHE: DeadlineCache = { snapshot: null, lastError: null };

export function isFresh({ snapshot, lastError }: DeadlineCache, now: number): boolean {
  if (lastError) {
    return lastError.kind !== 'session' && now - lastError.at < RETRY_AFTER_FAILURE_MS;
  }
  return snapshot !== null && now - snapshot.checkedAt < FRESH_FOR_MS;
}
