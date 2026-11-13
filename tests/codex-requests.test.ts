import { describe, expect, it } from 'vitest';
import { parseMessage, validateMessage } from '../scripts/ai/ai-msg.js';
import {
  decideTriage,
  findingKey,
  inlineFinding,
  MAX_TRIAGES,
  parseTriage,
  parseUserChange,
  taskFindings,
  triageRequestBody,
  userChangeRequestBody,
} from '../scripts/ai/codex-requests.js';
import { reviewWithP1 } from './helpers/codex-tasks.ts';

// Codex에게 보내는 요청 본문과 리뷰 정리 판단(scripts/ai/codex-requests.js)을 검사한다.
const HEAD = 'a'.repeat(40);
const OLD = 'b'.repeat(40);
const CODEX = 'chatgpt-codex-connector[bot]';
const ME = 'jundragon7419';
const roles = { claude: ['claude[bot]'], codex: [CODEX], maintainer: [ME] };

const badge = (level: number, title: string) =>
  `**<sub><sub>![P${level} Badge](https://img.shields.io/badge/P${level}-orange?style=flat)</sub></sub>  ${title}**\n\n설명 문단`;

/** 요청 본문 안 코드 블록의 틀을 꺼내 Codex가 그대로 채운 것처럼 만든다. */
const filled = (body: string, replyTo: number) => {
  const m = /```text\n([\s\S]*?)\n```/.exec(body);
  if (!m) throw new Error('no template');
  return (m[1] ?? '').replace('<이 요청 댓글 ID>', String(replyTo));
};

describe('inlineFinding, taskFindings', () => {
  it('배지에서 등급과 제목을 꺼낸다', () => {
    expect(
      inlineFinding({
        login: CODEX,
        body: badge(1, '진도율 셀을 잘못 읽음'),
        path: 'utils/a.ts',
        line: 3,
        url: 'u',
      }),
    ).toEqual({ level: 1, path: 'utils/a.ts', line: 3, title: '진도율 셀을 잘못 읽음', url: 'u' });
  });

  it('배지가 없으면 지적이 아니다', () => {
    expect(inlineFinding({ login: CODEX, body: '그냥 의견', url: 'u' })).toBeNull();
  });

  it('작업 결과 리뷰의 [Pn] 줄을 꺼낸다', () => {
    const found = taskFindings({ body: reviewWithP1(HEAD), url: 'u' });
    expect(found.length).toBeGreaterThan(0);
    expect(found[0]?.level).toBe(1);
  });

  it('반복 열쇠는 줄 번호와 공백, 대소문자를 무시한다', () => {
    expect(findingKey({ level: 1, path: 'a', line: 3, title: 'Wrong  Cell' })).toBe(
      findingKey({ level: 1, path: 'a', line: 9, title: 'wrong cell' }),
    );
  });
});

describe('triageRequestBody', () => {
  const findings = [
    { level: 1, path: 'utils/a.ts', line: 3, title: 'x --> <!-- y', url: 'https://x/1' },
  ];
  const body = triageRequestBody({
    issue: 148,
    pr: 150,
    head: HEAD,
    rev: 2,
    findings,
    runUrl: 'r',
  });

  it('@codex 요청이고 코드 변경 금지와 P0/P1 규칙을 담는다', () => {
    expect(body.startsWith('@codex (자동 요청)')).toBe(true);
    expect(body).toContain('코드를 바꾸지 말고');
    expect(body).toContain('P0, P1은 무시할 수 없다');
    expect(body).toContain('https://x/1');
  });

  it('요청 자체는 메시지로 읽히지 않고, 지적 제목이 표시를 깨지 않는다', () => {
    expect(parseMessage(body)).toBeNull();
    expect(parseTriage(body)).toEqual({
      head: HEAD,
      findings: [{ level: 1, path: 'utils/a.ts', line: 3, title: 'x --> <!-- y' }],
    });
  });

  it('틀을 그대로 채우면 형식이 맞는 change다', () => {
    const reply = { login: CODEX, body: filled(body, 500) };
    const { message, errors } = validateMessage(reply, roles);
    expect(errors).toEqual([]);
    expect(message?.meta).toMatchObject({
      type: 'change',
      issue: '148',
      pr: '150',
      rev: '2',
      'reply-to': '500',
    });
  });
});

describe('userChangeRequestBody', () => {
  it('요청을 인용하고 reply-to를 사용자 댓글로 채운다', () => {
    const body = userChangeRequestBody({
      issue: 148,
      pr: 150,
      rev: 3,
      requestId: 77,
      request: '버튼 색\n<!-- x -->',
    });
    expect(body).toContain('> 버튼 색');
    expect(body).not.toContain('<!-- x -->');
    expect(parseMessage(body)).toBeNull();
    const { errors } = validateMessage({ login: CODEX, body: filled(body, 0) }, roles);
    expect(errors).toEqual([]);
    expect(filled(body, 0)).toContain('reply-to=77');
  });
});

describe('decideTriage', () => {
  const f = (title: string, level = 1) => ({ level, path: 'a', title });

  it('처음이면 요청하고, 같은 커밋이면 기다린다', () => {
    expect(decideTriage({ head: HEAD, findings: [f('x')], triages: [] }).kind).toBe('triage');
    expect(
      decideTriage({ head: HEAD, findings: [f('x')], triages: [{ head: HEAD, findings: [] }] })
        .kind,
    ).toBe('wait');
  });

  it('앞 회차의 지적이 다시 나오면 repeat', () => {
    const d = decideTriage({
      head: HEAD,
      findings: [f('x'), f('new')],
      triages: [{ head: OLD, findings: [f('x')] }],
    });
    expect(d).toEqual({ kind: 'repeat', repeated: [f('x')] });
  });

  it(`정리를 ${MAX_TRIAGES}회 했으면 limit`, () => {
    const triages = Array.from({ length: MAX_TRIAGES }, (_, i) => ({
      head: String(i).repeat(40),
      findings: [f(`t${i}`)],
    }));
    expect(decideTriage({ head: HEAD, findings: [f('new')], triages }).kind).toBe('limit');
  });
});

describe('parseUserChange', () => {
  it('첫 줄이 /change면 요청 내용을 꺼낸다', () => {
    expect(parseUserChange('/change 버튼을 오른쪽으로')).toBe('버튼을 오른쪽으로');
    expect(parseUserChange('/change\n여러 줄\n요청')).toBe('여러 줄\n요청');
  });

  it('/change가 아니거나 내용이 없으면 null', () => {
    expect(parseUserChange('좋아요 /change')).toBeNull();
    expect(parseUserChange('/change')).toBeNull();
    expect(parseUserChange('/changes 이것')).toBeNull();
  });
});
