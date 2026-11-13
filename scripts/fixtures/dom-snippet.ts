// 브라우저 개발자 도구 콘솔에 붙여 넣는 KLAS 화면 DOM 발췌 스크립트의 진입점.
// `npm run fixtures:dom-snippet`이 이 파일을 묶어 local-data/klas-dom-snippet.js를 만든다.
// 붙여 넣으면 `klasDom(선택자, 페이지 이름, 남길 낱말)` 함수가 생긴다. 사용법은 tests/fixtures/klas/README.md에 있다.

import {
  anonymizeDom,
  formatDomFixture,
  PAGE_NAME_PATTERN,
  type DomAnonymizeResult,
} from './anonymize-dom.ts';

declare global {
  interface Window {
    klasDom?: (selector: string, page: string, keepText?: string[]) => DomAnonymizeResult | null;
  }
}

const tag = '[KLAS DOM]';

function download(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/html' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function today(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

window.klasDom = (selector, page, keepText = []) => {
  if (location.hostname !== 'klas.kw.ac.kr') {
    console.error(`${tag} KLAS(klas.kw.ac.kr)에 로그인한 탭에서 실행하세요.`);
    return null;
  }
  if (!PAGE_NAME_PATTERN.test(page)) {
    console.error(`${tag} 페이지 이름은 영어 소문자, 숫자, 하이픈만 씁니다. 예: online-lectures`);
    return null;
  }
  const matches = document.querySelectorAll(selector);
  const root = matches[0];
  if (!root) {
    console.error(`${tag} 선택자에 맞는 요소가 없습니다: ${selector}`);
    return null;
  }
  if (matches.length > 1) {
    console.warn(`${tag} 맞는 요소가 ${matches.length}개라 첫 번째만 발췌합니다.`);
  }
  const result = anonymizeDom(root, keepText);
  console.log(
    `${tag} 자리표시값으로 바꾼 한글 낱말(남길 화면 이름표가 있으면 세 번째 인자에 넣으세요)`,
    result.replacedWords,
  );
  if (result.leaks.length > 0) {
    console.error(`${tag} 개인정보 형식이 남아 있어 파일을 만들지 않았습니다.`, result.leaks);
    return result;
  }
  const info = { page, path: location.pathname, selector, collectedOn: today(), keepText };
  download(`${page}.html`, formatDomFixture(info, result.html));
  console.log(`${tag} ${page}.html을 내려받았습니다. tests/fixtures/klas/dom/에 넣으세요.`);
  return result;
};

console.log(
  `${tag} 준비됐습니다. 예: klasDom('.tablelistbox', 'online-lectures', ['주차', '강의영상'])`,
);
