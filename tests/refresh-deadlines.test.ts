import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { deadlineCache } from '@/utils/deadline-cache';
import { createFetchCoordinator, fetchLease } from '@/utils/fetch-coordinator';
import type { CollectOutcome } from '@/utils/klas/collect-deadlines';
import type { ExtensionMessage } from '@/utils/messages';
import { refreshDeadlines, type RefreshDeps } from '@/utils/refresh-deadlines';

const T0 = 1_800_000_000_000;
const success: CollectOutcome = {
  ok: true,
  snapshot: { semester: '2026,2', checkedAt: T0, deadlines: [], skipped: [], failures: [] },
};

describe('refreshDeadlines (보내기를 흉내 냄)', () => {
  const deps = (decision: unknown, collect: RefreshDeps['collect']) => {
    const sent: ExtensionMessage[] = [];
    const send = vi.fn((message: ExtensionMessage) => {
      sent.push(message);
      return Promise.resolve(message.type === 'deadlines/request' ? decision : undefined);
    });
    return { sent, deps: { send, collect, now: () => T0 } satisfies RefreshDeps };
  };

  it('조회할 차례가 아니면 조회하지 않는다', async () => {
    const collect = vi.fn(() => Promise.resolve(success));
    const { sent, deps: d } = deps({ action: 'use-cache' }, collect);
    await expect(refreshDeadlines(d)).resolves.toEqual({ action: 'use-cache' });
    expect(collect).not.toHaveBeenCalled();
    expect(sent.map((m) => m.type)).toEqual(['deadlines/request']);
  });

  it('조회할 차례면 결과를 받은 조회권과 함께 알린다', async () => {
    const { sent, deps: d } = deps({ action: 'fetch', leaseId: 'L1' }, () =>
      Promise.resolve(success),
    );
    await refreshDeadlines(d, true);
    expect(sent).toEqual([
      { type: 'deadlines/request', force: true },
      { type: 'deadlines/report', leaseId: 'L1', outcome: success },
    ]);
  });

  it('조회 함수가 예외를 던지면 unexpected 실패로 알린다', async () => {
    const { sent, deps: d } = deps({ action: 'fetch', leaseId: 'L1' }, () =>
      Promise.reject(new TypeError('boom')),
    );
    await refreshDeadlines(d);
    expect(sent[1]).toEqual({
      type: 'deadlines/report',
      leaseId: 'L1',
      outcome: { ok: false, error: { kind: 'unexpected', path: '', message: 'TypeError: boom' } },
    });
  });

  it('Error가 아닌 값을 던져도 문자열로 남긴다', async () => {
    const { sent, deps: d } = deps({ action: 'fetch', leaseId: 'L1' }, () =>
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
      Promise.reject('plain'),
    );
    await refreshDeadlines(d);
    expect(sent[1]).toMatchObject({ outcome: { ok: false, error: { message: 'plain' } } });
  });
});

describe('refreshDeadlines와 background 조정 (저장소 사용)', () => {
  let clock = T0;

  beforeEach(() => {
    fakeBrowser.reset();
    clock = T0;
  });

  /** 탭 하나가 보내는 메시지를 background 조정으로 바로 넘긴다. */
  const tabSend =
    (coordinator: ReturnType<typeof createFetchCoordinator>, tabId: number) =>
    (message: ExtensionMessage): Promise<unknown> => {
      if (message.type === 'deadlines/request')
        return coordinator.request(tabId, message.force ?? false);
      if (message.type === 'deadlines/report')
        return coordinator.report(tabId, message.leaseId, message.outcome);
      return Promise.resolve(undefined);
    };

  it('조회 중 예외가 나도 조회권을 바로 돌려주고 실패를 캐시에 남긴다', async () => {
    const coordinator = createFetchCoordinator({ now: () => clock, newLeaseId: () => 'L1' });
    const decision = await refreshDeadlines({
      send: tabSend(coordinator, 1),
      collect: () => Promise.reject(new Error('bug')),
      now: () => clock,
    });

    expect(decision).toEqual({ action: 'fetch', leaseId: 'L1' });
    expect(await fetchLease.getValue()).toBeNull();
    expect((await deadlineCache.getValue()).lastError).toEqual({
      kind: 'unexpected',
      path: '',
      message: 'Error: bug',
      at: T0,
    });

    // 다른 탭은 조회 중인 탭을 기다리지 않고, 기록된 실패를 바로 본다.
    clock = T0 + 1_000;
    await expect(coordinator.request(2, false)).resolves.toEqual({ action: 'use-cache' });
  });
});
