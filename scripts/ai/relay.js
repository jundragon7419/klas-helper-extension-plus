// 자동 흐름이 멈췄을 때 Codex에게 정리를 맡기고, Codex 정리가 오면(또는 30분이 지나면) 메인테이너에게 알린다.
// tests/relay.test.ts가 검사한다. `node scripts/ai/relay.js body <kind> <runUrl> <key>`로 요청 본문을 출력한다.

export const PING_TIMEOUT_MS = 30 * 60 * 1000;

const KIND_TEXT = {
  implement: 'Claude 자동 구현이 PR을 열지 못하고 멈췄다.',
  'round-limit': '검토 반영을 3회 했지만 Codex 지적이 남아 자동 흐름이 멈췄다.',
  rebuttal: 'Claude가 Codex 지적에 동의하지 않아 코드를 바꾸지 않았고 자동 흐름이 멈췄다.',
  'fix-failed': 'Claude가 검토 반영 도중 실패해 자동 흐름이 멈췄다.',
};

/** 사용자 계정으로 다는 @codex 요청 본문. 첫 줄이 "@codex"로 시작해야 Codex가 작업을 시작한다. */
export function relayRequestBody(kind, { runUrl, key }) {
  const what = KIND_TEXT[kind];
  if (!what) throw new Error(`알 수 없는 멈춤 종류: ${kind}`);
  return [
    `@codex (자동 요청) ${what}`,
    '',
    '코드는 바꾸지 말고 브랜치, 커밋, PR도 만들지 마라. AGENTS.md "멈춤 정리" 절을 따른다.',
    '1. 이 스레드에서 Claude가 남긴 마지막 멈춤 보고(또는 이견 댓글)와 실행 기록을 읽는다.',
    '2. 저장소의 코드와 문서로 답할 수 있으면 답하고, 그 답으로 다시 진행할 수 있는지 판단한다.',
    '3. 저장소만으로 답할 수 없으면 사용자가 할 일을 한국어로 짧게 정리한다: 무엇을, 어떻게 확인하고, 무엇을 이 스레드에 붙이면 되는지.',
    '4. 끝에 다시 진행하는 방법을 한 줄로 적는다.',
    '',
    `실행 기록: ${runUrl}`,
    '',
    `<!-- ai-relay:${key} -->`,
  ].join('\n');
}

/**
 * 메인테이너에게 알릴지 정한다.
 * @param {object} input
 * @param {{login: string, body: string, createdAt: string}[]} input.comments 시간순 댓글
 * @param {number} input.now 현재 시각(ms)
 * @param {string} input.codexBot Codex 봇 로그인
 * @param {string} input.maintainer 요청을 다는 메인테이너 로그인
 * @param {string} input.pingBot 알림 댓글을 다는 봇 로그인
 * @returns {{ping: null | 'codex' | 'timeout', key?: string}}
 */
export function decidePing({ comments, now, codexBot, maintainer, pingBot }) {
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

  // 리뷰 요약 댓글(codex-review-state)은 PR마다 계속 고쳐지므로 정리 댓글로 보지 않는다.
  const answered = comments.some(
    (c) =>
      c.login === codexBot &&
      Date.parse(c.createdAt) > relay.at &&
      !c.body.includes('codex-review-state'),
  );
  if (answered) return { ping: 'codex', key: relay.key };
  if (now - relay.at >= PING_TIMEOUT_MS) return { ping: 'timeout', key: relay.key };
  return { ping: null };
}

/** 메인테이너 알림 댓글 본문. */
export function pingBody(ping, { maintainer, key }) {
  const line =
    ping === 'codex'
      ? '자동 흐름이 멈췄습니다. 바로 위 Codex 정리를 확인해 주세요.'
      : '자동 흐름이 멈췄는데 30분 동안 Codex 정리가 오지 않았습니다. 위 Claude 보고와 실행 기록을 직접 확인해 주세요.';
  return `@${maintainer} ${line}\n\n<!-- ai-pinged:${key} -->`;
}

if (process.argv[1]?.endsWith('relay.js') && process.argv[2] === 'body') {
  const [, , , kind, runUrl, key] = process.argv;
  process.stdout.write(relayRequestBody(kind, { runUrl, key }) + '\n');
}
