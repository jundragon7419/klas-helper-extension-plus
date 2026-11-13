// AI review loop 워크플로가 PR 상태를 보고 다음 단계를 정한다.
// GitHub API 호출은 워크플로가 하고, 이 파일은 모은 자료로 판단만 한다. tests/review-decision.test.ts가 검사한다.

import { parseMessage } from './ai-msg.js';

export const MAX_ROUNDS = 3;

/**
 * ai-msg 메시지인지 본다. 표시 줄은 첫 줄, 또는 멘션 줄 다음 줄에만 온다(AGENTS.md "AI 메시지 형식").
 * 리뷰 본문 안에 인용한 표시 줄 예시는 메시지가 아니다.
 */
export function isAiMessage(body) {
  if (parseMessage(body) !== null) return true;
  const [first = '', second = ''] = body
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.trim());
  const header = /^<!--\s*ai-msg\b/i;
  return header.test(first) || (/^@(claude|codex)$/.test(first) && header.test(second));
}

// Codex 작업 결과 댓글(`View task →` 링크가 있는 일반 댓글)의 두 모양.
// 리뷰 결과: "## 검토 결과" 아래 `[P1]` 같은 지적이나 "문제를 발견하지 못했습니다"(PR #128, #129).
// 코드 수정: "### Summary" 아래 변경 내용과 "커밋했습니다", make_pr(PR #126, #135). 리뷰가 아니라 Codex가 고칠 문제를 찾았다는 뜻이다.
const CODE_CHANGE = [
  /\bCommitted (the )?changes?\b/i,
  /커밋했습니다/,
  /\bmake_pr\b/,
  /\b(follow-up )?pull request (metadata|title)/i,
  /후속 PR/,
];
const REVIEW_RESULT = [
  /^#{1,3}\s*검토 결과/m,
  /Codex Review/,
  /Didn't find any major issues/i,
  /(문제|지적)(를|을) (발견하지|찾지) 못했습니다/,
];
const TASK_TAG = /\[P([0-3])\]/g;

/**
 * Codex 작업 결과 댓글을 나눈다. 현재 head의 파일 링크(`/blob/<head>/`)가 없으면 이 커밋을 본 결과가 아니므로 null.
 * 요약 상태 댓글, 리뷰 응답 댓글, ai-msg 메시지도 null.
 * - review: 리뷰 결과. findings는 `[P0]`~`[P3]` 수, blocking은 그중 P0, P1 수
 * - code-change: Codex가 코드를 고쳐 커밋한 결과. 리뷰로 세지 않는다
 * - other: 둘 다 아님. 리뷰로 세지 않는다
 * @param {string} body
 * @param {string} head
 */
export function classifyCodexTask(body, head) {
  if (!body.includes('View task') || !body.includes(`/blob/${head}/`)) return null;
  if (body.includes('codex-review-state') || body.includes('codex-review-receipt')) return null;
  if (isAiMessage(body)) return null;
  const tags = [...body.matchAll(TASK_TAG)].map((m) => Number(m[1]));
  const counts = { findings: tags.length, blocking: tags.filter((p) => p <= 1).length };
  if (CODE_CHANGE.some((re) => re.test(body))) return { kind: 'code-change', ...counts };
  if (tags.length > 0 || REVIEW_RESULT.some((re) => re.test(body)))
    return { kind: 'review', ...counts };
  return { kind: 'other', ...counts };
}

const time = (at) => Date.parse(at ?? '') || 0;

/**
 * 현재 head에 대한 Codex 결과를 모은다. 머지 게이트와 AI review loop가 같은 기준을 쓴다.
 * code-change가 그 뒤의 리뷰 결과 없이 남아 있으면 unresolvedChange로 돌려준다(리뷰가 없거나 더 오래됨).
 * @param {{head: string, codexBot: string, comments: {id?: number, login: string, body: string, at?: string}[], reviews: {login: string, commitId: string, at?: string}[]}} input
 */
export function codexResults({ head, codexBot, comments, reviews }) {
  const tasks = comments
    .filter((c) => c.login === codexBot)
    .map((c) => ({ ...c, task: classifyCodexTask(c.body, head) }))
    .filter((c) => c.task !== null);
  const reviewTasks = tasks.filter((c) => c.task.kind === 'review');
  const changes = tasks.filter((c) => c.task.kind === 'code-change');

  // 현재 head를 본 리뷰 결과가 남은 시각들
  const reviewedAt = [
    ...reviewTasks.map((c) => time(c.at)),
    ...reviews.filter((r) => r.login === codexBot && r.commitId === head).map((r) => time(r.at)),
    ...comments
      .filter((c) => c.login === codexBot)
      .filter((c) => {
        const state = parseCodexState(c.body);
        if (state?.commit_sha === head && state.status === 'completed') return true;
        return c.body.includes('codex-review-receipt') && c.body.includes(`\`${head.slice(0, 10)}`);
      })
      .map((c) => time(c.at)),
  ];
  const lastReview = reviewedAt.length ? Math.max(...reviewedAt) : null;
  const lastChange = changes.at(-1) ?? null;
  const unresolvedChange =
    lastChange && (lastReview === null || time(lastChange.at) > lastReview) ? lastChange : null;
  return { reviewed: lastReview !== null, reviewTasks, unresolvedChange };
}

/** Codex가 코드를 고친 작업 결과가 남았을 때 사용자에게 남길 안내 */
export function codeChangeNotice({ maintainer, head, url }) {
  return [
    `@${maintainer} Codex가 현재 커밋(${head.slice(0, 7)})에 대해 리뷰 대신 코드를 고친 작업 결과를 남겼습니다: ${url}`,
    'Codex가 고칠 문제를 찾았다는 뜻이라 자동 흐름을 멈춥니다. 작업 결과를 확인하고,',
    '- 반영할 내용이면 이 PR에 `@codex`로 수정 요청을 남기거나 직접 고칩니다.',
    '- 반영하지 않을 내용이면 `@codex review`로 다시 리뷰를 받습니다.',
    '그다음 `ai:needs-human` 라벨을 지우면 자동 흐름이 다시 판단합니다.',
  ].join('\n');
}

/** Codex 요약 댓글의 상태 표시에서 code_review를 꺼낸다. 형식이 다르면 null. */
export function parseCodexState(body) {
  const match = /<!-- codex-review-state:v1 (\{.*?\}) -->/.exec(body ?? '');
  if (!match) return null;
  try {
    return JSON.parse(match[1]).code_review ?? null;
  } catch {
    return null;
  }
}

/** 머지 전에 통과해야 하는 CI 작업(check run 이름). CI 워크플로의 job 이름과 같다. */
export const CI_CHECKS = ['check', 'e2e'];

/**
 * check run 목록을 하나의 상태로 줄인다.
 * 같은 커밋에서 CI가 다시 돌면(PR 본문 수정, 재실행) 취소된 이전 run이 남으므로, id가 있으면 가장 최근 run만 본다.
 * run에 name이 있으면 CI_CHECKS의 이름마다 따로 줄인 뒤 합친다. 하나라도 실패면 실패, 모두 성공이어야 성공이다.
 */
export function summarizeChecks(runs) {
  if (runs.some((r) => typeof r.name === 'string')) {
    const parts = CI_CHECKS.map((name) =>
      summarizeChecks(
        runs
          .filter((r) => r.name === name)
          .map((r) => ({ id: r.id, status: r.status, conclusion: r.conclusion })),
      ),
    );
    if (parts.includes('failure')) return 'failure';
    if (parts.every((p) => p === 'success')) return 'success';
    return parts.every((p) => p === 'missing') ? 'missing' : 'pending';
  }
  if (runs.length === 0) return 'missing';
  if (runs.every((r) => typeof r.id === 'number')) {
    runs = [runs.reduce((a, b) => (b.id > a.id ? b : a))];
  }
  if (runs.some((r) => r.status !== 'completed')) return 'pending';
  return runs.every((r) => r.conclusion === 'success') ? 'success' : 'failure';
}

/**
 * @param {object} input
 * @param {string[]} input.labels PR 라벨
 * @param {boolean} input.open PR이 열려 있는지
 * @param {boolean} input.sameRepo head 브랜치가 같은 저장소인지
 * @param {string} input.head PR head SHA
 * @param {{login: string, body: string}[]} input.comments PR 댓글
 * @param {{id: number, login: string, commitId: string, inlineCount: number}[]} input.reviews PR 리뷰
 * @param {{status: string, conclusion: string | null}[]} input.checkRuns head의 check 결과
 * @param {string} input.codexBot Codex 봇 로그인
 * @param {string} input.handlerBot 처리 표시를 남기는 봇 로그인
 */
export function decideReview(input) {
  const { labels, head, codexBot, handlerBot } = input;
  const none = (reason) => ({ action: 'none', reason, addLabels: [], removeLabels: [] });

  const active = labels.includes('ai:in-progress') || labels.includes('ai:ready');
  if (!input.open || !active || labels.includes('ai:needs-human') || !input.sameRepo) {
    return none('not an active AI PR');
  }

  const handled = (id) =>
    input.comments.some(
      (c) => c.login === handlerBot && c.body.includes(`<!-- ai-handled:${id} -->`),
    );

  const results = codexResults({
    head,
    codexBot,
    comments: input.comments,
    reviews: input.reviews,
  });
  // Codex가 리뷰 대신 코드를 고쳤으면 고칠 문제를 찾았다는 뜻이다. 자동으로 판단하지 않고 사용자에게 넘긴다.
  if (results.unresolvedChange) {
    const back = labels.includes('ai:ready');
    return {
      action: 'halt',
      reason: `codex code-change task ${results.unresolvedChange.id ?? ''}`.trim(),
      notice: results.unresolvedChange.id ?? null,
      addLabels: ['ai:needs-human', ...(back ? ['ai:in-progress'] : [])],
      removeLabels: back ? ['ai:ready'] : [],
    };
  }

  // 지적은 현재 head에 대한 Codex 리뷰의 줄 단위 댓글로 판단한다. 리뷰 본문은 언어와 문구가 바뀔 수 있어 보지 않는다.
  // 작업 결과 댓글로 온 리뷰는 `[P0]`~`[P3]` 표시를 지적으로 본다.
  const reviewFinding =
    input.reviews
      .filter((r) => r.login === codexBot && r.commitId === head && r.inlineCount > 0)
      .at(-1) ?? null;
  const taskFinding = results.reviewTasks.filter((c) => c.task.findings > 0).at(-1) ?? null;
  const finding = reviewFinding
    ? { id: `review-${reviewFinding.id}`, reason: `codex review ${reviewFinding.id}` }
    : taskFinding
      ? { id: `task-${taskFinding.id}`, reason: `codex task review ${taskFinding.id}` }
      : null;

  let state = null;
  for (const c of input.comments) {
    if (c.login !== codexBot) continue;
    state = parseCodexState(c.body) ?? state;
  }
  const passedByState =
    state?.commit_sha === head &&
    state?.status === 'completed' &&
    state?.has_any_findings === false;
  const passedByTask = results.reviewTasks.some((c) => c.task.findings === 0);
  const passed = (passedByState || passedByTask) && !finding;
  const ci = summarizeChecks(input.checkRuns);

  let task = null;
  if (finding && !handled(finding.id)) {
    task = finding;
  } else if (ci === 'failure' && !handled(`ci-${head}`)) {
    task = { id: `ci-${head}`, reason: `CI failed on ${head.slice(0, 7)}` };
  }

  if (task) {
    const back = labels.includes('ai:ready');
    const round = labels.filter((l) => /^ai:round-\d+$/.test(l)).length + 1;
    if (round > MAX_ROUNDS) {
      // ai:ready에서 멈출 때도 ai:in-progress로 되돌린다. 사용자가 ai:needs-human을 지우면 이 라벨로 다시 판단한다.
      return {
        action: 'stop',
        reason: `round limit (${task.reason})`,
        addLabels: ['ai:needs-human', ...(back ? ['ai:in-progress'] : [])],
        removeLabels: back ? ['ai:ready'] : [],
      };
    }
    return {
      action: 'fix',
      reason: `${task.reason}; task=${task.id}; round=${round}`,
      task: task.id,
      round,
      addLabels: [...(back ? ['ai:in-progress'] : []), `ai:round-${round}`],
      removeLabels: back ? ['ai:ready'] : [],
    };
  }

  if (passed && ci === 'success' && !labels.includes('ai:ready')) {
    return {
      action: 'ready',
      reason: 'ready',
      addLabels: ['ai:ready'],
      removeLabels: ['ai:in-progress'],
    };
  }

  const codex = state ? `${String(state.commit_sha).slice(0, 7)}/${state.status}` : 'none';
  return none(`waiting (codex=${codex}, finding=${Boolean(finding)}, ci=${ci})`);
}

/**
 * Codex가 Claude의 ask나 objection에 답하고 재시작을 요청했을 때 PR에서 검토 반영을 다시 시작할지 정한다.
 * 근거 확인(classifyCodexReply)은 호출하는 쪽이 먼저 한다. 회차 제한은 다른 검토 반영과 같이 센다.
 * @param {{labels: string[], open: boolean, sameRepo: boolean, answerId: number}} input
 */
export function decideAnswerRestart({ labels, open, sameRepo, answerId }) {
  const none = (reason) => ({ action: 'none', reason, addLabels: [], removeLabels: [] });
  const active = labels.includes('ai:in-progress') || labels.includes('ai:ready');
  if (!open || !active || !sameRepo) return none('not an active AI PR');
  const round = labels.filter((l) => /^ai:round-\d+$/.test(l)).length + 1;
  if (round > MAX_ROUNDS) return none(`round limit (codex answer ${answerId})`);
  const back = labels.includes('ai:ready');
  return {
    action: 'fix',
    reason: `codex answer ${answerId}; task=answer-${answerId}; round=${round}`,
    task: `answer-${answerId}`,
    round,
    addLabels: [...(back ? ['ai:in-progress'] : []), `ai:round-${round}`],
    removeLabels: ['ai:needs-human', ...(back ? ['ai:ready'] : [])],
  };
}
