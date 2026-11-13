import { describe, expect, it } from 'vitest';
import { formatMessage } from '../scripts/ai/ai-msg.js';
import { formatDuration, issueMetrics, labelSpans, metricsRow } from '../scripts/ai/metrics.js';

// 자동 흐름 측정(scripts/ai/metrics.js)의 계산을 검사한다.
const ME = 'jundragon7419';
const CODEX = 'chatgpt-codex-connector[bot]';
const CLAUDE = 'claude[bot]';
const accounts = { maintainer: ME, codexBot: CODEX, claudeBot: CLAUDE };
const at = (hours: number) => new Date(Date.UTC(2026, 10, 1) + hours * 3_600_000).toISOString();
const label = (event: string, name: string, hours: number) => ({
  event,
  label: name,
  createdAt: at(hours),
});

describe('labelSpans', () => {
  it('붙었다 떨어진 기간을 모으고, 끝나지 않은 기간은 until까지 본다', () => {
    const events = [
      label('labeled', 'ai:needs-human', 1),
      label('unlabeled', 'ai:needs-human', 3),
      label('labeled', 'ai:ready', 2),
      label('labeled', 'ai:needs-human', 5),
    ];
    const until = Date.parse(at(6));
    expect(labelSpans(events, 'ai:needs-human', until)).toEqual([
      [Date.parse(at(1)), Date.parse(at(3))],
      [Date.parse(at(5)), until],
    ]);
    expect(labelSpans(events, 'ai:needs-human', null)).toHaveLength(1);
  });
});

describe('formatDuration', () => {
  it('하루 미만은 시간, 그 이상은 일과 시간으로 쓴다', () => {
    expect(formatDuration(null)).toBe('-');
    expect(formatDuration(1.5 * 3_600_000)).toBe('1.5시간');
    expect(formatDuration(27 * 3_600_000)).toBe('1일 3.0시간');
  });
});

describe('issueMetrics', () => {
  const ask = formatMessage(
    { type: 'ask', issue: 104 },
    { 단계: '구현 전', 질문: '- q', '확인한 것': '- a' },
  );
  const needUser = formatMessage(
    { type: 'need-user', issue: 104, 'reply-to': 1 },
    { '확인할 것': 'x', '확인 방법': 'y', '붙일 것': 'z' },
  );
  const m = issueMetrics({
    issue: { number: 104, createdAt: at(0) },
    pr: { number: 111, mergedAt: at(10), head: 'h2' },
    issueComments: [
      { login: ME, body: '@claude' },
      { login: CLAUDE, body: ask },
      { login: CODEX, body: needUser },
      { login: ME, body: '  @claude 발췌를 붙였다' },
      { login: 'someone', body: '@claude' },
    ],
    prComments: [{ login: CLAUDE, body: ask }],
    issueEvents: [label('labeled', 'ai:needs-human', 1), label('unlabeled', 'ai:needs-human', 3)],
    prEvents: [label('labeled', 'ai:ready', 8), label('labeled', 'ai:in-progress', 4)],
    reviewComments: [
      { login: CODEX, body: 'P1', originalCommitId: 'h1' },
      { login: CODEX, body: 'P2', originalCommitId: 'h2' },
      { login: ME, body: '답글', originalCommitId: 'h1' },
    ],
    accounts,
  });

  it('생성부터 머지까지와, 멈춘 기간과 확인 대기를 더한 사람 대기 시간을 센다', () => {
    expect(m.leadTime).toBe(10 * 3_600_000);
    expect(m.waited).toBe((2 + 2) * 3_600_000);
  });

  it('메인테이너 @claude, 멈춤, ask, need-user, Codex 지적과 반영을 센다', () => {
    expect(m).toMatchObject({
      starts: 2,
      stops: 1,
      asks: 2,
      needUser: 1,
      findings: 2,
      answered: 1,
    });
  });

  it('표의 한 행을 만든다', () => {
    expect(metricsRow(m)).toBe('| #104 | #111 | 10.0시간 | 4.0시간 | 2 | 1 | 2 | 1 | 2 / 1 | |');
  });

  it('머지되지 않았으면 시간을 비운다', () => {
    const open = issueMetrics({
      issue: { number: 1, createdAt: at(0) },
      pr: null,
      issueComments: [],
      prComments: [],
      issueEvents: [],
      prEvents: [],
      reviewComments: [],
      accounts,
    });
    expect(metricsRow(open)).toBe('| #1 | - | - | - | 0 | 0 | 0 | 0 | 0 / 0 | |');
  });
});
