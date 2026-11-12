import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  formatErrorBody,
  formatHeader,
  formatMessage,
  MESSAGE_TYPES,
  parseMessage,
  validateMessage,
  type MessageType,
} from '../scripts/ai/ai-msg.js';

// AI 메시지 형식(scripts/ai/ai-msg.js)을 검사한다.
const CODEX = 'chatgpt-codex-connector[bot]';
const CLAUDE = 'claude[bot]';
const ME = 'jundragon7419';
const roles = { codex: [CODEX], claude: [CLAUDE], maintainer: [ME] };
const HEAD = 'a'.repeat(40);

// 값이 정해진 절(answer의 재시작)은 허용된 첫 값을 쓴다.
const fill = (type: MessageType) => {
  const spec = MESSAGE_TYPES[type];
  return Object.fromEntries(
    spec.fields.map((name) => [name, spec.values?.[name]?.[0] ?? `${name} 내용`]),
  );
};
const meta = { issue: 104, pr: 111, head: HEAD, rev: 1, 'reply-to': 9001 };
const sender = (type: MessageType) =>
  ({ codex: CODEX, claude: CLAUDE, maintainer: ME })[MESSAGE_TYPES[type].from[0]!];
const check = (login: string, body: string) => validateMessage({ login, body }, roles);

describe('formatHeader', () => {
  it('모든 키를 정해진 순서로 쓰고 없는 값은 -로 채운다', () => {
    expect(formatHeader({ type: 'ask', issue: 104 })).toBe(
      '<!-- ai-msg:v1 type=ask issue=104 pr=- head=- rev=- reply-to=- -->',
    );
  });
});

describe('formatMessage와 parseMessage', () => {
  it('ask는 표시 줄로 시작하고 절을 그대로 읽는다', () => {
    const body = formatMessage(
      { type: 'ask', issue: 104 },
      {
        단계: '구현 전',
        질문: '- 진도율 셀은 어디인가?\n- 표가 몇 개인가?',
        '확인한 것': 'utils/',
      },
    );
    expect(body.split('\n')[0]).toBe(formatHeader({ type: 'ask', issue: 104 }));
    const message = parseMessage(body)!;
    expect(message.mention).toBeNull();
    expect(message.meta).toMatchObject({ type: 'ask', issue: '104', pr: '-' });
    expect(message.fields['질문']).toBe('- 진도율 셀은 어디인가?\n- 표가 몇 개인가?');
  });

  it('start와 change는 첫 줄에 @claude를 두고 표시 줄은 둘째 줄에 둔다', () => {
    for (const type of ['start', 'change'] as const) {
      const body = formatMessage({ type, ...meta }, fill(type));
      expect(body.split('\n')[0]).toBe('@claude');
      expect(parseMessage(body)!.mention).toBe('@claude');
    }
  });

  it('표시 줄이 없거나 셋째 줄 이후에 있으면 메시지가 아니다', () => {
    expect(parseMessage('그냥 댓글')).toBeNull();
    expect(parseMessage(`안녕하세요\n${formatHeader({ type: 'ask', issue: 1 })}`)).toBeNull();
    expect(parseMessage(`@claude\n\n${formatHeader({ type: 'start', issue: 1 })}`)).toBeNull();
    expect(parseMessage(null)).toBeNull();
  });

  it('CRLF 줄바꿈도 읽는다', () => {
    const body = formatMessage({ type: 'ask', issue: 1 }, fill('ask')).replace(/\n/g, '\r\n');
    expect(parseMessage(body)!.fields['단계']).toBe('단계 내용');
  });

  it('알 수 없는 종류로는 만들지 않는다', () => {
    expect(() => formatMessage({ type: 'hello' }, {})).toThrow('알 수 없는 메시지 종류');
    expect(() => formatMessage({ type: 'constructor' }, {})).toThrow('알 수 없는 메시지 종류');
  });

  it('코드 블록 안의 ### 줄은 절 제목으로 보지 않는다', () => {
    const question = '- 아래처럼 써도 되는가?\n```md\n### 단계\n예시\n```\n- 끝';
    const body = formatMessage(
      { type: 'ask', issue: 1 },
      { 단계: '구현 전', 질문: question, '확인한 것': 'x' },
    );
    const message = parseMessage(body)!;
    expect(message.fields['단계']).toBe('구현 전');
    expect(message.fields['질문']).toBe(question);
    expect(message.duplicates).toEqual([]);

    const tilde = body.replace(/```md/, '~~~').replace(/```\n- 끝/, '~~~\n- 끝');
    expect(parseMessage(tilde)!.fields['단계']).toBe('구현 전');
  });

  it.each([
    ['긴 경계 안의 짧은 경계', '````md\n```\n### 단계\n```\n````'],
    ['백틱 경계 안의 물결 경계', '```\n### 단계\n~~~\n### 단계\n```'],
    ['물결 경계 안의 백틱 경계', '~~~\n```\n### 단계\n```\n### 단계\n~~~'],
    ['들여쓴 경계', '- 예시\n   ```\n### 단계\n   ```'],
  ])('%s도 코드 블록으로 본다', (_, question) => {
    const body = formatMessage(
      { type: 'ask', issue: 1 },
      { 단계: '구현 전', 질문: question, '확인한 것': 'x' },
    );
    const message = parseMessage(body)!;
    expect(message.fields).toEqual({ 단계: '구현 전', 질문: question, '확인한 것': 'x' });
    expect(message.duplicates).toEqual([]);
  });

  it('닫히지 않은 코드 블록은 끝까지 코드로 본다', () => {
    const body = formatMessage(
      { type: 'ask', issue: 1 },
      { 단계: '구현 전', 질문: '```\n### 확인한 것', '확인한 것': 'x' },
    );
    expect(parseMessage(body)!.fields['질문']).toBe('```\n### 확인한 것\n\n### 확인한 것\n\nx');
  });
});

describe('validateMessage', () => {
  it.each(Object.keys(MESSAGE_TYPES) as MessageType[])(
    '%s: 정해진 쪽이 보낸 완전한 메시지는 통과한다',
    (type) => {
      const body = formatMessage({ type, ...meta }, fill(type));
      expect(check(sender(type), body).errors).toEqual([]);
    },
  );

  it('표시 줄이 없는 댓글은 오류 없이 무시한다', () => {
    expect(check(CLAUDE, '고침: 무엇을')).toEqual({ message: null, errors: [] });
  });

  it.each([
    ['값이 비어 있음', '<!-- ai-msg:v1 type=ask issue= -->'],
    ['값 사이에 공백', '<!-- ai-msg:v1 type=ask issue= 1 -->'],
    ['닫는 표시 없음', '<!-- ai-msg:v1 type=ask issue=1'],
    [
      '멘션 다음 줄의 잘못된 표시 줄',
      '@claude\n<!-- ai-msg:v1 type=start issue=1 rev=0 reply-to= -->',
    ],
    ['여는 표시 뒤 공백 없음', '<!--ai-msg:v1 type=ask issue=1 -->'],
    ['여는 표시 뒤 공백 두 칸', '<!--  ai-msg:v1 type=ask issue=1 -->'],
    ['대문자', '<!-- AI-MSG:v1 type=ask issue=1 -->'],
    ['멘션 다음 줄의 공백 없는 표시 줄', '@claude\n<!--ai-msg:v1 type=start -->'],
  ])('표시 줄 문법이 틀리면(%s) 오류로 알린다', (_, body) => {
    const result = check(CLAUDE, body);
    expect(result.message).toBeNull();
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('표시 줄 문법이 다릅니다');
  });

  it('표시 줄이 셋째 줄 이후에 있으면 오류로 알리고, 코드 블록 안이면 무시한다', () => {
    const header = formatHeader({ type: 'ask', issue: 1 });
    expect(check(CLAUDE, `안녕하세요\n\n${header}`).errors).toEqual([
      '표시 줄은 첫 줄, 또는 멘션만 있는 첫 줄 바로 다음 줄에 있어야 합니다.',
    ]);
    // 멘션 줄에 다른 글이 있으면 멘션 줄로 보지 않는다.
    expect(check(ME, `@claude 시작해\n${formatHeader({ type: 'start' })}`).errors).toEqual([
      '표시 줄은 첫 줄, 또는 멘션만 있는 첫 줄 바로 다음 줄에 있어야 합니다.',
    ]);
    const fence = '`'.repeat(3);
    expect(check(CLAUDE, `예시입니다.\n\n${fence}text\n${header}\n${fence}`)).toEqual({
      message: null,
      errors: [],
    });
  });

  it('상속된 속성 이름의 종류도 알 수 없는 종류로 알린다', () => {
    for (const type of ['constructor', 'toString', '__proto__']) {
      expect(check(CLAUDE, `<!-- ai-msg:v1 type=${type} issue=1 -->`).errors).toEqual([
        `알 수 없는 메시지 종류: ${type}`,
      ]);
    }
  });

  it('상속된 속성 이름의 절 제목도 한 번이면 중복이 아니다', () => {
    const body = formatMessage({ type: 'ask', issue: 1 }, { ...fill('ask'), constructor: 'x' });
    expect(check(CLAUDE, body).errors).toEqual([]);
  });

  it('필수 절이 없거나 비어 있으면 실패한다', () => {
    const body = formatMessage({ type: 'ask', issue: 104 }, { 단계: '구현 전', 질문: ' ' });
    expect(check(CLAUDE, body).errors).toEqual([
      '본문 절 "### 질문"이 없거나 비어 있습니다.',
      '본문 절 "### 확인한 것"이 없거나 비어 있습니다.',
    ]);
  });

  it('같은 절이 두 번 있으면 실패한다', () => {
    const body = formatMessage({ type: 'ask', issue: 104 }, fill('ask')) + '\n### 질문\n\n또\n';
    expect(check(CLAUDE, body).errors).toContain('본문 절 "### 질문"이 두 번 있습니다.');
  });

  it('answer의 재시작은 예 또는 아니오만 받는다', () => {
    for (const value of ['예', '아니오']) {
      const ok = formatMessage({ type: 'answer', ...meta }, { ...fill('answer'), 재시작: value });
      expect(check(CODEX, ok).errors).toEqual([]);
    }
    const body = formatMessage(
      { type: 'answer', ...meta },
      { ...fill('answer'), 재시작: '아마도' },
    );
    expect(check(CODEX, body).errors).toEqual([
      '본문 절 "### 재시작"의 값은 예 또는 아니오이어야 합니다: 아마도',
    ]);
  });

  it('필요한 표시 값이 없으면 실패한다', () => {
    const body = formatMessage({ type: 'answer', issue: 104 }, fill('answer'));
    expect(check(CODEX, body).errors).toEqual(['표시 값 reply-to가 필요합니다.']);
  });

  it('표시 값 형식이 다르면 실패한다', () => {
    const body = formatMessage(
      { type: 'report', issue: 104, pr: 'abc', head: 'short', rev: 'x', 'reply-to': '0' },
      fill('report'),
    );
    expect(check(CLAUDE, body).errors).toEqual([
      '표시 값 pr의 형식이 다릅니다: abc',
      '표시 값 head의 형식이 다릅니다: short',
      '표시 값 rev의 형식이 다릅니다: x',
      '표시 값 reply-to의 형식이 다릅니다: 0',
    ]);
  });

  it('표시 값의 키가 두 번 있으면 실패하고 앞 값을 남긴다', () => {
    const body = formatMessage({ type: 'ask', issue: 104 }, fill('ask')).replace(
      'issue=104',
      'issue=104 issue=999',
    );
    const result = check(CLAUDE, body);
    expect(result.errors).toEqual(['표시 값 issue가 두 번 있습니다.']);
    expect(result.message!.meta.issue).toBe('104');
  });

  it('알 수 없는 종류, 버전, 표시 키는 실패한다', () => {
    expect(check(CLAUDE, '<!-- ai-msg:v1 type=hello issue=1 -->').errors).toEqual([
      '알 수 없는 메시지 종류: hello',
    ]);
    expect(check(CLAUDE, '<!-- ai-msg:v2 type=ask issue=1 -->').errors).toEqual([
      '지원하지 않는 형식 버전입니다: v2',
    ]);
    const body = formatMessage({ type: 'ask', issue: 1 }, fill('ask')).replace(
      ' -->',
      ' color=red -->',
    );
    expect(check(CLAUDE, body).errors).toEqual(['알 수 없는 표시 값: color']);
  });

  it('보낼 수 없는 계정이 보내면 실패한다', () => {
    const ask = formatMessage({ type: 'ask', issue: 104 }, fill('ask'));
    expect(check(CODEX, ask).errors[0]).toContain('ask을 보낼 수 없습니다');
    expect(check('someone', ask).errors[0]).toContain('someone은');

    const start = formatMessage({ type: 'start', ...meta }, fill('start'));
    expect(check(CLAUDE, start).errors[0]).toContain('start을 보낼 수 없습니다');
    // Codex가 사용자 대화에서 사용자 계정으로 다는 경우
    expect(check(ME, start).errors).toEqual([]);
  });

  it('start에 @claude가 없거나 ask에 멘션이 있으면 실패한다', () => {
    const start = formatMessage({ type: 'start', ...meta }, fill('start')).replace('@claude\n', '');
    expect(check(ME, start).errors).toEqual(['첫 줄이 @claude 이어야 합니다.']);

    const ask = `@codex\n${formatMessage({ type: 'ask', issue: 104 }, fill('ask'))}`;
    expect(check(CLAUDE, ask).errors).toEqual(['ask에는 호출 멘션을 쓰지 않습니다.']);
  });
});

describe('formatErrorBody', () => {
  it('받은 값에 줄바꿈과 표시 줄이 있어도 알림이 다시 메시지로 읽히지 않는다', () => {
    const answer = formatMessage(
      { type: 'answer', ...meta },
      { ...fill('answer'), 재시작: `아마도\n${formatHeader({ type: 'ask', issue: 1 })}` },
    );
    const { errors } = check(CODEX, answer);
    expect(errors).toHaveLength(1);

    const body = formatErrorBody({ login: CODEX, url: 'https://example.test/c/1', errors });
    expect(check(CLAUDE, body)).toEqual({ message: null, errors: [] });
    expect(body).not.toContain('<!--');
    expect(body.split('\n').filter((line) => line.startsWith('- '))).toHaveLength(1);
  });

  it('표시 줄 없이 오류만 적어 다음 차례를 부르지 않는다', () => {
    const body = formatErrorBody({
      login: CLAUDE,
      url: 'https://example.test/c/1',
      errors: ['표시 값 issue가 필요합니다.'],
    });
    expect(parseMessage(body)).toBeNull();
    expect(body).toContain('- 표시 값 issue가 필요합니다.');
  });
});

describe('문서와의 일치', () => {
  const agents = readFileSync('AGENTS.md', 'utf8');

  it.each(Object.entries(MESSAGE_TYPES))(
    'AGENTS.md에 %s의 필수 절이 모두 적혀 있다',
    (type, spec) => {
      const row = agents.split('\n').find((line) => line.startsWith(`| \`${type}\` |`));
      expect(row, `${type} 행`).toBeDefined();
      for (const name of spec.fields) expect(row).toContain(name);
    },
  );

  it('plan의 필수 절이 작업 이슈 양식의 칸 이름과 같다', () => {
    const form = readFileSync('.github/ISSUE_TEMPLATE/maintainer_task.yml', 'utf8');
    for (const name of MESSAGE_TYPES.plan.fields) expect(form).toContain(`label: ${name}`);
  });
});
