// AI review loop 워크플로가 PR 상태를 보고 다음 단계를 정한다.
// GitHub API 호출은 워크플로가 하고, 이 파일은 모은 자료로 판단만 한다. tests/review-decision.test.ts가 검사한다.

import { parseMessage } from './ai-msg.js';
import {
  decideTriage,
  inlineFinding,
  MAX_TRIAGES,
  parseTriage,
  taskFindings,
} from './codex-requests.js';

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
// 코드 수정은 문구 하나하나 대신 넓은 기준으로 본다(#145에서 "커밋으로 저장했습니다"를 놓침).
// 커밋 SHA(백틱 안 7~40자리 16진수)와 커밋했다는 말이 함께 있거나, PR을 만들었다는 말이 있거나, make_pr.
// 리뷰 결과도 "현재 head 커밋 `0c8f02e` 기준"처럼 SHA를 쓰므로 "커밋"이라는 낱말만으로는 보지 않는다.
const COMMIT_SHA = /`[0-9a-f]{7,40}`/;
// 커밋도 완료 보고(과거형)만 본다. "커밋을 생성하기 전에", "commit the changes" 같은 권고는 코드 수정이 아니다(#149).
const COMMIT_WORD =
  /커밋(했|하였|으로 (저장했|남겼|만들었)|을 (만들었|생성했|남겼))|\bcommitted\b/i;
// PR은 "만들었다"는 완료 보고만 본다. "PR을 열지 못한 경우"처럼 리뷰가 PR 생성을 다루는 문장은 코드 수정이 아니다(#149).
const CODE_CHANGE = [
  /\bmake_pr\b/,
  /(PR|Pull Request|풀 리퀘스트)(을|를)? ?(생성했|만들었|열었)/i,
  /\b(created|opened|prepared) (a |the )?(follow-up )?(PR|pull request)\b/i,
];
const isCodeChange = (body) =>
  (COMMIT_SHA.test(body) && COMMIT_WORD.test(body)) || CODE_CHANGE.some((re) => re.test(body));
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
  if (isCodeChange(body)) return { kind: 'code-change', ...counts };
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
 * AI review loop가 PR에서 다음에 할 일을 정한다(docs/AI-COLLABORATION.md "흐름"의 4).
 * - CI 실패: Claude가 바로 고친다(ci-<head>). 고친 뒤에도 두 번 연속 실패하면 멈춘다
 * - 현재 커밋 리뷰에 지적이 있음: Codex에게 리뷰 정리를 요청한다(triage). Codex의 change가 Claude를 부른다
 *   이미 요청한 커밋이면 기다리고, 앞 회차에서 넘긴 지적이 다시 나오거나 정리 횟수를 넘으면 멈춘다
 * - Codex가 리뷰 대신 코드를 고침: 멈춘다
 * - 지적 없음, CI 성공: ai:ready
 * @param {ReviewInput} input
 */
export function decideReview(input) {
  const { labels, head, codexBot, handlerBot } = input;
  const none = (reason) => ({ action: 'none', reason, addLabels: [], removeLabels: [] });

  const active = labels.includes('ai:in-progress') || labels.includes('ai:ready');
  if (!input.open || !active || labels.includes('ai:needs-human') || !input.sameRepo) {
    return none('not an active AI PR');
  }
  const back = labels.includes('ai:ready');
  const halt = (reason, message, extra = {}) => ({
    action: 'halt',
    reason,
    message,
    ...extra,
    addLabels: ['ai:needs-human', ...(back ? ['ai:in-progress'] : [])],
    removeLabels: back ? ['ai:ready'] : [],
  });

  const handledIds = input.comments
    .filter((c) => c.login === handlerBot)
    .flatMap((c) => [...c.body.matchAll(/<!-- ai-handled:([^ ]+) -->/g)].map((m) => m[1]));
  const handled = (id) => handledIds.includes(id);

  const results = codexResults({
    head,
    codexBot,
    comments: input.comments,
    reviews: input.reviews,
  });
  // Codex가 리뷰 대신 코드를 고쳤으면 고칠 문제를 찾았다는 뜻이다. 자동으로 판단하지 않고 사용자에게 넘긴다.
  if (results.unresolvedChange) {
    return halt(`codex code-change task ${results.unresolvedChange.id ?? ''}`.trim(), null, {
      notice: results.unresolvedChange.id ?? null,
    });
  }

  const ci = summarizeChecks(input.checkRuns);
  if (ci === 'failure' && !handled(`ci-${head}`)) {
    // 바로 앞 두 처리가 모두 CI 수정이었다면 고친 뒤에도 두 번 연속 실패한 것이다.
    if (handledIds.length >= 2 && handledIds.slice(-2).every((id) => id.startsWith('ci-'))) {
      return halt(
        `CI failed again on ${head.slice(0, 7)}`,
        `CI가 Claude 수정 뒤에도 두 번 연속 실패했습니다(현재 커밋 ${head.slice(0, 7)}).`,
      );
    }
    return {
      action: 'fix',
      reason: `CI failed on ${head.slice(0, 7)}; task=ci-${head}`,
      task: `ci-${head}`,
      addLabels: back ? ['ai:in-progress'] : [],
      removeLabels: back ? ['ai:ready'] : [],
    };
  }

  // 현재 커밋의 Codex 지적: 줄 단위 지적과 작업 결과 리뷰의 [P0]~[P3].
  // 이전 커밋에서 Resolve되지 않은 P0/P1은 머지 게이트가 막는다(#139). 여기서 다시 넘기면 고친 뒤에도 반복으로 멈춘다.
  let findings = [
    ...(input.inlineComments ?? [])
      .filter((c) => c.login === codexBot && c.originalCommitId === head)
      .map(inlineFinding)
      .filter((f) => f !== null),
    ...results.reviewTasks.flatMap((c) => taskFindings({ body: c.body, url: c.url ?? null })),
  ];
  let state = null;
  for (const c of input.comments) {
    if (c.login !== codexBot) continue;
    state = parseCodexState(c.body) ?? state;
  }
  const stateHead = state?.commit_sha === head && state?.status === 'completed' ? state : null;

  const triages = input.comments
    .filter((c) => c.login === input.maintainer)
    .map((c) => ({ id: c.id, ...parseTriage(c.body) }))
    .filter((x) => x.head !== undefined);
  // 이 커밋의 정리 요청에 Codex가 change로 답했고 Claude가 처리했는데 커밋이 그대로면,
  // 바꿀 항목 없이 P2, P3을 넘기기로 한 것이다. P0/P1이 남았으면 멈추고, 아니면 남은 지적은 받아들인 것으로 본다.
  const settled = triages
    .filter((tr) => tr.head === head)
    .some((tr) =>
      input.comments.some((c) => {
        if (c.login !== codexBot) return false;
        const meta = parseMessage(c.body)?.meta;
        return (
          meta?.type === 'change' && Number(meta['reply-to']) === tr.id && handled(`change-${c.id}`)
        );
      }),
    );
  if (settled && findings.length > 0) {
    const blocking = findings.filter((f) => f.level <= 1);
    if (blocking.length > 0) {
      return halt(
        'blocking findings left',
        `리뷰 정리 뒤에도 커밋이 바뀌지 않았고 P0/P1 지적이 남았습니다: ${blocking.map((f) => f.title).join(', ')}`,
      );
    }
    findings = [];
  }

  if (results.reviewed && findings.length > 0) {
    const next = decideTriage({ head, findings, triages });
    if (next.kind === 'wait') return none(`triage requested for ${head.slice(0, 7)}`);
    if (next.kind === 'repeat') {
      const list = next.repeated.map((f) => `[P${f.level}] ${f.title}`).join(', ');
      return halt(
        'finding repeated',
        `앞 회차에서 고치기로 넘긴 Codex 지적이 다시 나왔습니다: ${list}`,
      );
    }
    if (next.kind === 'limit') {
      return halt(
        'triage limit',
        `리뷰 정리를 ${MAX_TRIAGES}회 했지만 Codex 지적이 남았습니다(현재 커밋 ${head.slice(0, 7)}).`,
      );
    }
    return {
      action: 'triage',
      reason: `${findings.length} findings on ${head.slice(0, 7)}`,
      findings,
      addLabels: back ? ['ai:in-progress'] : [],
      removeLabels: back ? ['ai:ready'] : [],
    };
  }

  const passed =
    results.reviewed && findings.length === 0 && (settled || stateHead?.has_any_findings !== true);
  if (passed && ci === 'success' && !labels.includes('ai:ready')) {
    return {
      action: 'ready',
      reason: 'ready',
      addLabels: ['ai:ready'],
      removeLabels: ['ai:in-progress'],
    };
  }

  const codex = state ? `${String(state.commit_sha).slice(0, 7)}/${state.status}` : 'none';
  return none(`waiting (codex=${codex}, findings=${findings.length}, ci=${ci})`);
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
