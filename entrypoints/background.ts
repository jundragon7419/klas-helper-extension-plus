import { createFetchCoordinator } from '@/utils/fetch-coordinator';
import { isExtensionMessage } from '@/utils/messages';

export default defineBackground(() => {
  const coordinator = createFetchCoordinator();

  browser.runtime.onInstalled.addListener(({ reason }) => {
    console.log(`[KLAS Helper Plus] installed (${reason})`);
  });

  browser.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    const tabId = sender.tab?.id;
    if (!isExtensionMessage(message) || tabId === undefined) return false;

    const handle =
      message.type === 'deadlines/request'
        ? coordinator.request(tabId, message.force ?? false)
        : coordinator.report(tabId, message.leaseId, message.outcome);
    // Chrome과 Firefox 모두에서 비동기로 답하려고 sendResponse를 쓰고 true를 돌려준다.
    handle.then(sendResponse, (error: unknown) => {
      console.error('[KLAS Helper Plus] message failed', error);
      sendResponse(undefined);
    });
    return true;
  });

  // 조회 중인 탭이 닫히면 조회권을 돌려받아, 다른 KLAS 탭이 바로 이어받을 수 있게 한다.
  browser.tabs.onRemoved.addListener((tabId) => {
    void coordinator.releaseTab(tabId);
  });
});
