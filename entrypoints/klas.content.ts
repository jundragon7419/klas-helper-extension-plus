// KLAS 페이지에서 실행되는 content script.
// 마감 일정 패널을 띄우고, 마감을 조회하며, 세션 연장 요청을 대신 보낸다.

import { deadlineCache } from '@/utils/deadline-cache';
import { readAccountHash } from '@/utils/klas/account';
import { extendSession } from '@/utils/klas/api';
import { collectDeadlines } from '@/utils/klas/collect-deadlines';
import { isTabMessage, type ExtensionMessage } from '@/utils/messages';
import { refreshDeadlines } from '@/utils/refresh-deadlines';
import { readBackgroundReply, withReceiverRetry } from '@/utils/send-message';
import { mountDeadlineDrawer } from '@/utils/ui/deadline-drawer';

const send = async (message: ExtensionMessage) =>
  readBackgroundReply(await withReceiverRetry(() => browser.runtime.sendMessage(message)));

export default defineContentScript({
  matches: ['https://klas.kw.ac.kr/*'],
  runAt: 'document_idle',
  async main(ctx) {
    // 로그인한 학생 페이지에서만 동작한다.
    if (!location.pathname.startsWith('/std/')) return;

    void mountDeadlineDrawer(ctx).catch((error: unknown) => {
      console.warn('[KLAS Helper Plus] 마감 일정 패널을 열지 못했습니다.', error);
    });

    // background가 10분마다 맡기는 세션 연장. KLAS와 같은 출처로 보내야 로그인 쿠키가 실린다.
    const onMessage = (message: unknown, _sender: unknown, sendResponse: (r: unknown) => void) => {
      if (!isTabMessage(message)) return false;
      extendSession().then(sendResponse, () => sendResponse(undefined));
      return true;
    };
    browser.runtime.onMessage.addListener(onMessage);
    ctx.onInvalidated(() => browser.runtime.onMessage.removeListener(onMessage));

    const accountHash = await readAccountHash();
    if (import.meta.env.DEV && accountHash) {
      // 개발 빌드에서는 캐시가 바뀔 때마다 요약을 콘솔에 남긴다. 다른 탭이 조회한 결과도 보인다.

      const unwatch = deadlineCache.watch((cache) => {
        if (cache.accountHash !== accountHash) return;
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

    // background 메시지 처리에 실패해도 KLAS 페이지에는 영향이 없게, 오류를 남기고 끝낸다.
    try {
      await send({ type: 'klas/opened' });
      const decision = await refreshDeadlines({
        send,
        collect: (now) => collectDeadlines(now),
        now: Date.now,
        accountHash,
        readAccountHash,
      });
      if (import.meta.env.DEV) console.info('[KLAS Helper Plus] 조회 결정', decision.action);
    } catch (error) {
      console.warn('[KLAS Helper Plus] background 요청에 실패했습니다.', error);
    }
  },
});
