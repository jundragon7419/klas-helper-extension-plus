import { describe, expect, it } from 'vitest';
import {
  decideAnswerRestart,
  decideReview,
  parseCodexState,
  summarizeChecks,
  type ReviewInput,
  classifyCodexTask,
  codeChangeNotice,
} from '../scripts/ai/review-decision.js';
import {
  codeChangeEn,
  codeChangeKo,
  reviewNoFindings,
  reviewWithP1,
} from './helpers/codex-tasks.ts';

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
  it('이름이 있으면 check와 e2e를 따로 보고 합친다', () => {
    const run = (
      id: number,
      name: string,
      status = 'completed',
      conclusion: string | null = 'success',
    ) => ({
      id,
      name,
      status,
      conclusion,
    });
    expect(summarizeChecks([run(1, 'check'), run(2, 'e2e')])).toBe('success');
    expect(summarizeChecks([run(1, 'check')])).toBe('pending');
    expect(summarizeChecks([run(1, 'check'), run(2, 'e2e', 'completed', 'failure')])).toBe(
      'failure',
    );
    expect(summarizeChecks([run(1, 'check'), run(2, 'e2e', 'in_progress', null)])).toBe('pending');
    // e2e를 다시 돌려 성공하면 이전 실패는 보지 않는다.
    expect(
      summarizeChecks([run(1, 'check'), run(2, 'e2e', 'completed', 'failure'), run(3, 'e2e')]),
    ).toBe('success');
    // 다른 이름의 실패는 다른 이름의 최신 성공을 가리지 않는다.
    expect(
      summarizeChecks([run(5, 'check', 'completed', 'failure'), run(2, 'e2e'), run(4, 'check')]),
    ).toBe('failure');
    expect(summarizeChecks([run(1, 'other')])).toBe('missing');
  });

  it('없음, 진행 중, 성공, 실패를 구분한다', () => {
    expect(summarizeChecks([])).toBe('missing');
    expect(summarizeChecks([{ status: 'in_progress', conclusion: null }])).toBe('pending');
    expect(summarizeChecks(ok)).toBe('success');
    expect(summarizeChecks([{ status: 'completed', conclusion: 'failure' }])).toBe('failure');
  });

  it('같은 커밋에 run이 여럿이면 가장 최근(id가 큰) run만 본다', () => {
    const cancelled = { id: 1, status: 'completed', conclusion: 'cancelled' };
    const passed = { id: 2, status: 'completed', conclusion: 'success' };
    expect(summarizeChecks([cancelled, passed])).toBe('success');
    expect(summarizeChecks([passed, cancelled])).toBe('success');
    expect(summarizeChecks([passed, { id: 3, status: 'in_progress', conclusion: null }])).toBe(
      'pending',
    );
  });
});

const ME = 'jundragon7419';
const inline = (level = 1, title = '진도율 셀을 잘못 읽음', commit = HEAD, id = 300) => ({
  id,
  login: CODEX,
  path: 'utils/progress.ts',
  line: 12,
  url: `https://x/#discussion_r${id}`,
  originalCommitId: commit,
  body: `**<sub><sub>![P${level} Badge](https://img.shields.io/badge/P${level}-orange)</sub></sub>  ${title}**\n\n설명`,
});
const triage = (head: string, findings: { level: number; title: string }[], id = 400) => ({
  id,
  login: ME,
  body: `@codex (자동 요청)\n<!-- ai-review-triage:v1 ${JSON.stringify({
    head,
    findings: findings.map((f) => ({ ...f, path: 'utils/progress.ts' })),
  })} -->`,
});
const codexChange = (replyTo: number, id = 410) => ({
  id,
  login: CODEX,
  body: `@claude\n<!-- ai-msg:v1 type=change issue=148 pr=150 head=- rev=1 reply-to=${replyTo} -->\n\n### 바뀐 완료 조건\n\n- 전: a\n- 후: a\n\n### 이유\n\nP2는 넘김\n\n### 바꿀 항목\n\n- 없음`,
});

describe('decideReview', () => {
  const reviewed = (over: Partial<ReviewInput> = {}) =>
    input({
      maintainer: ME,
      reviews: [review()],
      comments: [state(HEAD, 'completed', true)],
      ...over,
    });

  it('현재 커밋 리뷰에 지적이 있으면 Codex에게 정리를 요청한다', () => {
    const d = decideReview(reviewed({ inlineComments: [inline()] }));
    expect(d).toMatchObject({ action: 'triage', addLabels: [], removeLabels: [] });
    expect(d.findings).toEqual([
      expect.objectContaining({
        level: 1,
        path: 'utils/progress.ts',
        title: '진도율 셀을 잘못 읽음',
      }),
    ]);
  });

  it('이전 커밋의 줄 단위 지적은 넘기지 않는다', () => {
    const d = decideReview(
      input({
        maintainer: ME,
        reviews: [review()],
        comments: [state(HEAD)],
        inlineComments: [inline(1, 'x', OLD)],
      }),
    );
    expect(d.action).toBe('ready');
  });

  it('이미 정리를 요청한 커밋이면 기다린다', () => {
    const d = decideReview(
      reviewed({
        inlineComments: [inline()],
        comments: [state(HEAD, 'completed', true), triage(HEAD, [{ level: 1, title: 'a' }])],
      }),
    );
    expect(d.action).toBe('none');
  });

  it('앞 회차에서 넘긴 지적이 다시 나오면 멈춘다', () => {
    const d = decideReview(
      reviewed({
        labels: ['ai:ready'],
        inlineComments: [inline()],
        comments: [
          state(HEAD, 'completed', true),
          triage(OLD, [{ level: 1, title: '진도율 셀을 잘못 읽음' }]),
        ],
      }),
    );
    expect(d).toMatchObject({
      action: 'halt',
      reason: 'finding repeated',
      addLabels: ['ai:needs-human', 'ai:in-progress'],
      removeLabels: ['ai:ready'],
    });
    expect(d.message).toContain('[P1] 진도율 셀을 잘못 읽음');
  });

  it('정리 요청 횟수를 넘으면 멈춘다', () => {
    const old = [1, 2, 3].map((i) =>
      triage(String(i).repeat(40), [{ level: 2, title: `t${i}` }], 400 + i),
    );
    const d = decideReview(
      reviewed({ inlineComments: [inline()], comments: [state(HEAD, 'completed', true), ...old] }),
    );
    expect(d).toMatchObject({ action: 'halt', reason: 'triage limit' });
  });

  it('다른 계정이 단 정리 요청 표시는 세지 않는다', () => {
    const fake = { ...triage(HEAD, [{ level: 1, title: 'a' }]), login: 'someone' };
    const d = decideReview(
      reviewed({ inlineComments: [inline()], comments: [state(HEAD, 'completed', true), fake] }),
    );
    expect(d.action).toBe('triage');
  });

  it('바꿀 항목 없이 P2만 넘긴 정리를 Claude가 처리하면 ready', () => {
    const tr = triage(HEAD, [{ level: 2, title: 'a' }]);
    const ch = codexChange(tr.id);
    const done = { login: CLAUDE, body: `report\n<!-- ai-handled:change-${ch.id} -->` };
    const comments = [state(HEAD, 'completed', true), tr, ch];
    expect(decideReview(reviewed({ inlineComments: [inline(2, 'a')], comments })).action).toBe(
      'none',
    );
    expect(
      decideReview(reviewed({ inlineComments: [inline(2, 'a')], comments: [...comments, done] }))
        .action,
    ).toBe('ready');
    // P0/P1이 남았는데 커밋이 그대로면 멈춘다.
    expect(
      decideReview(reviewed({ inlineComments: [inline(1, 'a')], comments: [...comments, done] }))
        .action,
    ).toBe('halt');
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

  it('CI가 실패하면 고치고, 고친 뒤에도 두 번 연속 실패하면 멈춘다', () => {
    const failed = [{ status: 'completed', conclusion: 'failure' }];
    const d = decideReview(input({ comments: [state(HEAD)], checkRuns: failed }));
    expect(d).toMatchObject({ action: 'fix', task: `ci-${HEAD}` });
    expect(
      decideReview(
        input({
          comments: [state(HEAD), { login: CLAUDE, body: `<!-- ai-handled:ci-${HEAD} -->` }],
          checkRuns: failed,
        }),
      ).action,
    ).toBe('none');
    const twice = ['c', 'd'].map((x) => ({
      login: CLAUDE,
      body: `<!-- ai-handled:ci-${x.repeat(40)} -->`,
    }));
    expect(
      decideReview(input({ comments: [state(HEAD), ...twice], checkRuns: failed })).action,
    ).toBe('halt');
  });

  it('다른 계정이 쓴 상태 표시로는 ready가 되지 않는다', () => {
    const d = decideReview(input({ comments: [{ ...state(HEAD), login: 'someone' }] }));
    expect(d.action).toBe('none');
  });

  it('ready 뒤에 지적이 오면 in-progress로 되돌리고 정리를 요청한다', () => {
    const d = decideReview(reviewed({ labels: ['ai:ready'], inlineComments: [inline()] }));
    expect(d).toMatchObject({
      action: 'triage',
      addLabels: ['ai:in-progress'],
      removeLabels: ['ai:ready'],
    });
  });

  it('이미 ready면 다시 알리지 않는다', () => {
    expect(decideReview(input({ labels: ['ai:ready'], comments: [state(HEAD)] })).action).toBe(
      'none',
    );
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

describe('decideAnswerRestart', () => {
  const base = { open: true, sameRepo: true, answerId: 55 };

  it('멈춘 AI PR을 Codex 답으로 다시 고치게 하고 멈춤 라벨을 지운다', () => {
    expect(
      decideAnswerRestart({ ...base, labels: ['ai:in-progress', 'ai:needs-human', 'ai:round-1'] }),
    ).toEqual({
      action: 'fix',
      reason: 'codex answer 55; task=answer-55; round=2',
      task: 'answer-55',
      round: 2,
      addLabels: ['ai:round-2'],
      removeLabels: ['ai:needs-human'],
    });
  });

  it('회차를 넘으면 다시 시작하지 않는다', () => {
    const labels = ['ai:in-progress', 'ai:needs-human', 'ai:round-1', 'ai:round-2', 'ai:round-3'];
    expect(decideAnswerRestart({ ...base, labels }).action).toBe('none');
  });

  it('자동 흐름이 아닌 PR, 닫힌 PR, 다른 저장소 PR은 다시 시작하지 않는다', () => {
    expect(decideAnswerRestart({ ...base, labels: ['task'] }).action).toBe('none');
    expect(decideAnswerRestart({ ...base, open: false, labels: ['ai:in-progress'] }).action).toBe(
      'none',
    );
    expect(
      decideAnswerRestart({ ...base, sameRepo: false, labels: ['ai:in-progress'] }).action,
    ).toBe('none');
  });
});

describe('classifyCodexTask', () => {
  it('실제 작업 결과 댓글을 리뷰와 코드 수정으로 나눈다', () => {
    expect(classifyCodexTask(reviewNoFindings(HEAD), HEAD)).toEqual({
      kind: 'review',
      findings: 0,
      blocking: 0,
    });
    expect(classifyCodexTask(reviewWithP1(HEAD), HEAD)).toEqual({
      kind: 'review',
      findings: 1,
      blocking: 1,
    });
    expect(classifyCodexTask(codeChangeKo(HEAD), HEAD)?.kind).toBe('code-change');
    expect(classifyCodexTask(codeChangeEn(HEAD), HEAD)?.kind).toBe('code-change');
  });

  it('현재 커밋 링크가 없거나 작업 결과가 아니면 null, 리뷰도 수정도 아니면 other', () => {
    expect(classifyCodexTask(reviewWithP1(OLD), HEAD)).toBeNull();
    expect(classifyCodexTask(state(HEAD).body, HEAD)).toBeNull();
    const other = `질문에 대한 설명입니다. [a](https://github.com/o/r/blob/${HEAD}/a.js)\n[View task →](https://x)`;
    expect(classifyCodexTask(other, HEAD)?.kind).toBe('other');
  });
});

describe('decideReview와 Codex 작업 결과', () => {
  const at = (body: string, time: string, id = 50) => ({ id, login: CODEX, body, at: time });

  it('Codex가 코드를 고친 작업 결과가 남으면 사용자에게 넘긴다', () => {
    const d = decideReview(
      input({ labels: ['ai:ready'], comments: [at(codeChangeEn(HEAD), '2026-11-13T02:13:02Z')] }),
    );
    expect(d).toMatchObject({
      action: 'halt',
      notice: 50,
      addLabels: ['ai:needs-human', 'ai:in-progress'],
      removeLabels: ['ai:ready'],
    });
  });

  it('그 뒤에 현재 커밋을 다시 리뷰받았으면 리뷰로 판단한다', () => {
    const d = decideReview(
      input({
        comments: [
          at(codeChangeEn(HEAD), '2026-11-13T02:13:02Z'),
          at(reviewNoFindings(HEAD), '2026-11-13T05:00:00Z', 51),
        ],
      }),
    );
    expect(d.action).toBe('ready');
  });

  it('작업 결과 리뷰의 [P0]~[P3]도 정리 요청에 넘긴다', () => {
    const d = decideReview(
      input({ maintainer: ME, comments: [at(reviewWithP1(HEAD), '2026-11-13T02:00:00Z', 60)] }),
    );
    expect(d.action).toBe('triage');
    expect(d.findings?.[0]).toMatchObject({ level: 1 });
  });

  it('지적 없는 작업 결과 리뷰와 CI 통과면 준비 완료', () => {
    expect(
      decideReview(input({ comments: [at(reviewNoFindings(HEAD), '2026-11-13T02:00:00Z')] }))
        .action,
    ).toBe('ready');
  });

  it('알림에 작업 결과 링크와 다시 진행하는 방법을 적는다', () => {
    const text = codeChangeNotice({
      maintainer: 'jundragon7419',
      head: HEAD,
      url: 'https://x/#issuecomment-50',
    });
    expect(text).toContain('@jundragon7419');
    expect(text).toContain('https://x/#issuecomment-50');
    expect(text).toContain('@codex review');
    expect(text).toContain('ai:needs-human');
  });
});
