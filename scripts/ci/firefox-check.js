// 기능 PR 본문의 "릴리스 전 Firefox 확인 필요" 체크를 읽는다.
// Firefox label 워크플로가 이 결과로 PR에 firefox-check 라벨을 붙이거나 지우고, 릴리스 PR이 라벨로 확인할 PR을 모은다.
// 규칙은 CONTRIBUTING.md "배포"에 있고, tests/firefox-check.test.ts가 검사한다.

export const FIREFOX_LABEL = 'firefox-check';
export const FIREFOX_CHECK_TEXT = '릴리스 전 Firefox 확인 필요';

/** HTML 주석을 지운다. 양식 안내 문구에 체크 표시 예시가 있어도 체크로 보지 않기 위함이다. */
const stripComments = (body) => body.replace(/<!--[\s\S]*?-->/g, '');

/**
 * 본문에 `- [x] 릴리스 전 Firefox 확인 필요` 줄이 있는지 본다. 체크하지 않은 `- [ ]`는 확인이 필요 없다는 뜻이다.
 * @param {string | null | undefined} body PR 본문
 */
export function needsFirefoxCheck(body) {
  const pattern = new RegExp(`^\\s*[-*] \\[[xX]\\] ${FIREFOX_CHECK_TEXT}\\s*$`, 'm');
  return pattern.test(stripComments(body ?? ''));
}
