import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
  applyOutcome,
  deadlineCache,
  EMPTY_CACHE,
  FRESH_FOR_MS,
  fetchLease,
  isFresh,
  LEASE_MS,
  RETRY_AFTER_FAILURE_MS,
  type DeadlineCache,
} from '@/utils/deadline-cache';
import { createFetchCoordinator, decide } from '@/utils/fetch-coordinator';
import type { KlasError } from '@/utils/klas/api';
import type { CollectOutcome, DeadlineSnapshot } from '@/utils/klas/collect-deadlines';

const T0 = 1_800_000_000_000;
const snapshot = (checkedAt: number): DeadlineSnapshot => ({
  semester: '2026,2',
  checkedAt,
  deadlines: [],
  skipped: [],
  failures: [],
});
const success = (checkedAt: number): CollectOutcome => ({
  ok: true,
  snapshot: snapshot(checkedAt),
});
const failure = (kind: KlasError['kind']): CollectOutcome => ({
  ok: false,
  error: { kind, path: '/x.do', message: 'm' },
});

describe('applyOutcome', () => {
  it('성공하면 결과를 바꾸고 실패 기록을 지운다', () => {
    const cache: DeadlineCache = {
      snapshot: snapshot(T0),
      lastError: { kind: 'network', path: '/x.do', message: 'm', at: T0 },
    };
    expect(applyOutcome(cache, success(T0 + 1), T0 + 1)).toEqual({
      snapshot: snapshot(T0 + 1),
      lastError: null,
    });
  });

  it('실패하면 이전 결과를 그대로 두고 실패만 기록한다', () => {
    const cache: DeadlineCache = { snapshot: snapshot(T0), lastError: null };
    expect(applyOutcome(cache, failure('schema'), T0 + 5)).toEqual({
      snapshot: snapshot(T0),
      lastError: { kind: 'schema', path: '/x.do', message: 'm', at: T0 + 5 },
    });
  });
});

describe('isFresh', () => {
  it('5분 안에 성공한 결과가 있으면 다시 조회하지 않는다', () => {
    const cache = { snapshot: snapshot(T0), lastError: null };
    expect(isFresh(cache, T0 + FRESH_FOR_MS - 1)).toBe(true);
    expect(isFresh(cache, T0 + FRESH_FOR_MS)).toBe(false);
    expect(isFresh(EMPTY_CACHE, T0)).toBe(false);
  });

  it('1분 안에 실패했으면 기다린다', () => {
    const cache = applyOutcome(EMPTY_CACHE, failure('network'), T0);
    expect(isFresh(cache, T0 + RETRY_AFTER_FAILURE_MS - 1)).toBe(true);
    expect(isFresh(cache, T0 + RETRY_AFTER_FAILURE_MS)).toBe(false);
  });

  it('세션 만료 뒤에는 바로 다시 조회한다 (다시 로그인했을 때)', () => {
    const cache = applyOutcome(
      { snapshot: snapshot(T0), lastError: null },
      failure('session'),
      T0 + 1,
    );
    expect(isFresh(cache, T0 + 2)).toBe(false);
  });
});

describe('decide', () => {
  const base = {
    cache: EMPTY_CACHE,
    lease: null,
    tabId: 1,
    force: false,
    now: T0,
    newLeaseId: () => 'L1',
  };

  it('최근 결과가 없으면 조회권을 준다', () => {
    expect(decide(base)).toEqual({
      decision: { action: 'fetch', leaseId: 'L1' },
      lease: { tabId: 1, leaseId: 'L1', expiresAt: T0 + LEASE_MS },
    });
  });

  it('다른 탭이 조회 중이면 새로 고침이어도 기다린다', () => {
    const lease = { tabId: 2, leaseId: 'L0', expiresAt: T0 + 1 };
    expect(decide({ ...base, lease, force: true }).decision).toEqual({ action: 'wait' });
  });

  it('조회권이 만료되면 다른 탭이 이어받는다', () => {
    const lease = { tabId: 2, leaseId: 'L0', expiresAt: T0 };
    expect(decide({ ...base, lease }).decision).toEqual({ action: 'fetch', leaseId: 'L1' });
  });

  it('최근 결과가 있으면 그것을 쓰고, 새로 고침이면 조회한다', () => {
    const cache = { snapshot: snapshot(T0 - 1000), lastError: null };
    expect(decide({ ...base, cache }).decision).toEqual({ action: 'use-cache' });
    expect(decide({ ...base, cache, force: true }).decision).toEqual({
      action: 'fetch',
      leaseId: 'L1',
    });
  });
});

describe('createFetchCoordinator (저장소 사용)', () => {
  let clock = T0;
  let ids = 0;
  const coordinator = () =>
    createFetchCoordinator({ now: () => clock, newLeaseId: () => `L${(ids += 1)}` });

  beforeEach(() => {
    fakeBrowser.reset();
    clock = T0;
    ids = 0;
  });

  it('탭 세 개가 동시에 물어도 한 탭만 조회한다', async () => {
    const c = coordinator();
    const decisions = await Promise.all([c.request(1), c.request(2), c.request(3)]);
    expect(decisions.map((d) => d.action)).toEqual(['fetch', 'wait', 'wait']);
  });

  it('결과를 알리면 캐시에 저장하고 조회권을 돌려받으며, 다음 탭은 캐시를 쓴다', async () => {
    const c = coordinator();
    const first = await c.request(1);
    if (first.action !== 'fetch') throw new Error('expected fetch');
    await c.report(1, first.leaseId, success(T0));
    expect((await deadlineCache.getValue()).snapshot?.checkedAt).toBe(T0);
    expect(await fetchLease.getValue()).toBeNull();
    clock = T0 + 1000;
    expect(await c.request(2)).toEqual({ action: 'use-cache' });
  });

  it('조회 중인 탭이 닫히면 다른 탭이 바로 이어받는다', async () => {
    const c = coordinator();
    await c.request(1);
    expect((await c.request(2)).action).toBe('wait');
    await c.releaseTab(1);
    expect((await c.request(2)).action).toBe('fetch');
  });

  it('다른 탭이 닫혀도 조회권은 그대로다', async () => {
    const c = coordinator();
    await c.request(1);
    await c.releaseTab(2);
    expect((await fetchLease.getValue())?.tabId).toBe(1);
  });

  it('늦게 온 결과: 성공이면 저장하고, 실패면 버린다', async () => {
    const c = coordinator();
    const first = await c.request(1);
    clock = T0 + LEASE_MS;
    const second = await c.request(2);
    expect(second.action).toBe('fetch');
    if (first.action !== 'fetch') throw new Error('expected fetch');

    await c.report(1, first.leaseId, failure('network'));
    expect((await deadlineCache.getValue()).lastError).toBeNull();
    expect((await fetchLease.getValue())?.tabId).toBe(2);

    await c.report(1, first.leaseId, success(T0 + 1));
    expect((await deadlineCache.getValue()).snapshot?.checkedAt).toBe(T0 + 1);
    expect((await fetchLease.getValue())?.tabId).toBe(2);
  });

  it('실패 뒤 1분 동안은 다시 조회하지 않는다', async () => {
    const c = coordinator();
    const first = await c.request(1);
    if (first.action !== 'fetch') throw new Error('expected fetch');
    await c.report(1, first.leaseId, failure('not-json'));
    clock = T0 + RETRY_AFTER_FAILURE_MS - 1;
    expect(await c.request(2)).toEqual({ action: 'use-cache' });
    clock = T0 + RETRY_AFTER_FAILURE_MS;
    expect((await c.request(2)).action).toBe('fetch');
  });
});
