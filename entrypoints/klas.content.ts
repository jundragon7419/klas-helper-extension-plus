// KLAS 페이지에서 실행되는 content script.
// 지금은 화면이 없고, 마감을 조회해 캐시에 저장하고 세션 연장 요청을 대신 보낸다.
// KLAS 탭(마일스톤 2)이 여기에 붙는다.

import { deadlineCache } from '@/utils/deadline-cache';
import { extendSession } from '@/utils/klas/api';
import { collectDeadlines } from '@/utils/klas/collect-deadlines';
import { isTabMessage, type ExtensionMessage } from '@/utils/messages';
import { refreshDeadlines } from '@/utils/refresh-deadlines';
import { withReceiverRetry } from '@/utils/send-message';

const send = (message: ExtensionMessage) =>
  withReceiverRetry(() => browser.runtime.sendMessage(message));

export default defineContentScript({
  matches: ['https://klas.kw.ac.kr/*'],
  runAt: 'document_idle',
  async main(ctx) {
    // 로그인한 학생 페이지에서만 동작한다.
    if (!location.pathname.startsWith('/std/')) return;

    // background가 10분마다 맡기는 세션 연장. KLAS와 같은 출처로 보내야 로그인 쿠키가 실린다.
    const onMessage = (message: unknown, _sender: unknown, sendResponse: (r: unknown) => void) => {
      if (!isTabMessage(message)) return false;
      extendSession().then(sendResponse, () => sendResponse(undefined));
      return true;
    };
    browser.runtime.onMessage.addListener(onMessage);
    ctx.onInvalidated(() => browser.runtime.onMessage.removeListener(onMessage));

    if (import.meta.env.DEV) {
      // 개발 빌드에서는 캐시가 바뀔 때마다 요약을 콘솔에 남긴다. 다른 탭이 조회한 결과도 보인다.
      const unwatch = deadlineCache.watch((cache) => {
        const { snapshot, lastError } = cache;
        console.info('[KLAS Helper Plus] 마감 캐시', {
          semester: snapshot?.semester,
          checkedAt: snapshot && new Date(snapshot.checkedAt).toLocaleString(),
          deadlines: snapshot?.deadlines.length,
          failures: snapshot?.failures.length,
          lastError: lastError?.kind ?? null,
        });
      });
      ctx.onInvalidated(unwatch);
    }

    // background와 연결되지 않아도 KLAS 페이지에는 영향이 없게, 오류를 남기고 끝낸다.
    try {
      await send({ type: 'klas/opened' });
      const decision = await refreshDeadlines({
        send,
        collect: (now) => collectDeadlines(now),
        now: Date.now,
      });
      if (import.meta.env.DEV) console.info('[KLAS Helper Plus] 조회 결정', decision.action);
    } catch (error) {
      console.warn('[KLAS Helper Plus] background와 연결하지 못했습니다.', error);
    }
  },
});
