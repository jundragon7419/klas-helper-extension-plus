// 머지 게이트(commit status `ai-gate`)의 상태를 정한다. develop ruleset이 이 상태를 필수 검사로 요구한다.
// GitHub API 호출은 merge-gate 워크플로가 하고, 이 파일은 모은 자료로 판단만 한다. tests/merge-gate.test.ts가 검사한다.
import { parseCodexState, summarizeChecks } from './review-decision.js';
import { parseMessage } from './ai-msg.js';

export const GATE_CONTEXT = 'ai-gate';

/** Codex 지적 중 머지를 막는 등급. P2 이하는 막지 않는다(AGENTS.md "Review guidelines"). */
const BLOCKING_BADGE = /!\[P[01] Badge\]/;
/** 작업 결과 댓글 형태의 리뷰에서 지적 등급 표시. 예: `**[P1] 제목**` */
const BLOCKING_TAG = /\[P[01]\]/g;

/**
 * Codex가 리뷰를 GitHub 리뷰가 아닌 작업 결과 댓글로 남긴 경우(`View task →` 링크가 있는 일반 댓글).
 * 현재 head의 파일 링크(`/blob/<head>/`)가 있어야 현재 커밋을 본 것으로 인정한다.
 * ai-msg 메시지, 요약 상태 댓글, 리뷰 응답 댓글은 제외한다.
 */
function taskReviews({ head, comments, codexBot }) {
  return comments.filter(
    (c) =>
      c.login === codexBot &&
      c.body.includes('View task') &&
      c.body.includes(`/blob/${head}/`) &&
      !c.body.includes('codex-review-state') &&
      !c.body.includes('codex-review-receipt') &&
      !/<!--\s*ai-msg/i.test(c.body) &&
      parseMessage(c.body) === null,
  );
}

/**
 * Codex가 현재 head를 검토했는지 본다. 요약 댓글의 상태 표시, 리뷰 객체, `@codex review` 응답,
 * 현재 head를 가리키는 작업 결과 댓글 중 하나면 된다.
 */
function reviewedHead({ head, comments, reviews, codexBot }) {
  const short = head.slice(0, 10);
  return (
    taskReviews({ head, comments, codexBot }).length > 0 ||
    reviews.some((r) => r.login === codexBot && r.commitId === head) ||
    comments.some((c) => {
      if (c.login !== codexBot) return false;
      const state = parseCodexState(c.body);
      if (state?.commit_sha === head && state.status === 'completed') return true;
      return c.body.includes('codex-review-receipt') && c.body.includes(`\`${short}`);
    })
  );
}

/**
 * @param {object} input
 * @param {string} input.head PR head SHA
 * @param {string[]} input.labels PR 라벨
 * @param {{login: string, body: string}[]} input.comments PR 댓글
 * @param {{login: string, commitId: string}[]} input.reviews PR 리뷰
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

  // 현재 head에서 처음 단 지적만 센다. 이전 커밋의 지적은 GitHub가 새 커밋 위치로 옮겨 보여 줄 뿐이다.
  const blocking =
    input.inlineComments.filter(
      (c) => c.login === codexBot && c.originalCommitId === head && BLOCKING_BADGE.test(c.body),
    ).length +
    taskReviews({ head, comments: input.comments, codexBot }).reduce(
      (n, c) => n + (c.body.match(BLOCKING_TAG)?.length ?? 0),
      0,
    );
  if (blocking > 0) {
    return { state: 'failure', description: `Codex P0/P1 지적 ${blocking}건이 현재 커밋에 있음` };
  }

  if (ci !== 'success') return { state: 'pending', description: 'CI check 대기 중' };
  if (!reviewedHead(input))
    return { state: 'pending', description: '현재 커밋의 Codex 리뷰 대기 중' };
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
  ).map((c) => ({ login: c.user?.login ?? '', body: c.body ?? '' }));
  const reviews = (
    await github.paginate(github.rest.pulls.listReviews, { ...repo, pull_number: number })
  ).map((r) => ({ login: r.user?.login ?? '', commitId: r.commit_id }));
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
      check_name: 'check',
      filter: 'all',
    })
  ).map((r) => ({ id: r.id, status: r.status, conclusion: r.conclusion }));

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
