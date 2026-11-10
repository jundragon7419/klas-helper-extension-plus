// KLAS 페이지에서 실행되는 content script.
// 마감 일정 패널을 띄우고, 마감을 조회하며, 세션 연장 요청을 대신 보낸다.

import { extendSession } from '@/utils/klas/api';
import { isTabMessage, type ExtensionMessage } from '@/utils/messages';
import { readBackgroundReply, withReceiverRetry } from '@/utils/send-message';
import { mountDeadlineDrawer } from '@/utils/ui/deadline-drawer';
import { mountSessionIndicator } from '@/utils/ui/session-indicator';
import '@/utils/ui/session-indicator.css';

const send = async (message: ExtensionMessage) =>
  readBackgroundReply(await withReceiverRetry(() => browser.runtime.sendMessage(message)));

export default defineContentScript({
  matches: ['https://klas.kw.ac.kr/*'],
  runAt: 'document_idle',
  async main(ctx) {
    // 로그인한 학생 페이지에서만 동작한다.
    if (!location.pathname.startsWith('/std/')) return;

    void mountSessionIndicator(ctx).catch((error: unknown) => {
      console.warn('[KLAS Helper Plus] 자동 연장 표시를 설정하지 못했습니다.', error);
    });

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

    try {
      await send({ type: 'klas/opened' });
    } catch (error) {
      console.warn('[KLAS Helper Plus] 세션 연장 대상을 등록하지 못했습니다.', error);
    }
  },
});
