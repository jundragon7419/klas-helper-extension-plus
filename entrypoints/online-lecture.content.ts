// 온라인 강의 목록 화면 전용 content script.
// 진도율 100%인 강의를 화면에서만 숨기고 다시 표시하는 버튼을 붙인다.

import { watchCompletedLectureFilter } from '@/utils/ui/online-lecture-filter';
import '@/utils/ui/online-lecture-filter.css';

export default defineContentScript({
  matches: ['https://klas.kw.ac.kr/std/lis/evltn/OnlineCntntsStdPage.do*'],
  runAt: 'document_idle',
  main(ctx) {
    try {
      ctx.onInvalidated(watchCompletedLectureFilter(document));
    } catch (error) {
      console.warn('[KLAS Helper Plus] 완료 강의 숨기기를 설정하지 못했습니다.', error);
    }
  },
});
