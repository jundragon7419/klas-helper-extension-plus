import { OPEN_DEADLINE_LIST } from '@/utils/klas/deadline-navigation';
import { LIST_PAGES } from '@/utils/klas/deadlines';

declare const appModule: {
  goLctrumBoard?: (path: string, semester: string, subject: string) => void;
};
declare const setLctrumInfo: (group: string, semester: string, subject: string) => void;
declare const linkUrl: (path: string) => void;
const allowedPaths = new Set(Object.values(LIST_PAGES));

export default defineContentScript({
  matches: ['https://klas.kw.ac.kr/std/*'],
  world: 'MAIN',
  main() {
    const navigate = (event: Event) => {
      if (event.defaultPrevented) return;
      const detail = (event as CustomEvent<unknown>).detail;
      if (typeof detail !== 'string') return;
      const [path, semester, subject] = detail.split('|');
      if (
        !path ||
        !allowedPaths.has(path) ||
        !semester ||
        !/^\d{4},[1-4]$/.test(semester) ||
        !subject ||
        !/^[\w-]+$/.test(subject)
      )
        return;

      if (typeof appModule !== 'undefined' && typeof appModule.goLctrumBoard === 'function') {
        appModule.goLctrumBoard(path, semester, subject);
      } else if (typeof setLctrumInfo === 'function' && typeof linkUrl === 'function') {
        // KLAS 목록은 POST 필드보다 브라우저에 저장한 학기와 과목을 먼저 쓴다.
        setLctrumInfo('', semester, subject);
        linkUrl(path);
      } else {
        return;
      }
      event.preventDefault();
    };
    document.addEventListener(OPEN_DEADLINE_LIST, navigate);
  },
});
