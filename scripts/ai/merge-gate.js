// 머지 게이트(commit status `ai-gate`)의 상태를 정한다. develop ruleset이 이 상태를 필수 검사로 요구한다.
// GitHub API 호출은 merge-gate 워크플로가 하고, 이 파일은 모은 자료로 판단만 한다. tests/merge-gate.test.ts가 검사한다.
import { CI_CHECKS, codexResults, summarizeChecks } from './review-decision.js';

export const GATE_CONTEXT = 'ai-gate';

/** Codex 지적 중 머지를 막는 등급. P2 이하는 막지 않는다(AGENTS.md "Review guidelines"). */
const BLOCKING_BADGE = /!\[P[01] Badge\]/;

/**
 * @param {object} input
 * @param {string} input.head PR head SHA
 * @param {string[]} input.labels PR 라벨
 * @param {{id?: number, login: string, body: string, at?: string}[]} input.comments PR 댓글(at은 마지막 수정 시각)
 * @param {{login: string, commitId: string, at?: string}[]} input.reviews PR 리뷰(at은 제출 시각)
 * @param {{login: string, originalCommitId: string, body: string}[]} input.inlineComments 줄 단위 리뷰 댓글
 * @param {{id?: number, status: string, conclusion: string | null}[]} input.checkRuns head의 CI check 결과
 * @param {string} input.codexBot Codex 봇 로그인
 * @returns {{state: 'pending' | 'success' | 'failure', description: string}}
 */
export function decideGate(input) {
  const { head, labels, codexBot } = input;

  if (labels.includes('ai:needs-human')) {
    return { state: 'failure', description: '자동 흐름이 멈춤. 사용자 판단 필요' };
  }

  const ci = summarizeChecks(input.checkRuns);
  if (ci === 'failure') return { state: 'failure', description: 'CI check 실패' };

  const results = codexResults({
    head,
    codexBot,
    comments: input.comments,
    reviews: input.reviews,
  });

  // 현재 head에서 처음 단 지적만 센다. 이전 커밋의 지적은 GitHub가 새 커밋 위치로 옮겨 보여 줄 뿐이다.
  const blocking =
    input.inlineComments.filter(
      (c) => c.login === codexBot && c.originalCommitId === head && BLOCKING_BADGE.test(c.body),
    ).length + results.reviewTasks.reduce((n, c) => n + c.task.blocking, 0);
  if (blocking > 0) {
    return { state: 'failure', description: `Codex P0/P1 지적 ${blocking}건이 현재 커밋에 있음` };
  }
  // Codex가 리뷰 대신 코드를 고친 작업 결과는 고칠 문제를 찾았다는 뜻이다. 그 뒤에 다시 리뷰를 받아야 통과한다.
  if (results.unresolvedChange) {
    return {
      state: 'failure',
      description:
        'Codex가 현재 커밋에 코드 수정 작업을 남김. 확인 뒤 @codex review로 다시 리뷰 필요',
    };
  }

  if (ci !== 'success') return { state: 'pending', description: 'CI check 대기 중' };
  if (!results.reviewed) return { state: 'pending', description: '현재 커밋의 Codex 리뷰 대기 중' };
  if (labels.includes('ai:in-progress')) {
    return { state: 'pending', description: 'AI 자동 흐름 진행 중' };
  }
  return { state: 'success', description: '현재 커밋: Codex 리뷰 완료, P0/P1 없음, CI 통과' };
}

/**
 * PR 상태를 모아 판단하고 head 커밋에 상태를 남긴다. merge-gate 워크플로와 AI review loop가 함께 쓴다.
 * review loop가 GITHUB_TOKEN으로 바꾼 라벨은 다른 워크플로를 부르지 않으므로, 라벨을 바꾼 쪽이 직접 다시 판단한다.
 * @param {{github: any, context: any, core: any, number: number, codexBot: string, runUrl: string}} args
 */
export async function updateGate({ github, context, core, number, codexBot, runUrl }) {
  const repo = context.repo;
  const { data: pr } = await github.rest.pulls.get({ ...repo, pull_number: number });
  if (pr.state !== 'open') {
    core.info(`PR #${number}이 열려 있지 않습니다.`);
    return null;
  }
  const head = pr.head.sha;
  const comments = (
    await github.paginate(github.rest.issues.listComments, { ...repo, issue_number: number })
  ).map((c) => ({ id: c.id, login: c.user?.login ?? '', body: c.body ?? '', at: c.updated_at }));
  const reviews = (
    await github.paginate(github.rest.pulls.listReviews, { ...repo, pull_number: number })
  ).map((r) => ({ login: r.user?.login ?? '', commitId: r.commit_id, at: r.submitted_at }));
  const inlineComments = (
    await github.paginate(github.rest.pulls.listReviewComments, { ...repo, pull_number: number })
  ).map((c) => ({
    login: c.user?.login ?? '',
    originalCommitId: c.original_commit_id,
    body: c.body ?? '',
  }));
  const checkRuns = (
    await github.paginate(github.rest.checks.listForRef, {
      ...repo,
      ref: head,
      filter: 'all',
    })
  )
    .filter((r) => CI_CHECKS.includes(r.name))
    .map((r) => ({ id: r.id, name: r.name, status: r.status, conclusion: r.conclusion }));

  const gate = decideGate({
    head,
    labels: pr.labels.map((l) => l.name),
    comments,
    reviews,
    inlineComments,
    checkRuns,
    codexBot,
  });
  core.info(`#${number} ${head.slice(0, 7)}: ${gate.state} (${gate.description})`);
  await github.rest.repos.createCommitStatus({
    ...repo,
    sha: head,
    state: gate.state,
    context: GATE_CONTEXT,
    description: gate.description,
    target_url: runUrl,
  });
  return gate;
}
