// Claude와 Codex가 이슈와 PR 댓글로 주고받는 메시지 형식(ai-msg v1)을 만들고 읽고 검사한다.
// 형식 설명은 AGENTS.md "AI 메시지 형식"에 있고, tests/ai-msg.test.ts가 검사한다.
//
// 메시지 모양:
//   @claude                                   (선택: 호출 멘션 한 줄)
//   <!-- ai-msg:v1 type=ask issue=104 pr=- head=- rev=0 reply-to=- -->
//   ### 단계
//   구현 전
//   ### 질문
//   - ...

export const VERSION = 'v1';

/** 표시 줄의 키. 값이 없으면 `-`를 쓴다. */
export const HEADER_KEYS = ['type', 'issue', 'pr', 'head', 'rev', 'reply-to'];

/** 메시지를 보낼 수 있는 역할. 실제 계정은 roles 인자로 받는다. */
export const ROLES = ['codex', 'claude', 'maintainer'];

/**
 * 종류별 보내는 쪽, 받는 쪽, 반드시 채울 표시 값과 본문 절.
 * Codex는 사용자 대화(CLI)에서 사용자 계정으로 쓰기도 하므로 Codex가 보내는 종류는 maintainer도 허용한다.
 */
export const MESSAGE_TYPES = {
  // 이슈 본문. 절 이름은 작업 이슈 양식(.github/ISSUE_TEMPLATE/maintainer_task.yml)과 같다.
  plan: {
    from: ['codex', 'maintainer'],
    to: 'claude',
    header: ['issue', 'rev'],
    fields: ['배경', '할 일', '완료 조건'],
  },
  start: {
    from: ['codex', 'maintainer'],
    to: 'claude',
    mention: '@claude',
    header: ['issue', 'rev', 'reply-to'],
    fields: ['승인'],
  },
  ask: {
    from: ['claude'],
    to: 'codex',
    header: ['issue'],
    fields: ['단계', '질문', '확인한 것'],
  },
  answer: {
    from: ['codex'],
    to: 'claude',
    header: ['issue', 'reply-to'],
    fields: ['답', '근거', '재시작'],
  },
  'need-user': {
    from: ['codex'],
    to: 'maintainer',
    header: ['issue', 'reply-to'],
    fields: ['확인할 것', '확인 방법', '붙일 것'],
  },
  'plan-rev': {
    from: ['codex', 'maintainer'],
    to: 'claude',
    header: ['issue', 'rev', 'reply-to'],
    fields: ['바뀐 완료 조건', '이유'],
  },
  change: {
    from: ['codex', 'maintainer'],
    to: 'claude',
    mention: '@claude',
    header: ['issue', 'pr', 'rev', 'reply-to'],
    fields: ['바꿀 항목'],
  },
  objection: {
    from: ['claude'],
    to: 'codex',
    header: ['issue'],
    fields: ['문제 항목', '근거', '제안'],
  },
  report: {
    from: ['claude'],
    to: 'codex',
    header: ['issue', 'pr', 'head'],
    fields: ['결과', '실행한 검사'],
  },
};

const HEADER_RE = /^<!-- ai-msg:(v\d+)((?: [a-z-]+=\S+)*) -->$/;
const VALUE_RE = {
  type: /^[a-z-]+$/,
  issue: /^[1-9]\d*$/,
  pr: /^[1-9]\d*$/,
  head: /^[0-9a-f]{40}$/,
  rev: /^\d+$/,
  'reply-to': /^[1-9]\d*$/,
};
const MENTION_RE = /^@(claude|codex)\b/;

/** 표시 줄을 만든다. 없는 값은 `-`로 채운다. */
export function formatHeader(meta) {
  const parts = HEADER_KEYS.map((key) => `${key}=${meta[key] ?? '-'}`);
  return `<!-- ai-msg:${VERSION} ${parts.join(' ')} -->`;
}

/** 메시지 본문을 만든다. 종류에 호출 멘션이 있으면 첫 줄에 둔다. */
export function formatMessage(meta, fields) {
  const spec = MESSAGE_TYPES[meta.type];
  if (!spec) throw new Error(`알 수 없는 메시지 종류: ${meta.type}`);
  const lines = [];
  if (spec.mention) lines.push(spec.mention);
  lines.push(formatHeader(meta));
  for (const [name, value] of Object.entries(fields)) {
    lines.push('', `### ${name}`, '', String(value).trim());
  }
  return lines.join('\n') + '\n';
}

/**
 * 댓글 본문에서 메시지를 읽는다. 표시 줄이 없으면 null.
 * 표시 줄은 첫 줄, 또는 호출 멘션 줄 바로 다음 줄에 있어야 한다.
 * @returns {null | {version: string, mention: string | null, meta: Record<string, string>, fields: Record<string, string>, duplicates: string[]}}
 */
export function parseMessage(body) {
  const lines = (body ?? '').replace(/\r\n/g, '\n').split('\n');
  let index = 0;
  let mention = null;
  if (MENTION_RE.test(lines[0] ?? '') && HEADER_RE.test((lines[1] ?? '').trim())) {
    mention = lines[0].trim().split(/\s/)[0];
    index = 1;
  }
  const header = HEADER_RE.exec((lines[index] ?? '').trim());
  if (!header) return null;

  const meta = {};
  for (const pair of header[2].trim().split(' ').filter(Boolean)) {
    const at = pair.indexOf('=');
    meta[pair.slice(0, at)] = pair.slice(at + 1);
  }

  const fields = {};
  const duplicates = [];
  let current = null;
  for (const line of lines.slice(index + 1)) {
    const heading = /^### (.+?)\s*$/.exec(line);
    if (heading) {
      current = heading[1];
      if (current in fields) duplicates.push(current);
      fields[current] = '';
    } else if (current !== null) {
      fields[current] += `${line}\n`;
    }
  }
  for (const name of Object.keys(fields)) fields[name] = fields[name].trim();
  return { version: header[1], mention, meta, fields, duplicates };
}

/**
 * 댓글 하나를 검사한다.
 * @param {{login: string, body: string}} comment
 * @param {{codex: string[], claude: string[], maintainer: string[]}} roles 역할별 계정
 * @returns {{message: ReturnType<typeof parseMessage>, errors: string[]}} 표시 줄이 없으면 message는 null, errors는 비어 있다.
 */
export function validateMessage(comment, roles) {
  const message = parseMessage(comment.body);
  if (!message) return { message: null, errors: [] };
  const errors = [];

  if (message.version !== VERSION) {
    errors.push(`지원하지 않는 형식 버전입니다: ${message.version}`);
    return { message, errors };
  }
  const unknown = Object.keys(message.meta).filter((key) => !HEADER_KEYS.includes(key));
  if (unknown.length) errors.push(`알 수 없는 표시 값: ${unknown.join(', ')}`);

  const spec = MESSAGE_TYPES[message.meta.type];
  if (!spec) {
    errors.push(`알 수 없는 메시지 종류: ${message.meta.type ?? '(없음)'}`);
    return { message, errors };
  }

  for (const key of HEADER_KEYS.slice(1)) {
    const value = message.meta[key];
    if (value === undefined || value === '-') {
      if (spec.header.includes(key)) errors.push(`표시 값 ${key}가 필요합니다.`);
    } else if (!VALUE_RE[key].test(value)) {
      errors.push(`표시 값 ${key}의 형식이 다릅니다: ${value}`);
    }
  }

  if (spec.mention && message.mention !== spec.mention) {
    errors.push(`첫 줄이 ${spec.mention} 이어야 합니다.`);
  }
  if (!spec.mention && message.mention) {
    errors.push(`${message.meta.type}에는 호출 멘션을 쓰지 않습니다.`);
  }

  const sender = ROLES.find((role) => roles[role]?.includes(comment.login));
  if (!sender || !spec.from.includes(sender)) {
    errors.push(
      `${comment.login}은 ${message.meta.type}을 보낼 수 없습니다 (보낼 수 있는 역할: ${spec.from.join(', ')}).`,
    );
  }

  for (const name of spec.fields) {
    if (!message.fields[name]) errors.push(`본문 절 "### ${name}"이 없거나 비어 있습니다.`);
  }
  for (const name of message.duplicates) errors.push(`본문 절 "### ${name}"이 두 번 있습니다.`);

  return { message, errors };
}

/** 형식 오류를 보낸 쪽에 알리는 댓글 본문. 이 댓글은 표시 줄이 없어 다음 차례를 부르지 않는다. */
export function formatErrorBody({ login, url, errors }) {
  return [
    `메시지 형식 오류(${login}): 다음 차례를 호출하지 않았습니다. AGENTS.md "AI 메시지 형식"에 맞춰 다시 보내야 합니다.`,
    '',
    `대상 댓글: ${url}`,
    '',
    ...errors.map((e) => `- ${e}`),
  ].join('\n');
}
