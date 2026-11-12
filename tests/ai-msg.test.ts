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

const fill = (type: MessageType) =>
  Object.fromEntries(MESSAGE_TYPES[type].fields.map((name) => [name, `${name} 내용`]));
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
