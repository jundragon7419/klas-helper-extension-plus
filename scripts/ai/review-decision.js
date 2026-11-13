// AI review loop 워크플로가 PR 상태를 보고 다음 단계를 정한다.
// GitHub API 호출은 워크플로가 하고, 이 파일은 모은 자료로 판단만 한다. tests/review-decision.test.ts가 검사한다.

export const MAX_ROUNDS = 3;

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

  // 지적은 현재 head에 대한 Codex 리뷰의 줄 단위 댓글로 판단한다. 리뷰 본문은 언어와 문구가 바뀔 수 있어 보지 않는다.
  const finding =
    input.reviews
      .filter((r) => r.login === codexBot && r.commitId === head && r.inlineCount > 0)
      .at(-1) ?? null;

  let state = null;
  for (const c of input.comments) {
    if (c.login !== codexBot) continue;
    state = parseCodexState(c.body) ?? state;
  }
  const passed =
    state?.commit_sha === head &&
    state?.status === 'completed' &&
    state?.has_any_findings === false &&
    !finding;
  const ci = summarizeChecks(input.checkRuns);

  let task = null;
  if (finding && !handled(`review-${finding.id}`)) {
    task = { id: `review-${finding.id}`, reason: `codex review ${finding.id}` };
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
