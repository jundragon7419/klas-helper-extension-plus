// KLAS 페이지에서 실행되는 content script.
// 지금은 화면이 없고, 개발 빌드에서만 KLAS API 확인을 한 번 실행한다.
// 조회 조정과 캐시(#23), KLAS 탭(마일스톤 2)이 여기에 붙는다.

import { runSelfCheck } from '@/utils/klas/self-check';

/** 같은 탭에서 확인을 한 번만 하려고 KLAS 페이지의 sessionStorage에 남기는 표시 */
const SELF_CHECK_KEY = 'klasHelperPlus:selfCheckDone';

export default defineContentScript({
  matches: ['https://klas.kw.ac.kr/*'],
  runAt: 'document_idle',
  async main() {
    // 로그인한 학생 페이지에서만 동작한다.
    if (!location.pathname.startsWith('/std/')) return;

    if (import.meta.env.DEV && sessionStorage.getItem(SELF_CHECK_KEY) === null) {
      sessionStorage.setItem(SELF_CHECK_KEY, '1');
      const lines = await runSelfCheck();
      console.info('[KLAS Helper Plus] KLAS API 확인 (개발 빌드)');
      console.table(lines);
    }
  },
});
