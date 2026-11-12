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
    // 워크플로가 이 값으로 Claude를 다시 부를지 정한다.
    values: { 재시작: ['예', '아니오'] },
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
// 호출 멘션 줄은 멘션 하나만 있어야 한다.
const MENTION_RE = /^@(claude|codex)$/;
// 표시 줄을 쓰려 한 줄. 공백이나 대소문자가 틀려도 메시지로 보고 문법 오류를 알린다.
const HEADER_CANDIDATE_RE = /^<!--\s*ai-msg\b/i;
// 코드 블록 경계(CommonMark fenced code). 들여쓰기 3칸까지, 같은 문자로 같거나 더 길게 닫는다.
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})(.*)$/;

/**
 * 줄마다 코드 블록 안인지 판단한다. 경계 줄 자체도 코드 블록으로 본다.
 * @returns {boolean[]}
 */
function fencedLines(lines) {
  let open = null;
  return lines.map((line) => {
    const match = FENCE_RE.exec(line);
    if (open) {
      const [, fence, rest] = match ?? [];
      if (fence && fence[0] === open[0] && fence.length >= open.length && rest.trim() === '') {
        open = null;
      }
      return true;
    }
    // 백틱 경계는 정보 문자열에 백틱을 쓸 수 없다.
    if (match && !(match[1][0] === '`' && match[2].includes('`'))) {
      open = match[1];
      return true;
    }
    return false;
  });
}

/** 실제로 정의된 종류만 찾는다. `constructor` 같은 상속 속성은 종류가 아니다. */
const specOf = (type) => (Object.hasOwn(MESSAGE_TYPES, type) ? MESSAGE_TYPES[type] : undefined);

/** 표시 줄을 만든다. 없는 값은 `-`로 채운다. */
export function formatHeader(meta) {
  const parts = HEADER_KEYS.map((key) => `${key}=${meta[key] ?? '-'}`);
  return `<!-- ai-msg:${VERSION} ${parts.join(' ')} -->`;
}

/** 메시지 본문을 만든다. 종류에 호출 멘션이 있으면 첫 줄에 둔다. */
export function formatMessage(meta, fields) {
  const spec = specOf(meta.type);
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
 * 표시 줄의 위치를 찾는다.
 * - none: ai-msg 메시지가 아닌 일반 댓글
 * - ok: 첫 줄, 또는 호출 멘션 바로 다음 줄에 올바른 표시 줄이 있음
 * - malformed: `<!-- ai-msg:`로 시작하는 줄이 있지만 문법이나 위치가 틀림
 */
function locateHeader(lines) {
  const first = (lines[0] ?? '').trim();
  const second = (lines[1] ?? '').trim();
  let index = 0;
  let mention = null;
  if (MENTION_RE.test(first) && HEADER_CANDIDATE_RE.test(second)) {
    mention = first;
    index = 1;
  }
  const line = (lines[index] ?? '').trim();
  if (HEADER_CANDIDATE_RE.test(line)) {
    const header = HEADER_RE.exec(line);
    return header
      ? { status: 'ok', index, mention, header }
      : { status: 'malformed', reason: `표시 줄 문법이 다릅니다: ${line}` };
  }
  // 코드 블록 밖의 다른 줄에 표시 줄이 있으면 위치가 틀린 메시지다.
  const fenced = fencedLines(lines);
  if (lines.some((raw, i) => !fenced[i] && HEADER_CANDIDATE_RE.test(raw.trim()))) {
    return {
      status: 'malformed',
      reason: '표시 줄은 첫 줄, 또는 멘션만 있는 첫 줄 바로 다음 줄에 있어야 합니다.',
    };
  }
  return { status: 'none' };
}

const splitLines = (body) => (body ?? '').replace(/\r\n/g, '\n').split('\n');

/**
 * 댓글 본문에서 메시지를 읽는다. 메시지가 아니거나 표시 줄이 틀리면 null.
 * 코드 블록(``` 또는 ~~~, 더 긴 경계 포함) 안의 `### ` 줄은 절 제목으로 보지 않는다.
 * @returns {null | {version: string, mention: string | null, meta: Record<string, string>, fields: Record<string, string>, duplicates: string[]}}
 */
export function parseMessage(body) {
  const lines = splitLines(body);
  const found = locateHeader(lines);
  if (found.status !== 'ok') return null;
  const { index, mention, header } = found;

  const meta = {};
  for (const pair of header[2].trim().split(' ').filter(Boolean)) {
    const at = pair.indexOf('=');
    meta[pair.slice(0, at)] = pair.slice(at + 1);
  }

  const fields = {};
  const duplicates = [];
  let current = null;
  const rest = lines.slice(index + 1);
  const fenced = fencedLines(rest);
  for (const [i, line] of rest.entries()) {
    const heading = fenced[i] ? null : /^### (.+?)\s*$/.exec(line);
    if (heading) {
      current = heading[1];
      if (Object.hasOwn(fields, current)) duplicates.push(current);
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
 * @returns {{message: ReturnType<typeof parseMessage>, errors: string[]}}
 *   일반 댓글이면 message는 null, errors는 비어 있다. 표시 줄이 틀리면 message는 null, errors에 이유가 있다.
 */
export function validateMessage(comment, roles) {
  const found = locateHeader(splitLines(comment.body));
  if (found.status === 'malformed') return { message: null, errors: [found.reason] };
  const message = parseMessage(comment.body);
  if (!message) return { message: null, errors: [] };
  const errors = [];

  if (message.version !== VERSION) {
    errors.push(`지원하지 않는 형식 버전입니다: ${message.version}`);
    return { message, errors };
  }
  const unknown = Object.keys(message.meta).filter((key) => !HEADER_KEYS.includes(key));
  if (unknown.length) errors.push(`알 수 없는 표시 값: ${unknown.join(', ')}`);

  const spec = specOf(message.meta.type);
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
  for (const [name, allowed] of Object.entries(spec.values ?? {})) {
    const value = message.fields[name];
    if (value && !allowed.includes(value)) {
      errors.push(`본문 절 "### ${name}"의 값은 ${allowed.join(' 또는 ')}이어야 합니다: ${value}`);
    }
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
