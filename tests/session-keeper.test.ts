import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { deadlineCache } from '@/utils/deadline-cache';
import { createFetchCoordinator } from '@/utils/fetch-coordinator';
import {
  extendSession,
  KLAS_PATHS,
  type KlasError,
  type KlasResult,
  type SessionStatus,
} from '@/utils/klas/api';
import { createSessionKeeper, klasTabs } from '@/utils/session-keeper';
import { sessionKeepAlive } from '@/utils/settings';
import { fixtureFetch, json, loginPage, respond } from './helpers/klas-fetch';

const ok: KlasResult<SessionStatus> = { ok: true, data: { remainingSeconds: 7200 } };
const lost: KlasError = { kind: 'session', path: KLAS_PATHS.updateSession, message: 'm' };

/** 탭별 답을 정해 둔 가짜 의존성. 'gone'이면 content script가 없는 탭처럼 예외를 던진다. */
function setup(answers: Record<number, KlasResult<SessionStatus> | 'gone'> = {}) {
  let alarm = false;
  const deps = {
    extendInTab: vi.fn((tabId: number) => {
      const answer = answers[tabId] ?? ok;
      return answer === 'gone'
        ? Promise.reject(new Error('Could not establish connection'))
        : Promise.resolve(answer);
    }),
    alarmExists: vi.fn(() => Promise.resolve(alarm)),
    createAlarm: vi.fn(() => {
      alarm = true;
      return Promise.resolve();
    }),
    clearAlarm: vi.fn(() => {
      alarm = false;
      return Promise.resolve();
    }),
    readFetchScope: vi.fn(() => Promise.resolve('scope-a')),
    onSessionLost: vi.fn(() => Promise.resolve()),
  };
  return { deps, keeper: createSessionKeeper(deps), hasAlarm: () => alarm };
}

describe('createSessionKeeper', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it('첫 KLAS 탭이 열리면 알람을 만들고, 이미 있으면 다시 만들지 않는다', async () => {
    const { deps, keeper } = setup();
    await keeper.registerTab(1);
    await keeper.registerTab(2);
    await keeper.registerTab(1);
    expect(deps.createAlarm).toHaveBeenCalledTimes(1);
    expect(await klasTabs.getValue()).toEqual([1, 2]);
  });

  it('마지막 KLAS 탭이 닫히면 알람을 지운다', async () => {
    const { keeper, hasAlarm } = setup();
    await keeper.registerTab(1);
    await keeper.registerTab(2);
    await keeper.removeTab(1);
    expect(hasAlarm()).toBe(true);
    await keeper.removeTab(2);
    expect(hasAlarm()).toBe(false);
  });

  it('알람이 울리면 KLAS 탭 하나에만 연장을 맡긴다', async () => {
    const { deps, keeper } = setup();
    await keeper.registerTab(1);
    await keeper.registerTab(2);
    expect(await keeper.onAlarm()).toEqual({ status: 'extended', tabId: 1 });
    expect(deps.extendInTab).toHaveBeenCalledTimes(1);
  });

  it('KLAS 탭이 없으면 아무것도 하지 않고 알람을 지운다', async () => {
    const { deps, keeper } = setup();
    expect(await keeper.onAlarm()).toEqual({ status: 'no-tab' });
    expect(deps.extendInTab).not.toHaveBeenCalled();
    expect(deps.clearAlarm).toHaveBeenCalled();
  });

  it('설정을 끄면 연장하지 않는다', async () => {
    const { deps, keeper } = setup();
    await keeper.registerTab(1);
    await sessionKeepAlive.setValue(false);
    expect(await keeper.onAlarm()).toEqual({ status: 'disabled' });
    expect(deps.extendInTab).not.toHaveBeenCalled();
  });

  it('탭의 응답을 기다리는 사이에 설정을 끄면 다른 탭에 연장을 맡기지 않는다', async () => {
    const { deps, keeper } = setup();
    deps.extendInTab.mockImplementationOnce(async () => {
      await sessionKeepAlive.setValue(false);
      throw new Error('Could not establish connection');
    });
    await keeper.registerTab(1);
    await keeper.registerTab(2);

    expect(await keeper.onAlarm()).toEqual({ status: 'disabled' });
    expect(deps.extendInTab).toHaveBeenCalledTimes(1);
    expect(await klasTabs.getValue()).toEqual([2]);

    await sessionKeepAlive.setValue(true);
    expect(await keeper.onAlarm()).toEqual({ status: 'extended', tabId: 2 });
  });

  it('설정은 기본으로 켜져 있다', async () => {
    expect(await sessionKeepAlive.getValue()).toBe(true);
  });

  it('답하지 않는 탭(KLAS를 벗어남)은 빼고 다음 탭에 맡긴다', async () => {
    const { keeper } = setup({ 1: 'gone' });
    await keeper.registerTab(1);
    await keeper.registerTab(2);
    expect(await keeper.onAlarm()).toEqual({ status: 'extended', tabId: 2 });
    expect(await klasTabs.getValue()).toEqual([2]);
  });

  it('모든 탭이 답하지 않으면 목록을 비우고 알람을 지운다', async () => {
    const { keeper, hasAlarm } = setup({ 1: 'gone', 2: 'gone' });
    await keeper.registerTab(1);
    await keeper.registerTab(2);
    expect(await keeper.onAlarm()).toEqual({ status: 'no-tab' });
    expect(await klasTabs.getValue()).toEqual([]);
    expect(hasAlarm()).toBe(false);
  });

  it('연장 응답이 세션 만료면 알리고, 다른 탭으로 다시 시도하지 않는다', async () => {
    const { deps, keeper } = setup({ 1: { ok: false, error: lost } });
    await keeper.registerTab(1);
    await keeper.registerTab(2);
    expect(await keeper.onAlarm()).toEqual({ status: 'failed', tabId: 1, error: lost });
    expect(deps.onSessionLost).toHaveBeenCalledWith(lost, 'scope-a');
    expect(deps.extendInTab).toHaveBeenCalledTimes(1);
  });

  it('세션 만료가 아닌 실패는 알리지 않는다', async () => {
    const network: KlasError = { kind: 'network', path: '/x', message: 'm' };
    const { deps, keeper } = setup({ 1: { ok: false, error: network } });
    await keeper.registerTab(1);
    expect((await keeper.onAlarm()).status).toBe('failed');
    expect(deps.onSessionLost).not.toHaveBeenCalled();
  });
});

describe('세션 만료를 캐시에 기록', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it.each(['account-b', 'account-a'])(
    '이전 연장의 늦은 만료가 %s의 새 캐시를 바꾸지 않는다',
    async (finalAccount) => {
      const coordinator = createFetchCoordinator({ now: () => 5 });
      const started = Promise.withResolvers<void>();
      const renewal = Promise.withResolvers<KlasResult<SessionStatus>>();
      const { deps } = setup();
      const keeper = createSessionKeeper({
        ...deps,
        readFetchScope: async () => (await deadlineCache.getValue()).fetchScope,
        extendInTab: () => {
          started.resolve();
          return renewal.promise;
        },
        onSessionLost: (error, fetchScope) => coordinator.recordFailure(error, fetchScope),
      });
      await coordinator.request(1, 'account-a');
      await keeper.registerTab(1);

      const alarm = keeper.onAlarm();
      await started.promise;
      if (finalAccount === 'account-a') await coordinator.request(2, 'account-b');
      const decision = await coordinator.request(2, finalAccount, true);
      if (decision.action !== 'fetch') throw new Error('expected fetch');
      const snapshot = {
        semester: '2026,2',
        checkedAt: 5,
        deadlines: [],
        skipped: [],
        failures: [],
      };
      await coordinator.report(2, decision.leaseId, finalAccount, finalAccount, {
        ok: true,
        snapshot,
      });

      renewal.resolve({ ok: false, error: lost });
      await alarm;

      expect(await deadlineCache.getValue()).toMatchObject({
        accountHash: finalAccount,
        snapshot,
        lastError: null,
      });
    },
  );

  it.each([undefined, 'scope-a'])(
    '같은 범위 %s의 만료는 이전 결과를 두고 기록한다',
    async (fetchScope) => {
      const snapshot = {
        semester: '2026,2',
        checkedAt: 1,
        deadlines: [],
        skipped: [],
        failures: [],
      };
      const cache = { snapshot, lastError: null, ...(fetchScope && { fetchScope }) };
      await deadlineCache.setValue(cache);
      await createFetchCoordinator({ now: () => 5 }).recordFailure(lost, fetchScope);
      expect(await deadlineCache.getValue()).toEqual({ ...cache, lastError: { ...lost, at: 5 } });
    },
  );
});

describe('extendSession', () => {
  // 실제 응답 (2026-11-06 확인)
  // - UpdateSession.do: 로그인 여부와 관계없이 200, JSON {}
  // - session/info: 로그인했으면 JSON { remainingTime, ... }, 아니면 500 HTML
  // - 과목 목록: 로그인하지 않았으면 LoginForm.do로 이동
  const sessionInfo = (remainingTime: number) =>
    json({ remainingTime, sessionNotiSec: remainingTime - 300, logoutCountDownSec: 300 });
  const serverError = () => respond('<html></html>', { status: 500, contentType: 'text/html' });
  const path = (url: string) => new URL(url).pathname;

  it('연장한 뒤 남은 시간을 읽는다. 요청은 GET 두 번이다', async () => {
    const fetch = fixtureFetch((p) => {
      if (p === KLAS_PATHS.updateSession) return json({});
      if (p === KLAS_PATHS.sessionInfo) return sessionInfo(7200);
      return undefined;
    });
    expect(await extendSession({ fetch })).toEqual({ ok: true, data: { remainingSeconds: 7200 } });
    expect(fetch.mock.calls.map(([url, init]) => [path(url), init?.method])).toEqual([
      [KLAS_PATHS.updateSession, 'GET'],
      [KLAS_PATHS.sessionInfo, 'GET'],
    ]);
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({ credentials: 'include' });
  });

  it('UpdateSession.do 응답은 /usr/cmn/login/ 아래에 있어도 로그인 페이지로 보지 않는다', async () => {
    const fetch = fixtureFetch((p) => {
      if (p === KLAS_PATHS.updateSession) {
        return respond('{}', {
          contentType: 'application/json;charset=UTF-8',
          url: `https://klas.kw.ac.kr${KLAS_PATHS.updateSession}`,
        });
      }
      if (p === KLAS_PATHS.sessionInfo) return sessionInfo(7200);
      return undefined;
    });
    expect((await extendSession({ fetch })).ok).toBe(true);
  });

  it('로그인이 끊겼으면 과목 목록으로 확인해 session 실패를 돌려준다', async () => {
    const fetch = fixtureFetch((p) => {
      if (p === KLAS_PATHS.updateSession) return json({});
      if (p === KLAS_PATHS.sessionInfo) return serverError();
      if (p === KLAS_PATHS.semesters) return loginPage();
      return undefined;
    });
    expect(await extendSession({ fetch })).toMatchObject({ ok: false, error: { kind: 'session' } });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('남은 시간을 못 읽어도 과목 목록이 되면 로그인은 살아 있다', async () => {
    const fetch = fixtureFetch((p) => {
      if (p === KLAS_PATHS.updateSession) return json({});
      if (p === KLAS_PATHS.sessionInfo) return serverError();
      return undefined;
    });
    expect(await extendSession({ fetch })).toEqual({ ok: true, data: { remainingSeconds: null } });
  });

  it('연장 요청 자체가 실패하면 그 실패를 돌려준다', async () => {
    const fetch = vi.fn(() => Promise.reject(new TypeError('Failed to fetch')));
    expect(await extendSession({ fetch })).toMatchObject({ ok: false, error: { kind: 'network' } });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
