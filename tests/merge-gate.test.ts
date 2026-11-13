import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decideGate, GATE_CONTEXT, updateGate, type GateInput } from '../scripts/ai/merge-gate.js';

// 머지 게이트(scripts/ai/merge-gate.js)의 판단을 검사한다.
const CODEX = 'chatgpt-codex-connector[bot]';
const HEAD = 'a'.repeat(40);
const OLD = 'b'.repeat(40);
const passed = { id: 2, status: 'completed', conclusion: 'success' };

const stateComment = (sha: string, status = 'completed', findings = false) => ({
  login: CODEX,
  body: `<!-- codex-pull-request-review-summary --> <!-- codex-review-state:v1 {"code_review":{"commit_sha":"${sha}","has_any_findings":${findings},"has_unresolved_findings":${findings},"status":"${status}"}} -->`,
});
const receipt = (sha: string) => ({
  login: CODEX,
  body: `<!-- codex-review-receipt:v1 -->\n\nCodex Review: Didn't find any major issues.\n\n**Reviewed commit:** \`${sha.slice(0, 10)}\``,
});
const finding = (badge: 'P0' | 'P1' | 'P2', sha = HEAD) => ({
  login: CODEX,
  originalCommitId: sha,
  body: `**<sub><sub>![${badge} Badge](https://img.shields.io/badge/${badge}-orange?style=flat)</sub></sub>  지적**`,
});

const input = (over: Partial<GateInput> = {}): GateInput => ({
  head: HEAD,
  labels: [],
  comments: [stateComment(HEAD)],
  reviews: [],
  inlineComments: [],
  checkRuns: [passed],
  codexBot: CODEX,
  ...over,
});

describe('decideGate', () => {
  it('현재 커밋의 Codex 리뷰가 끝나고 CI가 통과하면 성공', () => {
    expect(decideGate(input()).state).toBe('success');
  });

  it('리뷰 완료는 요약 상태, 리뷰 객체, @codex review 응답 중 하나로 인정한다', () => {
    expect(decideGate(input({ comments: [receipt(HEAD)] })).state).toBe('success');
    expect(
      decideGate(input({ comments: [], reviews: [{ login: CODEX, commitId: HEAD }] })).state,
    ).toBe('success');
  });

  it('리뷰가 아직 없거나 진행 중이거나 이전 커밋 것이면 대기', () => {
    for (const comments of [
      [],
      [stateComment(HEAD, 'running')],
      [stateComment(OLD)],
      [receipt(OLD)],
      [{ login: 'someone', body: stateComment(HEAD).body }],
    ]) {
      expect(decideGate(input({ comments }))).toEqual({
        state: 'pending',
        description: '현재 커밋의 Codex 리뷰 대기 중',
      });
    }
    expect(
      decideGate(input({ comments: [], reviews: [{ login: CODEX, commitId: OLD }] })).state,
    ).toBe('pending');
  });

  it('현재 커밋의 P0, P1 지적은 막는다', () => {
    const d = decideGate(input({ inlineComments: [finding('P1'), finding('P0')] }));
    expect(d).toEqual({ state: 'failure', description: 'Codex P0/P1 지적 2건이 현재 커밋에 있음' });
  });

  it('P2 지적과 이전 커밋에서 단 지적은 막지 않는다', () => {
    // 이전 커밋 지적은 GitHub가 새 커밋 위치로 옮겨 보여 주지만 originalCommitId는 그대로다.
    const d = decideGate(
      input({
        comments: [stateComment(HEAD, 'completed', true)],
        inlineComments: [finding('P2'), finding('P1', OLD)],
      }),
    );
    expect(d.state).toBe('success');
  });

  // PR #129: Codex가 리뷰를 작업 결과 댓글로 남긴 경우
  const taskReview = (sha: string, tags: string[]) => ({
    login: CODEX,
    body: [
      '## 검토 결과',
      ...tags.map(
        (tag) =>
          `- **[${tag}] 지적 제목**  \n  설명 [scripts/ai/relay.jsL1](https://github.com/o/r/blob/${sha}/scripts/ai/relay.js#L1)`,
      ),
      '',
      `[scripts/a.js](https://github.com/o/r/blob/${sha}/scripts/a.js)`,
      '',
      ' [View task →](https://chatgpt.com/s/cd_1)',
    ].join('\n'),
  });

  it('현재 커밋을 가리키는 작업 결과 댓글도 리뷰로 인정하고 [P0]/[P1]을 센다', () => {
    expect(decideGate(input({ comments: [taskReview(HEAD, [])] })).state).toBe('success');
    expect(decideGate(input({ comments: [taskReview(HEAD, ['P2'])] })).state).toBe('success');
    expect(decideGate(input({ comments: [taskReview(HEAD, ['P1', 'P0'])] }))).toEqual({
      state: 'failure',
      description: 'Codex P0/P1 지적 2건이 현재 커밋에 있음',
    });
  });

  it('이전 커밋을 가리키는 작업 결과 댓글은 세지 않는다', () => {
    expect(decideGate(input({ comments: [taskReview(OLD, ['P1'])] })).state).toBe('pending');
  });

  it('본문에 ai-msg 표시 줄 예시를 인용한 작업 결과 리뷰도 검사한다', () => {
    const quoted = taskReview(HEAD, ['P1']);
    const inline = {
      ...quoted,
      body: quoted.body.replace(
        '## 검토 결과',
        '## 검토 결과\n\n`<!-- ai-msg:v1 type=ask issue= -->` 같은 줄',
      ),
    };
    const fenced = {
      ...quoted,
      body: `${quoted.body}\n\n\`\`\`text\n<!-- ai-msg:v1 type=answer issue=1 -->\n\`\`\``,
    };
    for (const c of [inline, fenced]) {
      expect(decideGate(input({ comments: [c] })).state).toBe('failure');
    }
  });

  it('ai-msg 메시지와 다른 계정의 댓글은 작업 결과 리뷰로 보지 않는다', () => {
    const msg = {
      login: CODEX,
      body: `<!-- ai-msg:v1 type=answer issue=1 pr=- head=- rev=- reply-to=2 -->\n${taskReview(HEAD, ['P1']).body}`,
    };
    expect(decideGate(input({ comments: [msg] })).state).toBe('pending');
    expect(
      decideGate(input({ comments: [{ ...taskReview(HEAD, ['P1']), login: 'someone' }] })).state,
    ).toBe('pending');
  });

  it('다른 계정이 단 배지는 세지 않는다', () => {
    const fake = { ...finding('P0'), login: 'someone' };
    expect(decideGate(input({ inlineComments: [fake] })).state).toBe('success');
  });

  it('CI가 실패하면 실패, 진행 중이거나 없으면 대기', () => {
    expect(
      decideGate(input({ checkRuns: [{ id: 3, status: 'completed', conclusion: 'failure' }] })),
    ).toEqual({ state: 'failure', description: 'CI check 실패' });
    expect(
      decideGate(input({ checkRuns: [{ id: 3, status: 'in_progress', conclusion: null }] })).state,
    ).toBe('pending');
    expect(decideGate(input({ checkRuns: [] })).state).toBe('pending');
  });

  it('취소된 이전 CI run은 무시하고 가장 최근 run을 본다', () => {
    const cancelled = { id: 1, status: 'completed', conclusion: 'cancelled' };
    expect(decideGate(input({ checkRuns: [cancelled, passed] })).state).toBe('success');
  });

  it('자동 흐름이 진행 중이면 대기, 멈췄으면 실패, 준비되면 성공', () => {
    expect(decideGate(input({ labels: ['ai:in-progress'] }))).toEqual({
      state: 'pending',
      description: 'AI 자동 흐름 진행 중',
    });
    expect(decideGate(input({ labels: ['ai:in-progress', 'ai:needs-human'] })).state).toBe(
      'failure',
    );
    expect(decideGate(input({ labels: ['ai:ready', 'ai:round-1'] })).state).toBe('success');
  });

  it('상태 설명은 GitHub 제한(140자) 안이다', () => {
    const many = Array.from({ length: 999 }, () => finding('P1'));
    expect(decideGate(input({ inlineComments: many })).description.length).toBeLessThanOrEqual(140);
  });
});

describe('updateGate', () => {
  // GitHub API를 흉내 낸다. paginate는 메서드 이름으로 돌려줄 목록을 고른다.
  const fakeGithub = (pr: { state: string; labels: string[] }) => {
    const statuses: unknown[] = [];
    const lists: Record<string, unknown[]> = {
      listComments: [{ user: { login: CODEX }, body: stateComment(HEAD).body }],
      listReviews: [],
      listReviewComments: [
        { user: { login: CODEX }, original_commit_id: OLD, body: finding('P1').body },
      ],
      listForRef: [
        { id: 1, name: 'check', status: 'completed', conclusion: 'cancelled' },
        { id: 2, name: 'check', status: 'completed', conclusion: 'success' },
        { id: 3, name: 'e2e', status: 'completed', conclusion: 'success' },
        // CI가 아닌 다른 워크플로의 작업은 보지 않는다.
        { id: 4, name: 'gate', status: 'completed', conclusion: 'failure' },
      ],
    };
    const named = (name: string) => Object.assign(() => undefined, { methodName: name });
    return {
      statuses,
      github: {
        rest: {
          pulls: {
            get: () =>
              Promise.resolve({
                data: {
                  state: pr.state,
                  head: { sha: HEAD },
                  labels: pr.labels.map((name) => ({ name })),
                },
              }),
            listReviews: named('listReviews'),
            listReviewComments: named('listReviewComments'),
          },
          issues: { listComments: named('listComments') },
          checks: { listForRef: named('listForRef') },
          repos: {
            createCommitStatus: (args: unknown) => {
              statuses.push(args);
              return Promise.resolve({});
            },
          },
        },
        paginate: (method: { methodName: string }) => Promise.resolve(lists[method.methodName]),
      },
    };
  };
  const context = { repo: { owner: 'owner', repo: 'repo' } };
  const core = { info: () => undefined };

  it('열린 PR의 head에 ai-gate 상태를 남긴다', async () => {
    const fake = fakeGithub({ state: 'open', labels: [] });
    const gate = await updateGate({
      github: fake.github,
      context,
      core,
      number: 7,
      codexBot: CODEX,
      runUrl: 'https://example.test/run/1',
    });
    expect(gate?.state).toBe('success');
    expect(fake.statuses).toEqual([
      expect.objectContaining({
        owner: 'owner',
        repo: 'repo',
        sha: HEAD,
        context: 'ai-gate',
        state: 'success',
        target_url: 'https://example.test/run/1',
      }),
    ]);
  });

  it('닫힌 PR에는 상태를 남기지 않는다', async () => {
    const fake = fakeGithub({ state: 'closed', labels: [] });
    const gate = await updateGate({
      github: fake.github,
      context,
      core,
      number: 7,
      codexBot: CODEX,
      runUrl: '',
    });
    expect(gate).toBeNull();
    expect(fake.statuses).toEqual([]);
  });
});

describe('워크플로와의 일치', () => {
  it.each(['.github/workflows/merge-gate.yml', '.github/workflows/ai-review-loop.yml'])(
    '%s가 updateGate로 상태를 남기고 statuses 쓰기 권한이 있다',
    (file) => {
      const workflow = readFileSync(file, 'utf8');
      expect(workflow).toContain('updateGate');
      expect(workflow).toContain('statuses: write');
      expect(GATE_CONTEXT).toBe('ai-gate');
    },
  );
});
