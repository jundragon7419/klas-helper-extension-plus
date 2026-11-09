// 여러 KLAS 탭 중 한 곳만 조회하도록 background에서 조정한다.
//
// 1. KLAS 탭이 열리면 content script가 조회해도 되는지 묻는다 (request).
// 2. 최근 결과가 있으면 "use-cache", 다른 탭이 조회 중이면 "wait", 아니면 조회권을 주고 "fetch".
// 3. 조회한 탭은 결과를 알린다 (report). 결과를 캐시에 저장하고 조회권을 돌려받는다.
// 4. 조회 중인 탭이 닫히면 조회권을 돌려받는다 (releaseTab). 다음에 묻는 탭이 이어받는다.
//
// 기다리는 탭은 캐시가 바뀌는 것을 보고 결과를 받는다.

import {
  applyOutcome,
  deadlineCache,
  isFresh,
  LEASE_MS,
  type DeadlineCache,
} from './deadline-cache';
import type { KlasError } from './klas/api';
import type { CollectOutcome } from './klas/collect-deadlines';

export interface FetchLease {
  tabId: number;
  leaseId: string;
  expiresAt: number;
}

/**
 * 지금 어느 KLAS 탭이 조회 중인지 (storage.session). service worker가 다시 시작돼도 남고,
 * 브라우저를 끄면 사라진다. background에서만 쓴다. content script는 storage.session에 접근할 수 없다.
 */
export const fetchLease = storage.defineItem<FetchLease | null>('session:fetchLease', {
  fallback: null,
});

export type FetchDecision =
  { action: 'fetch'; leaseId: string } | { action: 'use-cache' } | { action: 'wait' };

export interface DecideInput {
  cache: DeadlineCache;
  lease: FetchLease | null;
  tabId: number;
  /** 사용자가 새로 고침을 눌렀으면 최근 결과가 있어도 조회한다. */
  force: boolean;
  now: number;
  newLeaseId: () => string;
}

/** 조회 여부를 정한다. 저장소를 건드리지 않는 순수 함수다. */
export function decide({ cache, lease, tabId, force, now, newLeaseId }: DecideInput): {
  decision: FetchDecision;
  lease: FetchLease | null;
} {
  const held = lease !== null && lease.expiresAt > now;
  // 다른 탭이 조회 중이면 새로 고침이어도 기다린다. 같은 조회가 겹치지 않게 하려는 것이다.
  if (held && lease.tabId !== tabId) return { decision: { action: 'wait' }, lease };
  if (!force && isFresh(cache, now))
    return { decision: { action: 'use-cache' }, lease: held ? lease : null };
  const next = { tabId, leaseId: newLeaseId(), expiresAt: now + LEASE_MS };
  return { decision: { action: 'fetch', leaseId: next.leaseId }, lease: next };
}

export interface CoordinatorOptions {
  now?: () => number;
  newLeaseId?: () => string;
}

export function createFetchCoordinator(options: CoordinatorOptions = {}) {
  const now = options.now ?? (() => Date.now());
  const newLeaseId = options.newLeaseId ?? (() => crypto.randomUUID());

  // 저장소를 읽고 쓰는 사이에 다른 메시지가 끼어들지 않도록 한 번에 하나씩 처리한다.
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(task: () => Promise<T>): Promise<T> => {
    const run = queue.then(task, task);
    queue = run.catch(() => undefined);
    return run;
  };

  return {
    /** 탭이 조회해도 되는지 묻는다. */
    request(tabId: number, force = false): Promise<FetchDecision> {
      return serial(async () => {
        const [cache, lease] = await Promise.all([deadlineCache.getValue(), fetchLease.getValue()]);
        const result = decide({ cache, lease, tabId, force, now: now(), newLeaseId });
        if (result.lease !== lease) await fetchLease.setValue(result.lease);
        return result.decision;
      });
    },

    /**
     * 조회 결과를 받는다. 조회권이 맞으면 저장하고 조회권을 돌려받는다.
     * 조회권이 바뀐 뒤 도착한 성공 결과는 캐시가 비어 있거나 저장된 결과보다 새로울 때만 저장한다.
     */
    report(tabId: number, leaseId: string, outcome: CollectOutcome): Promise<void> {
      return serial(async () => {
        const [cache, lease] = await Promise.all([deadlineCache.getValue(), fetchLease.getValue()]);
        const current = lease?.tabId === tabId && lease.leaseId === leaseId;
        const newerSuccess =
          outcome.ok &&
          (cache.snapshot === null || outcome.snapshot.checkedAt > cache.snapshot.checkedAt);
        if (current || newerSuccess)
          await deadlineCache.setValue(applyOutcome(cache, outcome, now()));
        if (current) await fetchLease.setValue(null);
      });
    },

    /** 조회 밖에서 알게 된 실패를 기록한다. 세션 연장 응답이 세션 만료일 때 쓴다. */
    recordFailure(error: KlasError): Promise<void> {
      return serial(async () => {
        const cache = await deadlineCache.getValue();
        await deadlineCache.setValue(applyOutcome(cache, { ok: false, error }, now()));
      });
    },

    /** 탭이 닫히면 그 탭의 조회권을 돌려받는다. */
    releaseTab(tabId: number): Promise<void> {
      return serial(async () => {
        const lease = await fetchLease.getValue();
        if (lease?.tabId === tabId) await fetchLease.setValue(null);
      });
    },
  };
}
