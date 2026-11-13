// 사용자가 PR 결과를 바꾸고 싶을 때의 흐름(PR 수정 요청)을 판단한다.
// 사용자 `@codex` 요청 → Codex `change`(계획 개정 포함) → AI review loop가 Claude 수정 실행 → Claude `report`.
// GitHub API 호출은 워크플로가 하고, 이 파일은 모은 댓글로 판단만 한다. tests/change.test.ts가 검사한다.

import { validateMessage } from './ai-msg.js';

/** PR 하나에서 실행할 수 있는 change 수. */
export const MAX_CHANGES = 3;

const CHANGE_HEADER_RE = /<!--\s*ai-msg:\S*\s+type=change\b/i;

/**
 * 이슈와 PR 스레드에서 받아들인 계획 개정(plan-rev, change)을 rev 순으로 모은다.
 * 형식이 맞고 보낼 수 있는 계정이 보낸 것 중 다음만 센다. 실행하지 않은 change가 계획이나 횟수에 들어가지 않게 한다.
 * - plan-rev: 이슈 스레드에 있고, issue 값이 이 이슈이고, reply-to가 이슈에 먼저 달린 메인테이너 댓글
 * - change: PR 스레드에 있고, issue와 pr 값이 맞고, reply-to가 PR에 먼저 달린 메인테이너 댓글이고,
 *   rev가 앞서 받아들인 change보다 크고 그 전에 달린 plan-rev보다 작지 않고, PR당 MAX_CHANGES회 안
 * @param {{issue: number, pr?: number | null, issueComments: {id: number, login: string, body: string}[], prComments?: {id: number, login: string, body: string}[], roles: import('./relay.js').Roles}} input
 */
export function collectRevisions({ issue, pr = null, issueComments, prComments = [], roles }) {
  const read = (list, type) =>
    list
      .map((c) => ({ c, ...validateMessage(c, roles) }))
      .filter(
        ({ message, errors }) =>
          message &&
          !errors.length &&
          message.meta.type === type &&
          Number(message.meta.issue) === issue,
      )
      .filter(({ c, message }) => {
        const replyTo = Number(message.meta['reply-to']);
        return list.some(
          (r) => r.id === replyTo && r.id < c.id && roles.maintainer.includes(r.login),
        );
      });

  const plans = read(issueComments, 'plan-rev').map(({ c, message }) => ({
    id: c.id,
    where: 'issue',
    type: 'plan-rev',
    rev: Number(message.meta.rev),
    fields: message.fields,
  }));
  const changes = [];
  const candidates = pr === null ? [] : read(prComments, 'change');
  for (const { c, message } of candidates.sort((a, b) => a.c.id - b.c.id)) {
    if (changes.length >= MAX_CHANGES || Number(message.meta.pr) !== pr) continue;
    const rev = Number(message.meta.rev);
    const lastChange = Math.max(0, ...changes.map((r) => r.rev));
    const lastPlan = Math.max(0, ...plans.filter((r) => r.id < c.id).map((r) => r.rev));
    if (rev <= lastChange || rev < lastPlan) continue;
    changes.push({ id: c.id, where: 'pr', type: 'change', rev, fields: message.fields });
  }
  return [...plans, ...changes].sort((a, b) => a.rev - b.rev || a.id - b.id);
}

/**
 * PR 댓글 하나가 실행할 change인지 판단한다.
 * - none: change가 아니거나, 보낼 수 없는 계정이 보냈거나(공개 저장소라 무시한다), 이미 처리함
 * - invalid: 형식 오류, PR이나 이슈 번호가 다름, 근거 사용자 댓글이 없음, rev가 최신이 아님
 * - limit: 이 PR에서 change가 MAX_CHANGES회를 넘음
 * - run: 실행한다
 * @param {object} input
 * @param {{id: number, login: string, body: string}} input.comment 판단할 댓글
 * @param {{id: number, login: string, body: string}[]} input.comments PR 스레드 댓글(시간순, comment 포함 가능)
 * @param {{id: number, login: string, body: string}[]} input.issueComments PR이 닫는 이슈의 댓글
 * @param {import('./relay.js').Roles} input.roles
 * @param {number | null} input.issue PR이 닫는 이슈 번호(expectedIssueOf)
 * @param {number} input.pr PR 번호
 * @returns {{kind: 'none' | 'invalid' | 'limit' | 'run', errors: string[], changeId?: number, rev?: number, replyTo?: number}}
 */
export function classifyChange({ comment, comments, issueComments, roles, issue, pr }) {
  const none = { kind: 'none', errors: [] };
  const senders = [...roles.codex, ...roles.maintainer];
  if (!senders.includes(comment.login)) return none;

  const { message, errors } = validateMessage(comment, roles);
  if (!message) {
    // 표시 줄이 틀렸지만 change를 쓰려 한 댓글은 알린다.
    return errors.length && CHANGE_HEADER_RE.test(comment.body)
      ? { kind: 'invalid', errors }
      : none;
  }
  if (message.meta.type !== 'change') return none;
  if (errors.length) return { kind: 'invalid', errors };

  const handled = comments.some(
    (c) =>
      roles.claude.includes(c.login) && c.body.includes(`<!-- ai-handled:change-${comment.id} -->`),
  );
  if (handled) return none;

  const problems = [];
  if (Number(message.meta.pr) !== pr)
    problems.push(`pr 값 ${message.meta.pr}이 이 PR #${pr}과 다릅니다.`);
  if (typeof issue !== 'number')
    problems.push('이 PR이 닫는 이슈 번호를 브랜치 이름에서 알 수 없습니다.');
  else if (Number(message.meta.issue) !== issue) {
    problems.push(`issue 값 ${message.meta.issue}이 이 PR이 닫는 이슈 #${issue}와 다릅니다.`);
  }

  const replyTo = Number(message.meta['reply-to']);
  const before = comments.filter((c) => c.id < comment.id);
  const request = before.find((c) => c.id === replyTo && roles.maintainer.includes(c.login));
  if (!request) {
    problems.push(`reply-to ${replyTo}가 이 PR에 먼저 달린 메인테이너 댓글이 아닙니다.`);
  }

  const rev = Number(message.meta.rev);
  // 받아들인 개정만 센다. 거절했거나 회차를 넘긴 change는 rev와 횟수에 넣지 않는다.
  const prior = collectRevisions({
    issue: typeof issue === 'number' ? issue : -1,
    pr,
    issueComments,
    prComments: before,
    roles,
  });
  const lastPlan = Math.max(
    0,
    ...prior.filter((r) => r.type === 'plan-rev' && r.id < comment.id).map((r) => r.rev),
  );
  const lastChange = Math.max(0, ...prior.filter((r) => r.type === 'change').map((r) => r.rev));
  // 이슈에 같은 rev의 plan-rev를 먼저 남기고 change를 다는 경우도 인정한다.
  if (rev <= lastChange || rev < lastPlan) {
    problems.push(
      `rev ${rev}가 최신이 아닙니다 (이전 change rev ${lastChange}, plan-rev rev ${lastPlan}).`,
    );
  }
  if (problems.length) return { kind: 'invalid', errors: problems };

  const used = prior.filter((r) => r.type === 'change' && r.where === 'pr').length;
  if (used >= MAX_CHANGES) {
    return {
      kind: 'limit',
      errors: [`이 PR에서 change를 이미 ${used}회 실행했습니다 (최대 ${MAX_CHANGES}회).`],
      changeId: comment.id,
      rev,
      replyTo,
    };
  }
  return { kind: 'run', errors: [], changeId: comment.id, rev, replyTo };
}

/**
 * change 판단을 라벨 변경으로 바꾼다.
 * 실행하면 ai:ready와 ai:needs-human을 지우고 ai:in-progress를 붙인다(머지 게이트가 대기로 돌아간다).
 * 검토 반영 회차(ai:round-N)는 새 계획에 대한 검토이므로 처음부터 센다.
 * @param {{labels: string[], open: boolean, sameRepo: boolean, reply: ReturnType<typeof classifyChange>}} input
 */
export function decideChange({ labels, open, sameRepo, reply }) {
  const none = (reason) => ({ action: 'none', reason, addLabels: [], removeLabels: [] });
  if (reply.kind === 'none') return none('not a change to run');
  const aiPr = ['ai:in-progress', 'ai:ready', 'ai:needs-human'].some((l) => labels.includes(l));
  if (!open || !sameRepo || !aiPr) return none('not an AI PR');
  if (reply.kind === 'invalid') return { ...none('invalid change'), action: 'reject' };
  if (reply.kind === 'limit') {
    return {
      action: 'halt',
      reason: `change limit (change ${reply.changeId})`,
      addLabels: [
        ...(labels.includes('ai:needs-human') ? [] : ['ai:needs-human']),
        ...(labels.includes('ai:in-progress') ? [] : ['ai:in-progress']),
      ],
      removeLabels: labels.includes('ai:ready') ? ['ai:ready'] : [],
    };
  }
  return {
    action: 'fix',
    reason: `change ${reply.changeId} rev ${reply.rev}; task=change-${reply.changeId}`,
    task: `change-${reply.changeId}`,
    addLabels: labels.includes('ai:in-progress') ? [] : ['ai:in-progress'],
    removeLabels: labels.filter(
      (l) => l === 'ai:ready' || l === 'ai:needs-human' || /^ai:round-\d+$/.test(l),
    ),
  };
}

/** 댓글로 옮기는 글이 다시 메시지나 숨은 표시로 읽히지 않게 한다. */
const defuse = (text) => String(text).replace(/<!--/g, '&lt;!--');

/**
 * Claude에게 넘길 계획 문서. 이슈 본문이 rev 0이고, 그 뒤 개정을 rev 순으로 붙인다.
 * @param {{issue: number, title: string, body: string, revisions: ReturnType<typeof collectRevisions>}} input
 */
export function formatPlan({ issue, title, body, revisions }) {
  const latest = revisions.length ? revisions.at(-1).rev : 0;
  const lines = [
    `# 이슈 #${issue} 계획 (최신 rev ${latest})`,
    '',
    '이슈 본문이 rev 0이다. 아래 개정이 있으면 rev가 큰 것이 앞선 내용보다 우선한다.',
    '',
    `## rev 0: 이슈 본문 (${title})`,
    '',
    body.trim(),
  ];
  for (const r of revisions) {
    lines.push('', `## rev ${r.rev}: ${r.type} (${r.where === 'pr' ? 'PR' : '이슈'} 댓글 ${r.id})`);
    for (const [name, value] of Object.entries(r.fields)) lines.push('', `**${name}**`, '', value);
  }
  return defuse(lines.join('\n')) + '\n';
}

/**
 * 실행한 change를 이슈에 남기는 기록 댓글. 메시지가 아니므로 다음 차례를 부르지 않는다.
 * @param {{pr: number, rev: number, url: string, fields: Record<string, string>}} input
 */
export function revisionRecordBody({ pr, rev, url, fields }) {
  const lines = [`PR #${pr}에서 계획을 rev ${rev}로 고쳤습니다: ${url}`];
  for (const name of ['바뀐 완료 조건', '이유']) {
    if (fields[name]) lines.push('', `**${name}**`, '', fields[name]);
  }
  return defuse(lines.join('\n'));
}
