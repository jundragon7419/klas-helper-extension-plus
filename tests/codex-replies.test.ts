import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseMessage, validateMessage } from '../scripts/ai/ai-msg.js';
import { rolesOf } from '../scripts/ai/relay.js';
import { classifyCodexTask } from '../scripts/ai/review-decision.js';

// #145에서 받은 Codex 실제 답(tests/fixtures/codex/probe-145.json)으로 파서와 분류를 검사한다.
const probe = JSON.parse(readFileSync('tests/fixtures/codex/probe-145.json', 'utf8')) as {
  head: string;
  replies: { id: number; login: string; body: string }[];
};
const reply = (id: number) => probe.replies.find((r) => r.id === id)!;
const roles = rolesOf({ codexBot: 'chatgpt-codex-connector[bot]', maintainer: 'jundragon7419' });

describe('Codex 실제 답 (#145)', () => {
  it('틀을 준 change는 통과하고, 끝의 View task 줄은 절 내용에 들어가지 않는다', () => {
    const { message, errors } = validateMessage(reply(6847277026), roles);
    expect(errors).toEqual([]);
    expect(message?.meta).toMatchObject({ type: 'change', 'reply-to': '6847260954' });
    expect(message?.fields['바꿀 항목']).not.toContain('View task');
  });

  it('틀을 준 answer는 통과하고 재시작이 예로 읽힌다', () => {
    const { message, errors } = validateMessage(reply(6847281871), roles);
    expect(errors).toEqual([]);
    expect(message?.fields['재시작']).toBe('예');
  });

  it('틀 없는 요청에 코드를 고친 답은 코드 수정으로 분류된다', () => {
    expect(classifyCodexTask(reply(6847203542).body, probe.head)?.kind).toBe('code-change');
    expect(parseMessage(reply(6847203542).body)).toBeNull();
  });
});

describe('끝의 Codex 작업 링크 줄', () => {
  const answer = (tail: string) =>
    [
      '<!-- ai-msg:v1 type=answer issue=1 pr=- head=- rev=- reply-to=2 -->',
      '',
      '### 답',
      '',
      '- 답',
      '',
      '### 근거',
      '',
      '- a.js:1',
      '',
      '### 재시작',
      '',
      `예${tail}`,
    ].join('\n');

  it('맨 끝의 링크 줄과 빈 줄만 뗀다', () => {
    const link = ' [View task →](https://chatgpt.com/s/cd_1)';
    expect(parseMessage(answer(`\n\n${link}\n`))?.fields['재시작']).toBe('예');
    expect(parseMessage(answer(`\n${link}`))?.fields['재시작']).toBe('예');
  });

  it('다른 주소나 본문 중간의 링크는 그대로 둔다', () => {
    expect(
      parseMessage(answer('\n\n[View task →](https://example.com/x)'))?.fields['재시작'],
    ).toContain('example.com');
    const middle = answer('').replace('- 답', '- 답 [View task →](https://chatgpt.com/s/cd_1)');
    expect(parseMessage(middle)?.fields['답']).toContain('View task');
  });
});
