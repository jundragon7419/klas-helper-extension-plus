import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  BRANCH_KINDS,
  BRANCH_PATTERN,
  checkPullRequest,
  closedIssues,
} from '../scripts/ci/check-branch.js';

// CI의 브랜치 이름 검사(scripts/ci/check-branch.js)를 검사한다.
const pr = (
  head: string,
  body: string | null = `## 관련 이슈\n\nCloses #112`,
  base = 'develop',
) => ({
  head,
  base,
  body,
});

describe('checkPullRequest', () => {
  it.each(BRANCH_KINDS)('종류 %s를 받는다', (kind) => {
    expect(checkPullRequest(pr(`${kind}/112-check-branch-names`))).toEqual([]);
  });

  it.each([
    ['이슈 번호 없음', 'chore/ai-stop-relay'],
    ['번호 자리에 버전', 'fix/0.1.0-release-readiness'],
    ['허용하지 않는 종류', 'feature/112-check-names'],
    ['대문자', 'fix/112-Check-names'],
    ['밑줄', 'fix/112-check_names'],
    ['설명 없음', 'fix/112'],
    ['끝 하이픈', 'fix/112-check-'],
    ['연속 하이픈', 'fix/112-check--names'],
    ['0으로 시작하는 번호', 'fix/0112-check'],
    ['슬래시 추가', 'fix/112-check/names'],
  ])('%s: 거부한다', (_, head) => {
    const errors = checkPullRequest(pr(head));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('규칙과 다릅니다');
  });

  it('본문에 같은 번호의 Closes가 없으면 거부한다', () => {
    expect(checkPullRequest(pr('fix/112-check', 'Closes #113'))[0]).toContain('Closes #112');
    expect(checkPullRequest(pr('fix/112-check', '#112 관련'))[0]).toContain('Closes #112');
    expect(checkPullRequest(pr('fix/112-check', null))[0]).toContain('Closes #112');
  });

  it('번호 앞부분만 같은 Closes는 인정하지 않는다', () => {
    expect(checkPullRequest(pr('fix/112-check', 'Closes #1120'))).toHaveLength(1);
    expect(checkPullRequest(pr('fix/11-check', 'Closes #112'))).toHaveLength(1);
  });

  it('Closes가 여러 개면 그중 하나만 맞아도 통과한다', () => {
    expect(checkPullRequest(pr('fix/112-check', 'Closes #100\nCloses #112'))).toEqual([]);
  });

  it('develop에서 main으로 가는 배포 PR은 검사하지 않는다', () => {
    expect(checkPullRequest(pr('develop', '', 'main'))).toEqual([]);
  });

  it('develop을 다른 브랜치로 보내는 PR은 검사한다', () => {
    expect(checkPullRequest(pr('develop', '', 'develop'))).toHaveLength(1);
    expect(checkPullRequest(pr('hotfix', '', 'main'))).toHaveLength(1);
  });
});

describe('closedIssues', () => {
  it('대소문자와 상관없이 Closes #N을 모은다', () => {
    expect(closedIssues('closes #1, CLOSES #22\nCloses  #3')).toEqual([1, 22, 3]);
  });
});

// 브랜치 종류는 세 곳에 있다. 한 곳만 바뀌면 자동 흐름의 PR이 CI에서 막히거나 규칙 밖 이름이 통과한다.
describe('다른 검사와의 일치', () => {
  const kinds = `(${BRANCH_KINDS.join('|')})`;

  it.each(['.github/workflows/ai-implement.yml', 'scripts/ai/open-ai-pr.sh'])(
    '%s의 정규식이 같은 종류와 설명 형식을 쓴다',
    (file) => {
      const text = readFileSync(file, 'utf8');
      expect(text).toContain(`^${kinds}/\${ISSUE}-[a-z0-9]+(-[a-z0-9]+)*$`);
    },
  );

  it('CONTRIBUTING.md의 브랜치 표에 모든 종류가 있다', () => {
    const text = readFileSync('CONTRIBUTING.md', 'utf8');
    for (const kind of BRANCH_KINDS) expect(text).toContain(`| \`${kind}/\` |`);
  });

  it('BRANCH_PATTERN이 종류 목록 밖의 종류를 받지 않는다', () => {
    for (const kind of BRANCH_KINDS) expect(BRANCH_PATTERN.test(`${kind}/1-a`)).toBe(true);
    expect(BRANCH_PATTERN.test('style/1-a')).toBe(false);
  });
});
