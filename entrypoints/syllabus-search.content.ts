import { enableSyllabusSearchEnter } from '@/utils/klas/syllabus-search';

// 학부 강의계획서 검색 화면에서 Enter로 조회한다. 다른 content script와 분리해 이 화면에서만 로드한다.
export default defineContentScript({
  matches: ['https://klas.kw.ac.kr/std/cps/atnlc/LectrePlanStdPage.do*'],
  runAt: 'document_idle',
  main(ctx) {
    ctx.onInvalidated(enableSyllabusSearchEnter(document));
  },
});
