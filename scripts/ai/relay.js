// 자동 흐름이 멈췄을 때 Claude의 질문(ask)이나 이견(objection)을 Codex에게 넘기고,
// Codex의 답(answer)에 따라 Claude를 다시 부르거나 사용자에게 알린다.
// 메시지 형식은 AGENTS.md "AI 메시지 형식"(scripts/ai/ai-msg.js). tests/relay.test.ts가 검사한다.
//
// CLI
//   node scripts/ai/relay.js body <kind> <runUrl> <key> [askId]   Codex 요청 본문 출력
//   node scripts/ai/relay.js plan <comments.jsonl>                Codex에게 넘길지 사용자에게 바로 알릴지 JSON 출력
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { validateMessage } from './ai-msg.js';

export const PING_TIMEOUT_MS = 30 * 60 * 1000;

/** 이슈 하나에서 Codex에게 넘기는 ask 수. 넘으면 사용자에게 바로 알린다. */
export const MAX_ASKS = 2;

const KIND_TEXT = {
  implement: 'Claude 자동 구현이 PR을 열지 못하고 멈췄다.',
  'round-limit': '검토 반영을 3회 했지만 Codex 지적이 남아 자동 흐름이 멈췄다.',
  rebuttal: 'Claude가 Codex 지적에 동의하지 않아 코드를 바꾸지 않았고 자동 흐름이 멈췄다.',
  'fix-failed': 'Claude가 검토 반영 도중 실패해 자동 흐름이 멈췄다.',
};

/** 역할별 계정. 워크플로가 환경 변수로 넘긴다. */
export function rolesOf({ codexBot, claudeBot = 'claude[bot]', maintainer }) {
  return { codex: [codexBot], claude: [claudeBot], maintainer: [maintainer] };
}

/**
 * 사용자 계정으로 다는 @codex 요청 본문. 첫 줄이 "@codex"로 시작해야 Codex가 작업을 시작한다.
 * askId가 있으면 그 ask나 objection에 ai-msg 형식으로 답하게 한다.
 */
export function relayRequestBody(kind, { runUrl, key, askId = null }) {
  const what = KIND_TEXT[kind];
  if (!what) throw new Error(`알 수 없는 멈춤 종류: ${kind}`);
  const target = askId
    ? `Claude가 남긴 메시지(댓글 ID ${askId})에 답한다.`
    : 'Claude가 형식에 맞는 질문을 남기지 못했다. 이 스레드의 마지막 Claude 댓글과 실행 기록을 읽고 답한다.';
  return [
    `@codex (자동 요청) ${what}`,
    '',
    '코드는 바꾸지 말고 브랜치, 커밋, PR도 만들지 마라. AGENTS.md "질문 답변 (Codex)" 절을 따른다.',
    `1. ${target}`,
    '2. 저장소의 코드와 문서, 허용된 공개 자료로 답할 수 있으면 `answer`로 답한다. 질문별 답과 근거를 적고, 그 답으로 Claude가 다시 진행할 수 있으면 `재시작`에 `예`를 적는다.',
    '3. 답할 수 없으면 `need-user`로 사용자가 확인할 것, 확인 방법, 이 스레드에 붙일 것을 적는다.',
    `4. 답은 AGENTS.md "AI 메시지 형식"으로 쓰고 표시 줄의 reply-to에 ${askId ?? '-'}를 적는다. 형식이 틀리면 Claude를 다시 부르지 않는다.`,
    '',
    `실행 기록: ${runUrl}`,
    '',
    `<!-- ai-relay:${key} -->`,
  ].join('\n');
}

const stopTypes = ['ask', 'objection'];
const normalize = (text) => text.replace(/\s+/g, ' ').trim();

/** Claude가 남긴 형식에 맞는 ask와 objection을 시간순으로 모은다. */
function stopMessages(comments, roles) {
  const out = [];
  for (const c of comments) {
    if (!roles.claude.includes(c.login)) continue;
    const { message, errors } = validateMessage(c, roles);
    if (message && errors.length === 0 && stopTypes.includes(message.meta.type)) {
      out.push({ id: c.id, type: message.meta.type, question: message.fields['질문'] ?? '' });
    }
  }
  return out;
}

/**
 * Claude가 멈췄을 때 Codex에게 넘길지, 사용자에게 바로 알릴지 정한다.
 * @param {{comments: {id: number, login: string, body: string}[], roles: ReturnType<typeof rolesOf>}} input
 * @returns {{target: 'codex' | 'user', askId: number | null, reason: string}}
 */
export function decideRelayTarget({ comments, roles }) {
  const stops = stopMessages(comments, roles);
  const last = stops.at(-1);
  // 형식에 맞는 메시지가 없으면 Codex가 스레드와 실행 기록을 읽고 판단한다.
  if (!last) return { target: 'codex', askId: null, reason: 'Claude 메시지 없음' };
  if (last.type === 'ask') {
    const asks = stops.filter((s) => s.type === 'ask');
    if (asks.length > MAX_ASKS) {
      return { target: 'user', askId: last.id, reason: `질문이 ${MAX_ASKS}회를 넘음` };
    }
    const earlier = asks.slice(0, -1).map((s) => normalize(s.question));
    if (earlier.includes(normalize(last.question))) {
      return { target: 'user', askId: last.id, reason: '같은 질문이 반복됨' };
    }
  }
  return { target: 'codex', askId: last.id, reason: last.type };
}

/**
 * Codex 댓글을 분류한다.
 * - restart: 이 스레드의 Claude ask나 objection에 답했고 재시작이 예
 * - hold: 답했지만 재시작이 아니오
 * - need-user: 사용자 확인이 필요함
 * - invalid: ai-msg 형식 오류, 또는 근거가 된 Claude 메시지를 찾을 수 없음
 * - other: ai-msg가 아닌 댓글(리뷰 요약 등)이나 다른 종류
 * @returns {{kind: 'restart' | 'hold' | 'need-user' | 'invalid' | 'other', errors: string[], replyTo?: number}}
 */
export function classifyCodexReply({ comment, comments, roles }) {
  if (!roles.codex.includes(comment.login)) return { kind: 'other', errors: [] };
  const { message, errors } = validateMessage(comment, roles);
  if (!message) return errors.length ? { kind: 'invalid', errors } : { kind: 'other', errors: [] };
  if (errors.length) return { kind: 'invalid', errors };

  const type = message.meta.type;
  if (type !== 'answer' && type !== 'need-user') return { kind: 'other', errors: [] };
  const replyTo = Number(message.meta['reply-to']);
  const asked = stopMessages(comments, roles).some((s) => s.id === replyTo);
  if (!asked) {
    return {
      kind: 'invalid',
      errors: [`reply-to ${replyTo}가 이 스레드에 있는 Claude의 ask나 objection이 아닙니다.`],
    };
  }
  if (type === 'need-user') return { kind: 'need-user', errors: [], replyTo };
  return {
    kind: message.fields['재시작'] === '예' ? 'restart' : 'hold',
    errors: [],
    replyTo,
  };
}

/**
 * 메인테이너에게 알릴지 정한다.
 * roles를 주면 Codex 답이 재시작(restart)인 경우는 알리지 않는다. 이 경우 Claude가 다시 진행한다.
 * @param {object} input
 * @param {{id?: number, login: string, body: string, createdAt: string}[]} input.comments 시간순 댓글
 * @param {number} input.now 현재 시각(ms)
 * @param {string} input.codexBot Codex 봇 로그인
 * @param {string} input.maintainer 요청을 다는 메인테이너 로그인
 * @param {string} input.pingBot 알림 댓글을 다는 봇 로그인
 * @param {ReturnType<typeof rolesOf>} [input.roles]
 * @returns {{ping: null | 'codex' | 'timeout', key?: string}}
 */
export function decidePing({ comments, now, codexBot, maintainer, pingBot, roles }) {
  let relay = null;
  for (const c of comments) {
    const match = /<!-- ai-relay:([\w.-]+) -->/.exec(c.body);
    if (match && c.login === maintainer) relay = { key: match[1], at: Date.parse(c.createdAt) };
  }
  if (!relay) return { ping: null };

  const pinged = comments.some(
    (c) => c.login === pingBot && c.body.includes(`<!-- ai-pinged:${relay.key} -->`),
  );
  if (pinged) return { ping: null };

  // 리뷰 요약 댓글(codex-review-state)과 리뷰 응답(codex-review-receipt)은 PR마다 계속 달리므로 정리 댓글로 보지 않는다.
  const answer = comments.find(
    (c) =>
      c.login === codexBot &&
      Date.parse(c.createdAt) > relay.at &&
      !c.body.includes('codex-review-state') &&
      !c.body.includes('codex-review-receipt'),
  );
  if (answer) {
    if (roles && classifyCodexReply({ comment: answer, comments, roles }).kind === 'restart') {
      return { ping: null };
    }
    return { ping: 'codex', key: relay.key };
  }
  if (now - relay.at >= PING_TIMEOUT_MS) return { ping: 'timeout', key: relay.key };
  return { ping: null };
}

/** 메인테이너 알림 댓글 본문. */
export function pingBody(ping, { maintainer, key }) {
  const line =
    ping === 'codex'
      ? '자동 흐름이 멈췄습니다. 바로 위 Codex 답을 확인해 주세요. 정보를 주실 때는 `@codex`로 시작하는 댓글로 답하면 Codex가 정리해 Claude를 다시 부릅니다.'
      : '자동 흐름이 멈췄는데 30분 동안 Codex 답이 오지 않았습니다. 위 Claude 메시지와 실행 기록을 직접 확인해 주세요.';
  return `@${maintainer} ${line}\n\n<!-- ai-pinged:${key} -->`;
}

/** gh api --jq로 받은 JSON 줄 목록을 읽는다. */
export function readCommentLines(text) {
  return text
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [, , command, ...args] = process.argv;
  if (command === 'body') {
    const [kind, runUrl, key, askId] = args;
    process.stdout.write(
      relayRequestBody(kind, { runUrl, key, askId: askId ? Number(askId) : null }) + '\n',
    );
  } else if (command === 'plan') {
    const comments = readCommentLines(readFileSync(args[0], 'utf8'));
    const roles = rolesOf({
      codexBot: process.env.CODEX_BOT ?? 'chatgpt-codex-connector[bot]',
      claudeBot: process.env.CLAUDE_BOT ?? 'claude[bot]',
      maintainer: process.env.MAINTAINER ?? '',
    });
    process.stdout.write(JSON.stringify(decideRelayTarget({ comments, roles })) + '\n');
  }
}
