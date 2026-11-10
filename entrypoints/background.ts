import type { KlasResult, SessionStatus } from '@/utils/klas/api';
import { isExtensionMessage, type TabMessage } from '@/utils/messages';
import {
  createSessionKeeper,
  KEEPALIVE_ALARM,
  KEEPALIVE_PERIOD_MINUTES,
} from '@/utils/session-keeper';

/** 기다리지 않는 비동기 작업의 실패를 기록한다. 처리되지 않은 rejection으로 남기지 않는다. */
const logFailure = (what: string) => (error: unknown) => {
  console.error(`[KLAS Helper Plus] ${what} failed`, error);
};

export default defineBackground(() => {
  const keeper = createSessionKeeper({
    async extendInTab(tabId) {
      const message: TabMessage = { type: 'session/extend' };
      const result = await browser.tabs.sendMessage<
        TabMessage,
        KlasResult<SessionStatus> | undefined
      >(tabId, message);
      // 답할 content script가 없으면 예외가 나거나 빈 답이 온다. 둘 다 KLAS를 벗어난 탭으로 본다.
      if (result === undefined || result === null) throw new Error(`no response from tab ${tabId}`);
      return result;
    },
    alarmExists: async () => Boolean(await browser.alarms.get(KEEPALIVE_ALARM)),
    createAlarm: async () => {
      await browser.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: KEEPALIVE_PERIOD_MINUTES });
    },
    clearAlarm: async () => {
      await browser.alarms.clear(KEEPALIVE_ALARM);
    },
  });

  browser.runtime.onInstalled.addListener(({ reason }) => {
    if (reason === 'update') {
      storage
        .removeItem('local:deadlineCache', { removeMeta: true })
        .catch(logFailure('old deadline cache removal'));
    }
    console.log(`[KLAS Helper Plus] installed (${reason})`);
  });

  browser.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    const tabId = sender.tab?.id;
    if (!isExtensionMessage(message) || tabId === undefined) return false;
    // Chrome과 Firefox 모두에서 비동기로 답하려고 sendResponse를 쓰고 true를 돌려준다.
    keeper.registerTab(tabId).then(
      () => sendResponse({ ok: true }),
      (error: unknown) => {
        console.error('[KLAS Helper Plus] message failed', error);
        sendResponse({
          ok: false,
          message: error instanceof Error ? error.message : String(error),
        });
      },
    );
    return true;
  });

  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== KEEPALIVE_ALARM) return;
    keeper
      .onAlarm()
      .then((result) => {
        if (import.meta.env.DEV) console.info('[KLAS Helper Plus] 세션 연장', result);
      })
      .catch(logFailure('session keep-alive'));
  });

  // 탭이 닫히면 세션 연장 대상에서 뺀다.
  browser.tabs.onRemoved.addListener((tabId) => {
    keeper.removeTab(tabId).catch(logFailure('keep-alive tab removal'));
  });
});
