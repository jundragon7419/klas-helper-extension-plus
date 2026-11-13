import { describe, expect, it } from 'vitest';
import { formatMessage } from '../scripts/ai/ai-msg.js';
import {
  classifyChange,
  collectRevisions,
  decideChange,
  formatPlan,
  MAX_CHANGES,
  revisionRecordBody,
} from '../scripts/ai/change.js';
import { rolesOf } from '../scripts/ai/relay.js';

// PR 수정 요청(scripts/ai/change.js)의 판단을 검사한다.
const CODEX = 'chatgpt-codex-connector[bot]';
const CLAUDE = 'claude[bot]';
const ME = 'jundragon7419';
const roles = rolesOf({ codexBot: CODEX, maintainer: ME });
const ISSUE = 104;
const PR = 111;

const fields = {
  '바뀐 완료 조건': '- 전: 파란색\n- 후: 헤더 글자색',
  이유: '헤더와 어울리지 않음',
  '바꿀 항목': '- 링크 글자색',
};
const change = (id: number, over: Record<string, string | number> = {}, login = CODEX) => ({
  id,
  login,
  body: formatMessage(
    { type: 'change', issue: ISSUE, pr: PR, rev: 1, 'reply-to': 10, ...over },
    fields,
  ),
});
const planRev = (id: number, rev: number, login = CODEX) => ({
  id,
  login,
  body: formatMessage(
    { type: 'plan-rev', issue: ISSUE, rev, 'reply-to': 1 },
    { '바뀐 완료 조건': '전 / 후', 이유: '요청' },
  ),
});
const request = { id: 10, login: ME, body: '@codex 링크 색을 헤더와 같게 바꿔 줘' };
// 이슈에서 plan-rev의 근거가 되는 메인테이너 댓글
const issueRequest = { id: 1, login: ME, body: '@codex 완료 조건을 바꿔 줘' };

const classify = (
  comment: { id: number; login: string; body: string },
  comments: { id: number; login: string; body: string }[] = [request, comment],
  issueComments: { id: number; login: string; body: string }[] = [],
  issue: number | null = ISSUE,
) => classifyChange({ comment, comments, issueComments, roles, issue, pr: PR });

describe('classifyChange', () => {
  it('근거 사용자 댓글이 있는 Codex change를 실행한다', () => {
    const c = change(20);
    expect(classify(c)).toEqual({ kind: 'run', errors: [], changeId: 20, rev: 1, replyTo: 10 });
  });

  it('메인테이너가 보낸 change도 실행한다', () => {
    expect(classify(change(20, {}, ME)).kind).toBe('run');
  });

  it('다른 계정이 단 change는 알리지 않고 무시한다', () => {
    expect(classify(change(20, {}, 'someone')).kind).toBe('none');
    expect(classify(change(20, {}, CLAUDE)).kind).toBe('none');
  });

  it('change가 아닌 댓글은 무시한다', () => {
    expect(classify({ id: 20, login: CODEX, body: 'Codex Review: ...' }).kind).toBe('none');
    expect(classify(planRev(20, 1)).kind).toBe('none');
  });

  it('근거 댓글이 없거나 메인테이너 댓글이 아니면 실행하지 않는다', () => {
    const missing = change(20, { 'reply-to': 99 });
    expect(classify(missing).kind).toBe('invalid');
    const other = { id: 10, login: 'someone', body: '@codex 바꿔' };
    const r = classify(change(20), [other, change(20)]);
    expect(r.kind).toBe('invalid');
    expect(r.errors.join()).toContain('reply-to 10');
  });

  it('근거 댓글은 change보다 먼저 달려 있어야 한다', () => {
    const later = { id: 30, login: ME, body: '@codex ...' };
    const c = change(20, { 'reply-to': 30 });
    expect(classify(c, [c, later]).kind).toBe('invalid');
  });

  it('pr이나 issue 값이 다르면 실행하지 않는다', () => {
    expect(classify(change(20, { pr: 112 })).kind).toBe('invalid');
    expect(classify(change(20, { issue: 105 })).kind).toBe('invalid');
    expect(classify(change(20), undefined, [], null).kind).toBe('invalid');
  });

  it('형식이 틀린 change는 오류를 알린다', () => {
    const noItems = {
      id: 20,
      login: CODEX,
      body: formatMessage(
        { type: 'change', issue: ISSUE, pr: PR, rev: 1, 'reply-to': 10 },
        { 이유: '요청' },
      ),
    };
    expect(classify(noItems).kind).toBe('invalid');
    const badHeader = {
      id: 20,
      login: CODEX,
      body: '@claude\n<!-- ai-msg:v1 type=change issue=x -->',
    };
    expect(classify(badHeader).kind).toBe('invalid');
  });

  it('rev는 이전 change보다 크고 이슈의 plan-rev보다 작지 않아야 한다', () => {
    const first = change(20, { rev: 1 });
    const done = { id: 21, login: CLAUDE, body: '<!-- ai-handled:change-20 -->' };
    const same = change(30, { rev: 1 });
    expect(classify(same, [request, first, done, same]).kind).toBe('invalid');
    const next = change(30, { rev: 2 });
    expect(classify(next, [request, first, done, next]).kind).toBe('run');
    expect(classify(change(30, { rev: 2 }), undefined, [issueRequest, planRev(5, 3)]).kind).toBe(
      'invalid',
    );
    // 이슈에 같은 rev의 plan-rev를 먼저 남긴 경우
    expect(classify(change(30, { rev: 3 }), undefined, [issueRequest, planRev(5, 3)]).kind).toBe(
      'run',
    );
  });

  it('다른 계정이 단 plan-rev는 rev 계산에 넣지 않는다', () => {
    expect(
      classify(change(30, { rev: 1 }), undefined, [issueRequest, planRev(5, 9, 'someone')]).kind,
    ).toBe('run');
  });

  it('이미 처리한 change는 다시 실행하지 않는다', () => {
    const c = change(20);
    const done = { id: 21, login: CLAUDE, body: 'report\n<!-- ai-handled:change-20 -->' };
    expect(classify(c, [request, c, done]).kind).toBe('none');
    const fake = { id: 21, login: 'someone', body: '<!-- ai-handled:change-20 -->' };
    expect(classify(c, [request, c, fake]).kind).toBe('run');
  });

  it('실행하지 않은 change는 rev와 횟수에 넣지 않는다', () => {
    const rejected = Array.from({ length: MAX_CHANGES }, (_, i) =>
      change(20 + i, { rev: 5 + i, 'reply-to': 99 }),
    );
    const otherPr = change(30, { rev: 9, pr: 112 });
    const next = change(40, { rev: 1 });
    expect(classify(next, [request, ...rejected, otherPr, next]).kind).toBe('run');
  });

  it('근거 댓글이 없는 plan-rev는 rev 계산에 넣지 않는다', () => {
    expect(classify(change(30, { rev: 1 }), undefined, [planRev(5, 3)]).kind).toBe('run');
  });

  it(`PR당 ${MAX_CHANGES}회를 넘으면 멈춘다`, () => {
    const earlier = Array.from({ length: MAX_CHANGES }, (_, i) => change(20 + i, { rev: i + 1 }));
    const next = change(40, { rev: MAX_CHANGES + 1 });
    const r = classify(next, [request, ...earlier, next]);
    expect(r.kind).toBe('limit');
  });
});

describe('decideChange', () => {
  const run = { kind: 'run' as const, errors: [], changeId: 20, rev: 1, replyTo: 10 };

  it('실행하면 ai:ready, ai:needs-human, 회차 라벨을 지우고 ai:in-progress를 붙인다', () => {
    const d = decideChange({
      labels: ['ai:ready', 'ai:round-2', 'ai:round-1', 'area: build'],
      open: true,
      sameRepo: true,
      reply: run,
    });
    expect(d.action).toBe('fix');
    expect(d.task).toBe('change-20');
    expect(d.addLabels).toEqual(['ai:in-progress']);
    expect(d.removeLabels).toEqual(['ai:ready', 'ai:round-2', 'ai:round-1']);
  });

  it('멈춘 PR에서도 실행한다', () => {
    const d = decideChange({
      labels: ['ai:needs-human', 'ai:in-progress'],
      open: true,
      sameRepo: true,
      reply: run,
    });
    expect(d.action).toBe('fix');
    expect(d.addLabels).toEqual([]);
    expect(d.removeLabels).toEqual(['ai:needs-human']);
  });

  it('자동 흐름 PR이 아니거나 닫혔거나 다른 저장소 브랜치면 실행하지 않는다', () => {
    expect(decideChange({ labels: [], open: true, sameRepo: true, reply: run }).action).toBe(
      'none',
    );
    expect(
      decideChange({ labels: ['ai:ready'], open: false, sameRepo: true, reply: run }).action,
    ).toBe('none');
    expect(
      decideChange({ labels: ['ai:ready'], open: true, sameRepo: false, reply: run }).action,
    ).toBe('none');
  });

  it('형식 오류는 알리기만 하고, 회차 초과는 멈춘다', () => {
    const invalid = { kind: 'invalid' as const, errors: ['x'] };
    expect(
      decideChange({ labels: ['ai:ready'], open: true, sameRepo: true, reply: invalid }),
    ).toMatchObject({
      action: 'reject',
      addLabels: [],
      removeLabels: [],
    });
    const limit = { kind: 'limit' as const, errors: ['x'], changeId: 40 };
    expect(
      decideChange({ labels: ['ai:ready'], open: true, sameRepo: true, reply: limit }),
    ).toMatchObject({
      action: 'halt',
      addLabels: ['ai:needs-human', 'ai:in-progress'],
      removeLabels: ['ai:ready'],
    });
  });
});

describe('collectRevisions와 formatPlan', () => {
  it('이슈와 PR의 개정을 rev 순으로 모으고 최신 rev를 적는다', () => {
    const revisions = collectRevisions({
      issue: ISSUE,
      pr: PR,
      issueComments: [issueRequest, planRev(5, 1), planRev(6, 1, 'someone')],
      prComments: [request, change(20, { rev: 2 })],
      roles,
    });
    expect(revisions.map((r) => [r.type, r.rev, r.where])).toEqual([
      ['plan-rev', 1, 'issue'],
      ['change', 2, 'pr'],
    ]);
    const plan = formatPlan({
      issue: ISSUE,
      title: '링크 색',
      body: '### 완료 조건\n\n- 파란색',
      revisions,
    });
    expect(plan).toContain('최신 rev 2');
    expect(plan).toContain('## rev 0: 이슈 본문 (링크 색)');
    expect(plan).toContain('## rev 2: change (PR 댓글 20)');
    expect(plan).toContain('- 링크 글자색');
  });

  it('실행하지 않은 change와 회차를 넘긴 change는 계획에 넣지 않는다', () => {
    const accepted = Array.from({ length: MAX_CHANGES }, (_, i) => change(20 + i, { rev: i + 1 }));
    const revisions = collectRevisions({
      issue: ISSUE,
      pr: PR,
      issueComments: [],
      prComments: [
        request,
        change(15, { rev: 7, 'reply-to': 99 }),
        ...accepted,
        change(30, { rev: 2 }),
        change(40, { rev: MAX_CHANGES + 1 }),
      ],
      roles,
    });
    expect(revisions.map((r) => r.id)).toEqual(accepted.map((c) => c.id));
  });

  it('pr을 모르면 change를 모으지 않는다', () => {
    const revisions = collectRevisions({
      issue: ISSUE,
      issueComments: [],
      prComments: [request, change(20)],
      roles,
    });
    expect(revisions).toEqual([]);
  });

  it('옮긴 글의 숨은 표시를 무력화한다', () => {
    const plan = formatPlan({
      issue: ISSUE,
      title: 't',
      body: '<!-- ai-msg:v1 type=start -->',
      revisions: [],
    });
    expect(plan).not.toContain('<!--');
    const record = revisionRecordBody({
      pr: PR,
      rev: 1,
      url: 'https://example.test/c/20',
      fields: { 이유: '<!-- x -->' },
    });
    expect(record).toContain('PR #111에서 계획을 rev 1로 고쳤습니다');
    expect(record).not.toContain('<!--');
  });
});
