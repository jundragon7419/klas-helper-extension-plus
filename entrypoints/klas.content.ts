// KLAS 페이지에서 실행되는 content script.
// 지금은 화면이 없고, 마감을 조회해 캐시에 저장하고 세션 연장 요청을 대신 보낸다.
// KLAS 탭(마일스톤 2)이 여기에 붙는다.

import { deadlineCache } from '@/utils/deadline-cache';
import type { FetchDecision } from '@/utils/fetch-coordinator';
import { extendSession } from '@/utils/klas/api';
import { collectDeadlines } from '@/utils/klas/collect-deadlines';
import { isTabMessage, type ExtensionMessage } from '@/utils/messages';

const send = (message: ExtensionMessage) => browser.runtime.sendMessage(message);

/** background에 묻고, 이 탭이 조회할 차례면 조회해서 결과를 알린다. */
async function refreshDeadlines(force = false): Promise<FetchDecision> {
  const decision = (await send({ type: 'deadlines/request', force })) as FetchDecision;
  if (decision.action === 'fetch') {
    const outcome = await collectDeadlines(Date.now());
    await send({ type: 'deadlines/report', leaseId: decision.leaseId, outcome });
  }
  return decision;
}

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
    await send({ type: 'klas/opened' });

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

    const decision = await refreshDeadlines();
    if (import.meta.env.DEV) console.info('[KLAS Helper Plus] 조회 결정', decision.action);
  },
});
