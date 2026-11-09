import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
  applyOutcome,
  deadlineCache,
  EMPTY_CACHE,
  FRESH_FOR_MS,
  isFresh,
  LEASE_MS,
  RETRY_AFTER_FAILURE_MS,
  type DeadlineCache,
} from '@/utils/deadline-cache';
import { createFetchCoordinator, decide, fetchLease } from '@/utils/fetch-coordinator';
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
    const decisions = await Promise.all([
      c.request(1, 'account-a'),
      c.request(2, 'account-a'),
      c.request(3, 'account-a'),
    ]);
    expect(decisions.map((d) => d.action)).toEqual(['fetch', 'wait', 'wait']);
  });

  it('결과를 알리면 캐시에 저장하고 조회권을 돌려받으며, 다음 탭은 캐시를 쓴다', async () => {
    const c = coordinator();
    const first = await c.request(1, 'account-a');
    if (first.action !== 'fetch') throw new Error('expected fetch');
    await c.report(1, first.leaseId, 'account-a', 'account-a', success(T0));
    expect((await deadlineCache.getValue()).snapshot?.checkedAt).toBe(T0);
    expect(await fetchLease.getValue()).toBeNull();
    clock = T0 + 1000;
    expect(await c.request(2, 'account-a')).toEqual({ action: 'use-cache' });
  });

  it('조회 중인 탭이 닫히면 다른 탭이 바로 이어받는다', async () => {
    const c = coordinator();
    await c.request(1, 'account-a');
    expect((await c.request(2, 'account-a')).action).toBe('wait');
    await c.releaseTab(1);
    expect((await c.request(2, 'account-a')).action).toBe('fetch');
  });

  it('다른 탭이 닫혀도 조회권은 그대로다', async () => {
    const c = coordinator();
    await c.request(1, 'account-a');
    await c.releaseTab(2);
    expect((await fetchLease.getValue())?.tabId).toBe(1);
  });

  it('캐시가 비어 있으면 늦게 온 성공 결과를 저장하고 실패는 버린다', async () => {
    const c = coordinator();
    const first = await c.request(1, 'account-a');
    clock = T0 + LEASE_MS;
    const second = await c.request(2, 'account-a');
    expect(second.action).toBe('fetch');
    if (first.action !== 'fetch') throw new Error('expected fetch');

    await c.report(1, first.leaseId, 'account-a', 'account-a', failure('network'));
    expect((await deadlineCache.getValue()).lastError).toBeNull();
    expect((await fetchLease.getValue())?.tabId).toBe(2);

    await c.report(1, first.leaseId, 'account-a', 'account-a', success(T0 + 1));
    expect((await deadlineCache.getValue()).snapshot?.checkedAt).toBe(T0 + 1);
    expect((await fetchLease.getValue())?.tabId).toBe(2);
  });

  it('늦은 성공으로 목록을 갱신해도 최근 실패는 새 조회가 성공할 때까지 유지한다', async () => {
    const c = coordinator();
    const first = await c.request(1, 'account-a');
    clock = T0 + LEASE_MS;
    const second = await c.request(2, 'account-a');
    if (first.action !== 'fetch' || second.action !== 'fetch') throw new Error('expected fetch');

    clock += 1;
    const failedAt = clock;
    await c.report(2, second.leaseId, 'account-a', 'account-a', failure('network'));
    clock += 1;
    await c.report(1, first.leaseId, 'account-a', 'account-a', success(T0));
    expect(await deadlineCache.getValue()).toMatchObject({
      snapshot: snapshot(T0),
      lastError: { kind: 'network', at: failedAt },
    });
    expect(await c.request(3, 'account-a')).toEqual({ action: 'use-cache' });

    const retry = await c.request(3, 'account-a', true);
    if (retry.action !== 'fetch') throw new Error('expected fetch');
    await c.report(3, retry.leaseId, 'account-a', 'account-a', success(clock));
    expect(await deadlineCache.getValue()).toMatchObject({
      snapshot: snapshot(clock),
      lastError: null,
    });
  });

  it('늦게 온 성공 결과가 다른 탭이 저장한 최신 결과를 덮어쓰지 않는다', async () => {
    const c = coordinator();
    const first = await c.request(1, 'account-a');
    clock = T0 + LEASE_MS;
    const second = await c.request(2, 'account-a');
    if (first.action !== 'fetch' || second.action !== 'fetch') throw new Error('expected fetch');

    await c.report(2, second.leaseId, 'account-a', 'account-a', success(clock));
    await c.report(1, first.leaseId, 'account-a', 'account-a', success(T0));

    expect((await deadlineCache.getValue()).snapshot?.checkedAt).toBe(clock);
  });

  it('계정이 바뀌면 캐시를 비우고 이전 탭의 늦은 성공을 버린다', async () => {
    const c = coordinator();
    await deadlineCache.setValue({
      ...EMPTY_CACHE,
      accountHash: 'account-a',
      snapshot: snapshot(T0),
    });
    const first = await c.request(1, 'account-a', true);
    const second = await c.request(2, 'account-b');
    if (first.action !== 'fetch' || second.action !== 'fetch') throw new Error('expected fetch');

    await c.report(1, first.leaseId, 'account-a', 'account-a', success(T0 + 1));
    expect(await deadlineCache.getValue()).toMatchObject({
      ...EMPTY_CACHE,
      accountHash: 'account-b',
    });
    expect((await fetchLease.getValue())?.leaseId).toBe(second.leaseId);
  });

  it('A에서 B를 거쳐 다시 A가 되어도 최초 A 조회 결과를 버린다', async () => {
    const c = coordinator();
    const first = await c.request(1, 'account-a');
    await c.request(2, 'account-b');
    const latest = await c.request(3, 'account-a');
    if (first.action !== 'fetch' || latest.action !== 'fetch') throw new Error('expected fetch');

    await coordinator().report(1, first.leaseId, 'account-a', 'account-a', success(T0));
    expect((await deadlineCache.getValue()).snapshot).toBeNull();
    expect((await fetchLease.getValue())?.leaseId).toBe(latest.leaseId);

    await c.report(3, latest.leaseId, 'account-a', 'account-a', success(T0 + 1));
    expect((await deadlineCache.getValue()).snapshot).toEqual(snapshot(T0 + 1));
    expect(await fetchLease.getValue()).toBeNull();
  });

  it('조회 도중 계정이 바뀌면 결과를 저장하지 않고 조회권을 돌려준다', async () => {
    const c = coordinator();
    const first = await c.request(1, 'account-a');
    if (first.action !== 'fetch') throw new Error('expected fetch');
    await c.report(1, first.leaseId, 'account-a', 'account-a', success(T0));
    const next = await c.request(1, 'account-a', true);
    if (next.action !== 'fetch') throw new Error('expected fetch');

    await c.report(1, next.leaseId, 'account-a', 'account-b', success(T0 + 1));
    expect(await deadlineCache.getValue()).toEqual(EMPTY_CACHE);
    expect(await fetchLease.getValue()).toBeNull();
  });

  it('계정을 모르면 캐시를 사용하지 않고 이전 버전의 캐시는 식별 후 비운다', async () => {
    const c = coordinator();
    const oldCache = { ...EMPTY_CACHE, snapshot: snapshot(T0) };
    await deadlineCache.setValue(oldCache);
    await expect(c.request(1, null)).resolves.toEqual({ action: 'fetch-uncached' });
    expect(await deadlineCache.getValue()).toEqual(oldCache);
    expect((await c.request(1, 'account-a')).action).toBe('fetch');
    expect(await deadlineCache.getValue()).toMatchObject({
      ...EMPTY_CACHE,
      accountHash: 'account-a',
    });
  });

  it('실패 뒤 1분 동안은 다시 조회하지 않는다', async () => {
    const c = coordinator();
    const first = await c.request(1, 'account-a');
    if (first.action !== 'fetch') throw new Error('expected fetch');
    await c.report(1, first.leaseId, 'account-a', 'account-a', failure('not-json'));
    clock = T0 + RETRY_AFTER_FAILURE_MS - 1;
    expect(await c.request(2, 'account-a')).toEqual({ action: 'use-cache' });
    clock = T0 + RETRY_AFTER_FAILURE_MS;
    expect((await c.request(2, 'account-a')).action).toBe('fetch');
  });
});
