import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FIREFOX_CHECK_TEXT, needsFirefoxCheck } from '../scripts/ci/firefox-check.js';

// 기능 PR의 "릴리스 전 Firefox 확인 필요" 체크 읽기(scripts/ci/firefox-check.js)를 검사한다.
const template = readFileSync('.github/PULL_REQUEST_TEMPLATE.md', 'utf8');

describe('needsFirefoxCheck', () => {
  it('PR 양식 그대로(체크 안 함)면 확인이 필요 없다', () => {
    expect(template).toContain(`- [ ] ${FIREFOX_CHECK_TEXT}`);
    expect(needsFirefoxCheck(template)).toBe(false);
  });

  it('양식에서 체크하면 확인이 필요하다', () => {
    const checked = template.replace(`- [ ] ${FIREFOX_CHECK_TEXT}`, `- [x] ${FIREFOX_CHECK_TEXT}`);
    expect(needsFirefoxCheck(checked)).toBe(true);
    expect(needsFirefoxCheck(checked.replace('[x]', '[X]'))).toBe(true);
  });

  it('주석 안의 체크와 다른 문장 속 문구는 체크로 보지 않는다', () => {
    expect(needsFirefoxCheck(`<!-- - [x] ${FIREFOX_CHECK_TEXT} -->`)).toBe(false);
    expect(needsFirefoxCheck(`- [x] ${FIREFOX_CHECK_TEXT}인지 모르겠음`)).toBe(false);
    expect(needsFirefoxCheck(null)).toBe(false);
  });

  it('릴리스 PR 양식에 Firefox 확인 목록과 라벨 목록 링크가 있다', () => {
    const release = readFileSync('.github/PULL_REQUEST_TEMPLATE/release.md', 'utf8');
    for (const item of ['설치', '사이트 권한', 'KLAS 탭 열기', '마감 목록', '세션 연장']) {
      expect(release).toContain(`- [ ] ${item}:`);
    }
    expect(release).toContain('label%3Afirefox-check');
  });
});
