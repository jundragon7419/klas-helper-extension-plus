// 실제 PR에 달린 Codex 작업 결과 댓글(`View task →`)의 모양. 링크의 커밋 SHA만 바꿔 쓴다.
// 리뷰 결과: PR #128(지적 없음), #129([P1] 지적). 코드 수정: PR #126(한국어), #135(영어).

const link = (sha: string, path: string) =>
  `[${path}L1-L9](https://github.com/jundragon7419/klas-helper-extension-plus/blob/${sha}/${path}#L1-L9)`;
const task = '[View task →](https://chatgpt.com/s/cd_6af67091e16c819186ae5ba5c61b4a38)';

/** PR #128: 지적 없는 리뷰 결과 */
export const reviewNoFindings = (sha: string) =>
  [
    '## 검토 결과',
    '',
    `현재 head 커밋 \`${sha}\` 기준으로 **머지를 막을 P0/P1 문제를 발견하지 못했습니다.**`,
    '',
    `- \`ai-gate\`는 현재 head의 Codex 검토 여부와 P0/P1 지적을 함께 판단합니다. ${link(sha, 'scripts/ai/merge-gate.js')}`,
    '',
    ` ${task}`,
  ].join('\n');

/** PR #129: [P1] 지적이 있는 리뷰 결과 */
export const reviewWithP1 = (sha: string) =>
  [
    '## 검토 결과',
    '',
    '- **[P1] 재시작 전에 `issue` 메타데이터가 현재 이슈와 일치하는지 확인해야 합니다.**  ',
    `  \`classifyCodexReply\`는 \`reply-to\`만 확인합니다. ${link(sha, 'scripts/ai/relay.js')}`,
    '',
    ` ${task}`,
  ].join('\n');

/** PR #126: Codex가 코드를 고쳐 커밋한 결과(한국어) */
export const codeChangeKo = (sha: string) =>
  [
    '### Summary',
    '',
    `* AI review loop의 기본 \`GITHUB_TOKEN\` 권한을 읽기 전용으로 제한했습니다. ${link(sha, '.github/workflows/ai-review-loop.yml')}`,
    '* 변경 사항을 `085be76` (`Restrict the AI review Actions token to read access`)으로 커밋했습니다.',
    '* 원 PR #126 위에 적용할 후속 PR 제목과 본문을 `make_pr`로 생성했습니다.',
    '',
    '**Testing**',
    '',
    '* ✅ `npm run format:check`',
    '',
    ` ${task}`,
  ].join('\n');

/** PR #135: Codex가 코드를 고쳐 커밋한 결과(영어) */
export const codeChangeEn = (sha: string) =>
  [
    '### Summary',
    `* Updated the Codex re-review helper to ignore stale 👀 reactions. ${link(sha, 'scripts/ai/request-review.sh')}`,
    '* Committed the changes as `8cb0bbd` (`Ignore stale Codex review reactions`) and created the follow-up pull request metadata with the same title.',
    '',
    '**Testing**',
    '* ✅ `npm run lint`',
    '',
    ` ${task}`,
  ].join('\n');
