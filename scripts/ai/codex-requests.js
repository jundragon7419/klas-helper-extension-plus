// 워크플로가 Codex에게 보내는 요청 본문과 리뷰 정리(리뷰 → Codex change → Claude)의 판단.
// Codex는 채워진 틀을 받으면 형식을 지키고, AGENTS.md만 가리키면 지키지 않는다(#145). 그래서 요청마다 틀을 넣는다.
// GitHub API 호출은 워크플로가 한다. tests/codex-requests.test.ts가 검사한다.

/** 리뷰 정리 요청 표시. 커밋마다 한 번 단다. 지적 목록을 담아 다음 회차에서 반복을 찾는 데 쓴다. */
export const TRIAGE_TAG = 'ai-review-triage:v1';
/** 리뷰 정리로 실행하는 change의 PR당 최대 횟수. 사용자 수정 요청(/change)은 따로 센다. */
export const MAX_TRIAGES = 3;

const BADGE = /!\[P([0-3]) Badge\]/;
const TASK_FINDING = /\[P([0-3])\]\s*\**\s*([^\n*]+)/g;

/** 댓글로 옮기는 글이 메시지나 숨은 표시로 읽히지 않게 한다. */
const defuse = (text) => String(text).replace(/<!--/g, '&lt;!--').replace(/-->/g, '--&gt;');

/** 줄 단위 리뷰 지적 하나를 정리 요청용으로 줄인다. 등급 배지가 없으면 null. */
export function inlineFinding(c) {
  const level = BADGE.exec(c.body)?.[1];
  if (level === undefined) return null;
  const title =
    /\*\*<sub>.*?<\/sub>\*\*\s*(.+?)\*\*/s
      .exec(c.body)?.[1]
      ?.replace(/<[^>]+>/g, '')
      .trim() ??
    c.body
      .replace(/<[^>]+>/g, '')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
      .replace(/\*/g, '')
      .trim()
      .split('\n')[0];
  return { level: Number(level), path: c.path ?? null, line: c.line ?? null, title, url: c.url };
}

/** 작업 결과 댓글로 온 리뷰의 `[P1] 제목` 줄들을 지적으로 꺼낸다. */
export function taskFindings({ body, url }) {
  return [...body.matchAll(TASK_FINDING)].map((m) => ({
    level: Number(m[1]),
    path: null,
    line: null,
    title: m[2].trim(),
    url,
  }));
}

/** 반복을 찾을 때 쓰는 지적 열쇠. 줄 번호는 고치면 바뀌므로 쓰지 않는다. */
export const findingKey = (f) =>
  `${f.path ?? '-'}|P${f.level}|${String(f.title).replace(/\s+/g, ' ').trim().toLowerCase()}`;

/** 정리 요청 댓글에서 표시를 읽는다. 표시가 없거나 깨졌으면 null. */
export function parseTriage(body) {
  const m = new RegExp(`<!-- ${TRIAGE_TAG} (\\{.*?\\}) -->`).exec(body ?? '');
  if (!m) return null;
  try {
    const data = JSON.parse(m[1]);
    return typeof data.head === 'string' && Array.isArray(data.findings) ? data : null;
  } catch {
    return null;
  }
}

/** `change` 틀. replyTo를 모르면 Codex가 채울 자리를 둔다. */
function changeTemplate({ issue, pr, rev, replyTo }) {
  return [
    '@claude',
    `<!-- ai-msg:v1 type=change issue=${issue} pr=${pr} head=- rev=${rev} reply-to=${replyTo} -->`,
    '',
    '### 바뀐 완료 조건',
    '',
    '- 전: (지금 완료 조건)',
    '- 후: (고친 뒤 완료 조건. 바뀌지 않으면 전과 같게)',
    '',
    '### 이유',
    '',
    '(요청이나 지적의 요지. 고치지 않기로 한 P2, P3 지적은 여기에 이유와 함께 적는다)',
    '',
    '### 바꿀 항목',
    '',
    '- (Claude가 고칠 것. 파일이나 화면 단위로 한 줄씩)',
  ].join('\n');
}

/**
 * 리뷰 정리 요청. Codex가 리뷰 지적을 확인하고 계획(change)으로 바꿔 Claude를 부르게 한다.
 * @param {{issue: number, pr: number, head: string, rev: number, findings: ReturnType<typeof inlineFinding>[], runUrl: string}} input
 */
export function triageRequestBody({ issue, pr, head, rev, findings, runUrl }) {
  const list = findings.map((f) => {
    const where = f.path ? ` (${f.path}${f.line ? `:${f.line}` : ''})` : '';
    return `- [P${f.level}] ${defuse(f.title)}${where} ${f.url}`;
  });
  const marker = JSON.stringify({ head, findings: findings.map((f) => ({ ...f, url: undefined })) })
    .replace(/-->/g, '--\\u003e')
    .replace(/<!--/g, '\\u003c!--');
  return [
    `@codex (자동 요청) 커밋 \`${head.slice(0, 7)}\`의 리뷰 지적을 확인하고 Claude에게 넘길 계획을 정한다.`,
    '',
    '지킬 것:',
    '1. 코드를 바꾸지 말고 브랜치, 커밋, PR도 만들지 마라. 이 PR에 댓글 하나만 단다.',
    '2. 지적마다 맞는지 판단한다. P0, P1은 무시할 수 없다. 모두 "바꿀 항목"에 넣거나, 판단이 필요하면 change 대신 need-user로 답한다.',
    '3. P2, P3을 고치지 않기로 하면 그 지적과 이유를 "이유"에 적는다.',
    '4. 완료 조건이 바뀌면 "바뀐 완료 조건"에 전과 후를 적는다.',
    '5. 댓글은 아래 틀의 첫 줄(@claude)부터 그대로 시작하고, 틀 밖의 글(인사, 요약, 설명)과 코드 블록 표시(```)는 쓰지 않는다. reply-to에는 이 요청 댓글의 ID(댓글 주소 끝의 숫자)를 적는다.',
    '',
    '지적:',
    ...list,
    '',
    '틀:',
    '',
    '```text',
    changeTemplate({ issue, pr, rev, replyTo: '<이 요청 댓글 ID>' }),
    '```',
    '',
    `실행 기록: ${runUrl}`,
    '',
    `<!-- ${TRIAGE_TAG} ${marker} -->`,
  ].join('\n');
}

/**
 * 사용자 수정 요청(/change)을 Codex에게 넘기는 요청. 사용자 댓글에는 틀이 없어 Codex가 코드를 고치므로(#145) 틀을 붙인다.
 * @param {{issue: number, pr: number, rev: number, requestId: number, request: string}} input
 */
export function userChangeRequestBody({ issue, pr, rev, requestId, request }) {
  return [
    `@codex (자동 요청) 사용자가 댓글 ${requestId}에서 이 PR의 수정을 요청했다. 계획을 고쳐 Claude에게 넘긴다.`,
    '',
    '요청:',
    '',
    ...defuse(request)
      .split('\n')
      .map((l) => `> ${l}`),
    '',
    '지킬 것:',
    '1. 코드를 바꾸지 말고 브랜치, 커밋, PR도 만들지 마라. 이 PR에 댓글 하나만 단다.',
    '2. 요청이 이 이슈의 범위를 벗어나거나 모호하면 change를 달지 말고, 일반 댓글로 새 이슈나 확인할 것을 제안한다.',
    '3. 댓글은 아래 틀의 첫 줄(@claude)부터 그대로 시작하고, 틀 밖의 글과 코드 블록 표시(```)는 쓰지 않는다.',
    '',
    '틀:',
    '',
    '```text',
    changeTemplate({ issue, pr, rev, replyTo: requestId }),
    '```',
  ].join('\n');
}

/** ai-relay 질문 요청에 붙이는 answer, need-user 틀 */
export function relayTemplates({ issue, pr, askId }) {
  const header = (type) =>
    `<!-- ai-msg:v1 type=${type} issue=${issue} pr=${pr ?? '-'} head=- rev=- reply-to=${askId} -->`;
  return [
    '답할 수 있으면 이 틀(answer):',
    '',
    '```text',
    header('answer'),
    '',
    '### 답',
    '',
    '- (질문마다 답)',
    '',
    '### 근거',
    '',
    '- (파일 위치나 URL)',
    '',
    '### 재시작',
    '',
    '예',
    '```',
    '',
    '답할 수 없으면 이 틀(need-user):',
    '',
    '```text',
    header('need-user'),
    '',
    '### 확인할 것',
    '',
    '- (사용자가 확인할 것)',
    '',
    '### 확인 방법',
    '',
    '- (어디서 어떻게)',
    '',
    '### 붙일 것',
    '',
    '- (이 스레드에 붙일 것. 학생 정보는 지우고)',
    '```',
    '',
    '`### 재시작`에는 예 또는 아니오만 적는다. 댓글은 고른 틀의 첫 줄부터 그대로 시작하고, 틀 밖의 글과 코드 블록 표시(```)는 쓰지 않는다.',
  ].join('\n');
}

/**
 * 리뷰 지적이 있을 때 정리 요청을 할지 정한다.
 * - triage: 이 커밋의 정리 요청을 단다
 * - wait: 이 커밋은 이미 요청했다
 * - repeat: 앞 회차에서 넘긴 지적이 다시 나왔다
 * - limit: 정리 요청이 MAX_TRIAGES회를 넘는다
 * @param {{head: string, findings: {level: number, path: string | null, title: string}[], triages: {head: string, findings: {level: number, path: string | null, title: string}[]}[]}} input
 */
export function decideTriage({ head, findings, triages }) {
  if (triages.some((t) => t.head === head)) return { kind: 'wait', repeated: [] };
  const before = new Set(triages.flatMap((t) => t.findings.map(findingKey)));
  const repeated = findings.filter((f) => before.has(findingKey(f)));
  if (repeated.length > 0) return { kind: 'repeat', repeated };
  if (triages.length >= MAX_TRIAGES) return { kind: 'limit', repeated: [] };
  return { kind: 'triage', repeated: [] };
}

/** 자동 요청이 이 시간 넘게 답을 받지 못하면 멈춘다. */
export const REQUEST_TIMEOUT_MS = 30 * 60 * 1000;

/**
 * 메인테이너 계정으로 단 마지막 자동 요청(리뷰 정리, /change 전달)이 답 없이 시간을 넘겼으면 그 요청을, 아니면 null.
 * 답은 Codex가 단 ai-msg 중 reply-to가 그 요청 ID인 것만 센다. 리뷰 결과나 상태 댓글은 답이 아니다.
 * @param {{comments: {id: number, login: string, body: string, at: string}[], maintainer: string, codexBot: string, now: number}} input
 */
export function overdueRequest({ comments, maintainer, codexBot, now }) {
  const request = comments
    .filter((c) => c.login === maintainer && /^@codex \(자동 요청\)/.test(c.body ?? ''))
    .at(-1);
  if (!request || now - Date.parse(request.at) <= REQUEST_TIMEOUT_MS) return null;
  const answered = comments.some((c) => {
    if (c.login !== codexBot) return false;
    const replyTo = /<!--\s*ai-msg:\S*\s[^>]*\breply-to=(\d+)/.exec(c.body ?? '')?.[1];
    return Number(replyTo) === request.id;
  });
  return answered ? null : request;
}

/** 사용자 수정 요청 댓글이면 요청 내용을, 아니면 null. 첫 줄이 `/change`로 시작해야 한다. */
export function parseUserChange(body) {
  const m = /^\s*\/change(?:[ \t]+(.*))?(?:\r?\n([\s\S]*))?$/.exec(body ?? '');
  if (!m) return null;
  const text = [m[1] ?? '', m[2] ?? ''].join('\n').trim();
  return text || null;
}
