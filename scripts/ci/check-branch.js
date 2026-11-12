// PR의 head 브랜치 이름과 본문의 이슈 연결을 검사한다. 규칙은 CONTRIBUTING.md "브랜치" 절에 있다.
// CI의 check 작업이 PR마다 실행하고, tests/check-branch.test.ts가 검사한다.
import { pathToFileURL } from 'node:url';

/** 브랜치 종류. ai-implement 워크플로와 open-ai-pr.sh의 정규식도 이 목록과 같아야 한다. */
export const BRANCH_KINDS = ['feat', 'fix', 'refactor', 'test', 'docs', 'chore'];

export const BRANCH_PATTERN = new RegExp(
  `^(${BRANCH_KINDS.join('|')})/([1-9][0-9]*)-([a-z0-9]+(?:-[a-z0-9]+)*)$`,
);

/** PR 본문에서 `Closes #N`으로 연결한 이슈 번호를 모은다. */
export function closedIssues(body) {
  return [...(body ?? '').matchAll(/\bcloses\s+#(\d+)\b/gi)].map((m) => Number(m[1]));
}

/**
 * @param {object} pr
 * @param {string} pr.head PR head 브랜치 이름
 * @param {string} pr.base PR base 브랜치 이름
 * @param {string | null | undefined} pr.body PR 본문
 * @returns {string[]} 규칙에 어긋난 내용. 비어 있으면 통과.
 */
export function checkPullRequest({ head, base, body }) {
  // 배포 PR은 develop을 그대로 main에 합친다.
  if (base === 'main' && head === 'develop') return [];

  const match = BRANCH_PATTERN.exec(head);
  if (!match) {
    return [
      `브랜치 이름 "${head}"이 규칙과 다릅니다. 형식: <종류>/<이슈 번호>-<짧은 설명>, ` +
        `종류: ${BRANCH_KINDS.join(', ')}, 짧은 설명: 영어 소문자, 숫자, 하이픈`,
    ];
  }
  const issue = Number(match[2]);
  if (!closedIssues(body).includes(issue)) {
    return [`PR 본문에 브랜치의 이슈 번호와 같은 "Closes #${issue}"가 없습니다.`];
  }
  return [];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const errors = checkPullRequest({
    head: process.env.HEAD_REF ?? '',
    base: process.env.BASE_REF ?? '',
    body: process.env.PR_BODY,
  });
  for (const error of errors) console.log(`::error::${error}`);
  if (errors.length > 0) process.exit(1);
  console.log(`브랜치 이름 확인: ${process.env.HEAD_REF}`);
}
