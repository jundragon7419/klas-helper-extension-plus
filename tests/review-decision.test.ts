import { describe, expect, it } from 'vitest';
import {
  decideReview,
  parseCodexState,
  summarizeChecks,
  type ReviewInput,
} from '../scripts/ai/review-decision.js';

// AI review loop 워크플로의 판단(scripts/ai/review-decision.js)을 검사한다.
const CODEX = 'chatgpt-codex-connector[bot]';
const CLAUDE = 'claude[bot]';
const HEAD = 'a'.repeat(40);
const OLD = 'b'.repeat(40);
const ok = [{ status: 'completed', conclusion: 'success' }];

const state = (sha: string, status = 'completed', findings = false) => ({
  login: CODEX,
  body: `**Codex Review Summary**\n<!-- codex-review-state:v1 {"code_review":{"commit_sha":"${sha}","has_any_findings":${findings},"has_unresolved_findings":${findings},"status":"${status}"},"security_review":{"commit_sha":null}} -->`,
});
const review = (over: Partial<ReviewInput['reviews'][number]> = {}) => ({
  id: 9,
  login: CODEX,
  commitId: HEAD,
  inlineCount: 1,
  ...over,
});
const input = (over: Partial<ReviewInput> = {}): ReviewInput => ({
  labels: ['ai:in-progress'],
  open: true,
  sameRepo: true,
  head: HEAD,
  comments: [],
  reviews: [],
  checkRuns: ok,
  codexBot: CODEX,
  handlerBot: CLAUDE,
  ...over,
});

describe('parseCodexState', () => {
  it('요약 댓글의 code_review를 꺼낸다', () => {
    expect(parseCodexState(state(HEAD).body)).toMatchObject({
      commit_sha: HEAD,
      status: 'completed',
      has_any_findings: false,
    });
  });

  it('표시가 없거나 JSON이 깨졌으면 null', () => {
    expect(parseCodexState('그냥 댓글')).toBeNull();
    expect(parseCodexState('<!-- codex-review-state:v1 {bad} -->')).toBeNull();
    expect(parseCodexState(undefined)).toBeNull();
  });
});

describe('summarizeChecks', () => {
  it('없음, 진행 중, 성공, 실패를 구분한다', () => {
    expect(summarizeChecks([])).toBe('missing');
    expect(summarizeChecks([{ status: 'in_progress', conclusion: null }])).toBe('pending');
    expect(summarizeChecks(ok)).toBe('success');
    expect(summarizeChecks([{ status: 'completed', conclusion: 'failure' }])).toBe('failure');
  });
});

describe('decideReview', () => {
  it('현재 head에 줄 단위 지적이 있으면 고친다', () => {
    const d = decideReview(
      input({ reviews: [review()], comments: [state(HEAD, 'completed', true)] }),
    );
    expect(d).toMatchObject({
      action: 'fix',
      task: 'review-9',
      round: 1,
      addLabels: ['ai:round-1'],
    });
  });

  it('이전 커밋의 지적은 무시한다', () => {
    const d = decideReview(
      input({ reviews: [review({ commitId: OLD })], comments: [state(OLD, 'completed', true)] }),
    );
    expect(d.action).toBe('none');
  });

  it('한국어 본문만 있고 줄 단위 지적이 없는 리뷰는 지적이 아니다', () => {
    const d = decideReview(
      input({ reviews: [review({ inlineCount: 0 })], comments: [state(HEAD)] }),
    );
    expect(d).toMatchObject({
      action: 'ready',
      addLabels: ['ai:ready'],
      removeLabels: ['ai:in-progress'],
    });
  });

  it('현재 head 검토 완료, 지적 없음, CI 성공이면 ready', () => {
    expect(decideReview(input({ comments: [state(HEAD)] })).action).toBe('ready');
  });

  it('이전 SHA의 완료 상태로는 ready가 되지 않는다', () => {
    expect(decideReview(input({ comments: [state(OLD)] })).action).toBe('none');
  });

  it('검토 진행 중이거나 CI가 끝나지 않았으면 기다린다', () => {
    expect(decideReview(input({ comments: [state(HEAD, 'running')] })).action).toBe('none');
    expect(
      decideReview(
        input({
          comments: [state(HEAD)],
          checkRuns: [{ status: 'in_progress', conclusion: null }],
        }),
      ).action,
    ).toBe('none');
  });

  it('상태가 지적 있음을 가리키면 줄 단위 댓글이 오기 전이라도 ready가 되지 않는다', () => {
    expect(decideReview(input({ comments: [state(HEAD, 'completed', true)] })).action).toBe('none');
  });

  it('CI가 실패하면 고친다', () => {
    const d = decideReview(
      input({
        comments: [state(HEAD)],
        checkRuns: [{ status: 'completed', conclusion: 'failure' }],
      }),
    );
    expect(d).toMatchObject({ action: 'fix', task: `ci-${HEAD}` });
  });

  it('Claude가 처리 표시를 남긴 지적은 다시 고치지 않는다', () => {
    const d = decideReview(
      input({
        reviews: [review()],
        comments: [{ login: CLAUDE, body: '이견: ...\n<!-- ai-handled:review-9 -->' }],
      }),
    );
    expect(d.action).toBe('none');
  });

  it('다른 계정이 단 처리 표시는 인정하지 않는다', () => {
    const d = decideReview(
      input({
        reviews: [review()],
        comments: [{ login: 'someone', body: '<!-- ai-handled:review-9 -->' }],
      }),
    );
    expect(d.action).toBe('fix');
  });

  it('다른 계정이 쓴 상태 표시로는 ready가 되지 않는다', () => {
    const d = decideReview(input({ comments: [{ ...state(HEAD), login: 'someone' }] }));
    expect(d.action).toBe('none');
  });

  it('ready 뒤에 지적이 오면 in-progress로 되돌리고 고친다', () => {
    const d = decideReview(input({ labels: ['ai:ready', 'ai:round-1'], reviews: [review()] }));
    expect(d).toMatchObject({
      action: 'fix',
      round: 2,
      addLabels: ['ai:in-progress', 'ai:round-2'],
      removeLabels: ['ai:ready'],
    });
  });

  it('이미 ready면 다시 알리지 않는다', () => {
    expect(decideReview(input({ labels: ['ai:ready'], comments: [state(HEAD)] })).action).toBe(
      'none',
    );
  });

  it('세 번 고친 뒤에도 지적이 남으면 멈춘다', () => {
    const d = decideReview(
      input({
        labels: ['ai:in-progress', 'ai:round-1', 'ai:round-2', 'ai:round-3'],
        reviews: [review()],
      }),
    );
    expect(d).toMatchObject({ action: 'stop', addLabels: ['ai:needs-human'] });
  });

  it('ready에서 회차 제한으로 멈추면 in-progress로 되돌린다', () => {
    const d = decideReview(
      input({
        labels: ['ai:ready', 'ai:round-1', 'ai:round-2', 'ai:round-3'],
        reviews: [review()],
      }),
    );
    expect(d).toMatchObject({
      action: 'stop',
      addLabels: ['ai:needs-human', 'ai:in-progress'],
      removeLabels: ['ai:ready'],
    });
  });

  it('멈춘 PR, 자동 흐름이 아닌 PR, 닫힌 PR, 다른 저장소 PR은 판단하지 않는다', () => {
    for (const over of [
      { labels: ['ai:in-progress', 'ai:needs-human'] },
      { labels: ['task'] },
      { open: false },
      { sameRepo: false },
    ]) {
      expect(decideReview(input({ comments: [state(HEAD)], ...over })).reason).toBe(
        'not an active AI PR',
      );
    }
  });
});
