import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { formatMessage } from '../scripts/ai/ai-msg.js';
import {
  classifyCodexReply,
  decidePing,
  decideRelayTarget,
  expectedIssueOf,
  MAX_ASKS,
  PING_TIMEOUT_MS,
  pingBody,
  relayRequestBody,
  rolesOf,
} from '../scripts/ai/relay.js';

// 자동 흐름이 멈췄을 때의 Codex 요청과 메인테이너 알림(scripts/ai/relay.js, request-codex.sh)을 검사한다.
const CODEX = 'chatgpt-codex-connector[bot]';
const ME = 'jundragon7419';
const PING_BOT = 'github-actions[bot]';
const T0 = Date.parse('2026-11-12T00:00:00Z');
const at = (minutes: number) => new Date(T0 + minutes * 60_000).toISOString();

const relay = (minutes = 0, key = 'run-1', login = ME) => ({
  login,
  body: relayRequestBody('implement', { runUrl: 'https://example.test/run/1', key }),
  createdAt: at(minutes),
});
const reply = (minutes: number, body = '사용자가 할 일: ...') => ({
  login: CODEX,
  body,
  createdAt: at(minutes),
});
const decide = (comments: { login: string; body: string; createdAt: string }[], nowMinutes = 5) =>
  decidePing({
    comments,
    now: T0 + nowMinutes * 60_000,
    codexBot: CODEX,
    maintainer: ME,
    pingBot: PING_BOT,
  });

describe('relayRequestBody', () => {
  it('@codex로 시작하고 코드 변경 금지, 실행 기록, 표시를 담는다', () => {
    const body = relayRequestBody('round-limit', {
      runUrl: 'https://example.test/run/9',
      key: 'run-9',
    });
    expect(body.startsWith('@codex ')).toBe(true);
    expect(body).toContain('코드는 바꾸지 말고');
    expect(body).toContain('https://example.test/run/9');
    expect(body).toContain('<!-- ai-relay:run-9 -->');
  });

  it('askId가 있으면 그 메시지에 ai-msg 형식으로 답하게 한다', () => {
    const body = relayRequestBody('implement', { runUrl: 'u', key: 'k', askId: 77 });
    expect(body).toContain('댓글 ID 77');
    expect(body).toContain('reply-to에 77');
    expect(body).toContain('`answer`');
    expect(body).toContain('`need-user`');
  });

  it('모르는 멈춤 종류는 거부한다', () => {
    expect(() => relayRequestBody('other' as never, { runUrl: '', key: 'k' })).toThrow();
  });
});

describe('decidePing', () => {
  it('요청이 없으면 알리지 않는다', () => {
    expect(decide([reply(1)]).ping).toBeNull();
  });

  it('요청 뒤에 Codex 정리가 오면 알린다', () => {
    expect(decide([relay(), reply(2)])).toEqual({ ping: 'codex', key: 'run-1' });
  });

  it('요청 전의 Codex 댓글과 리뷰 요약 댓글은 정리로 보지 않는다', () => {
    const summary = reply(3, '<!-- codex-review-state:v1 {} -->');
    expect(decide([reply(-5), relay(), summary]).ping).toBeNull();
  });

  it('사용자 수정 요청에 대한 change는 정리 답으로 보지 않는다', () => {
    const change = reply(
      2,
      formatMessage(
        { type: 'change', issue: 104, pr: 111, rev: 1, 'reply-to': 5 },
        { '바뀐 완료 조건': '전 / 후', 이유: '요청', '바꿀 항목': '- 색' },
      ),
    );
    expect(decide([relay(), change]).ping).toBeNull();
    expect(decide([relay(), change], 40)).toEqual({ ping: 'timeout', key: 'run-1' });
    expect(decide([relay(), change, reply(3)])).toEqual({ ping: 'codex', key: 'run-1' });
  });

  it('이미 알렸으면 다시 알리지 않는다', () => {
    const pinged = {
      login: PING_BOT,
      body: pingBody('codex', { maintainer: ME, key: 'run-1' }),
      createdAt: at(3),
    };
    expect(decide([relay(), reply(2), pinged]).ping).toBeNull();
  });

  it('다른 계정이 단 알림 표시로는 알림을 막을 수 없다', () => {
    const fake = {
      login: 'someone',
      body: pingBody('codex', { maintainer: ME, key: 'run-1' }),
      createdAt: at(3),
    };
    expect(decide([relay(), reply(2), fake]).ping).toBe('codex');
  });

  it('다른 요청에 대한 알림은 이번 요청을 막지 않는다', () => {
    const old = {
      login: PING_BOT,
      body: pingBody('codex', { maintainer: ME, key: 'run-0' }),
      createdAt: at(-1),
    };
    expect(decide([old, relay(0, 'run-1'), reply(2)]).key).toBe('run-1');
  });

  it('30분 동안 정리가 없으면 알리고, 그 전에는 기다린다', () => {
    expect(decide([relay()], 29).ping).toBeNull();
    expect(decide([relay()], PING_TIMEOUT_MS / 60_000).ping).toBe('timeout');
  });

  it('메인테이너가 아닌 계정이 단 요청 표시는 무시한다', () => {
    expect(decide([relay(0, 'run-1', 'someone'), reply(2)]).ping).toBeNull();
  });

  it('알림 댓글은 메인테이너를 부르고 표시를 남긴다', () => {
    const body = pingBody('timeout', { maintainer: ME, key: 'run-1' });
    expect(body.startsWith(`@${ME} `)).toBe(true);
    expect(body).toContain('<!-- ai-pinged:run-1 -->');
  });
});

// request-codex.sh를 가짜 gh로 실행한다. bash가 있는 환경(CI의 ubuntu)에서만 실행한다.
const hasBash = process.platform !== 'win32' && spawnSync('bash', ['--version']).status === 0;

describe.skipIf(!hasBash)('request-codex.sh', () => {
  let root: string;
  let calls: string;
  let bin: string;

  const run = (env: Record<string, string>) =>
    spawnSync('bash', [resolve('scripts/ai/request-codex.sh')], {
      encoding: 'utf8',
      env: {
        PATH: `${bin}:${process.env.PATH ?? ''}`,
        HOME: root,
        RUNNER_TEMP: root,
        GH_CALLS: calls,
        GH_REPO: 'owner/repo',
        TARGET: '105',
        KIND: 'implement',
        RUN_URL: 'https://example.test/run/1',
        KEY: 'run-1',
        MAINTAINER: ME,
        GH_TOKEN: 'maintainer-token',
        ACTIONS_TOKEN: 'actions-token',
        ...env,
      },
    });

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'request-codex-'));
    bin = join(root, 'bin');
    calls = join(root, 'calls.log');
    mkdirSync(bin);
    writeFileSync(join(bin, 'gh'), '#!/usr/bin/env bash\necho "[$GH_TOKEN] $*" >> "$GH_CALLS"\n');
    chmodSync(join(bin, 'gh'), 0o755);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('라벨은 Actions 토큰으로, @codex 요청은 메인테이너 토큰으로 단다', () => {
    const a = ask();
    threadGh([{ id: a.id, login: a.login, body: a.body }]);
    const result = run({});

    expect(result.status).toBe(0);
    const log = readFileSync(calls, 'utf8');
    expect(log).toContain(
      '[actions-token] api -X POST repos/owner/repo/issues/105/labels -f labels[]=ai:needs-human',
    );
    expect(log).toContain('[maintainer-token] api -X POST repos/owner/repo/issues/105/comments');
    expect(readFileSync(join(root, 'codex-request.md'), 'utf8')).toContain(
      '<!-- ai-relay:run-1 -->',
    );
  });

  it('메인테이너 토큰이 없으면 Codex 요청 없이 바로 알린다', () => {
    const result = run({ GH_TOKEN: '' });

    expect(result.status).toBe(0);
    const log = readFileSync(calls, 'utf8');
    expect(log).not.toContain('[maintainer-token]');
    expect(log).toContain(
      `[actions-token] api -X POST repos/owner/repo/issues/105/comments -f body=@${ME}`,
    );
  });

  // 댓글 목록 요청에는 THREAD 파일 내용을 돌려주는 가짜 gh
  const threadGh = (lines: object[]) => {
    const thread = join(root, 'thread-input.jsonl');
    writeFileSync(thread, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
    writeFileSync(
      join(bin, 'gh'),
      `#!/usr/bin/env bash\necho "[$GH_TOKEN] $*" >> "$GH_CALLS"\n[[ "$*" == *"--paginate"* ]] && cat "${thread}"\nexit 0\n`,
    );
  };

  it('Claude의 ask ID를 요청 본문에 넣는다', () => {
    const a = { ...ask(), id: 4242 };
    threadGh([{ id: a.id, login: a.login, body: a.body }]);

    const result = run({});

    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(join(root, 'codex-request.md'), 'utf8')).toContain('댓글 ID 4242');
  });

  it('Claude 메시지가 없거나 형식이 틀리면 Codex에게 요청하지 않고 오류와 함께 알린다', () => {
    const run1 = run({});
    expect(run1.status, run1.stderr).toBe(0);
    expect(readFileSync(calls, 'utf8')).not.toContain('[maintainer-token] api -X POST');
    expect(readFileSync(calls, 'utf8')).toContain('Claude가 ask나 objection을 남기지 않음');

    const broken = { id: 7, login: 'claude[bot]', body: '<!-- ai-msg:v1 type=ask issue=104 -->' };
    threadGh([broken]);
    const run2 = run({});
    expect(run2.status, run2.stderr).toBe(0);
    const log = readFileSync(calls, 'utf8');
    expect(log).toContain('Claude 메시지 형식 오류');
    expect(log).toContain('### 단계');
    expect(log).not.toContain('[maintainer-token] api -X POST');
  });

  it('PR에서는 연결된 이슈의 질문까지 세어 횟수를 넘으면 바로 알린다', () => {
    const toLine = (c: { id: number; login: string; body: string }) =>
      JSON.stringify({ id: c.id, login: c.login, body: c.body });
    const thread = join(root, 'pr-thread.jsonl');
    const history = join(root, 'issue-thread.jsonl');
    writeFileSync(thread, toLine(ask('질문 C')) + '\n');
    writeFileSync(history, [ask('질문 A'), ask('질문 B')].map(toLine).join('\n') + '\n');
    writeFileSync(
      join(bin, 'gh'),
      [
        '#!/usr/bin/env bash',
        'echo "[$GH_TOKEN] $*" >> "$GH_CALLS"',
        'case "$*" in',
        '  *"issues/105 --jq"*) echo pr ;;',
        '  *"pulls/105 --jq .head.ref"*) echo feat/104-hide-lectures ;;',
        `  *"issues/104/comments --paginate"*) cat "${history}" ;;`,
        `  *"issues/105/comments --paginate"*) cat "${thread}" ;;`,
        'esac',
        'exit 0',
      ].join('\n') + '\n',
    );

    const result = run({});

    expect(result.status, result.stderr).toBe(0);
    const log = readFileSync(calls, 'utf8');
    expect(log).toContain('repos/owner/repo/issues/104/comments --paginate');
    expect(log).toContain('질문이 2회를 넘음');
    expect(log).not.toContain('[maintainer-token] api -X POST');
  });

  it('ask가 너무 많으면 Codex에게 요청하지 않고 바로 알린다', () => {
    threadGh(
      Array.from({ length: MAX_ASKS + 1 }, (_, i) => {
        const a = ask(`질문 ${i}`);
        return { id: a.id, login: a.login, body: a.body };
      }),
    );

    const result = run({});

    expect(result.status, result.stderr).toBe(0);
    const log = readFileSync(calls, 'utf8');
    expect(log).not.toContain('[maintainer-token] api -X POST');
    expect(log).toContain(
      `[actions-token] api -X POST repos/owner/repo/issues/105/comments -f body=@${ME}`,
    );
    expect(log).toContain('질문이 2회를 넘음');
  });

  it('메인테이너 토큰으로 요청을 달지 못하면 Actions 토큰으로 바로 알린다', () => {
    const a = ask();
    const thread = join(root, 'thread-input.jsonl');
    writeFileSync(thread, JSON.stringify({ id: a.id, login: a.login, body: a.body }) + '\n');
    writeFileSync(
      join(bin, 'gh'),
      `#!/usr/bin/env bash\necho "[$GH_TOKEN] $*" >> "$GH_CALLS"\n[[ "$*" == *"--paginate"* ]] && cat "${thread}"\n[ "$GH_TOKEN" = maintainer-token ] && exit 1\nexit 0\n`,
    );

    const result = run({});

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Codex 요청을 달지 못함');
    expect(readFileSync(calls, 'utf8')).toContain(
      `[actions-token] api -X POST repos/owner/repo/issues/105/comments -f body=@${ME}`,
    );
  });
});

// request-review.sh: 검토 반영이 push됐고 Codex 자동 검토가 시작되지 않았을 때만 메인테이너 계정으로 "@codex review"를 단다.
const hasJq = spawnSync('jq', ['--version']).status === 0;
const stateComments = (sha: string) =>
  JSON.stringify([
    {
      id: 1,
      user: { login: CODEX },
      created_at: '2026-11-12T00:00:00Z',
      body: `<!-- codex-review-state:v1 {"code_review":{"commit_sha":"${sha}","status":"in_progress"}} -->`,
    },
  ]);
const reactions = (createdAt: string) =>
  JSON.stringify([{ id: 123, user: { login: CODEX }, content: 'eyes', created_at: createdAt }]);

describe.skipIf(!hasBash || !hasJq)('request-review.sh', () => {
  let root: string;
  let calls: string;
  let bin: string;

  const run = (env: Record<string, string>) =>
    spawnSync('bash', [resolve('scripts/ai/request-review.sh')], {
      encoding: 'utf8',
      env: {
        PATH: `${bin}:${process.env.PATH ?? ''}`,
        HOME: root,
        GH_CALLS: calls,
        GH_REPO: 'owner/repo',
        PR: '111',
        BEFORE: 'a'.repeat(40),
        NOW_SHA: 'b'.repeat(40),
        GH_TOKEN: 'maintainer-token',
        ACTIONS_TOKEN: 'actions-token',
        CODEX_AUTO_REVIEW_WAIT: '0',
        PR_COMMENTS: '[]',
        CODEX_REACTIONS: '[]',
        REVIEW_SINCE: '2026-11-13T00:05:00Z',
        ...env,
      },
    });
  const readCalls = () => {
    try {
      return readFileSync(calls, 'utf8');
    } catch {
      return '';
    }
  };

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'request-review-'));
    bin = join(root, 'bin');
    calls = join(root, 'calls.log');
    mkdirSync(bin);
    writeFileSync(
      join(bin, 'gh'),
      [
        '#!/usr/bin/env bash',
        'echo "[$GH_TOKEN] $*" >> "$GH_CALLS"',
        '[[ "$*" == *".head.sha"* ]] && echo "$NOW_SHA"',
        // 댓글과 반응 목록은 jq로 실제 --jq 식을 적용해 거른다.
        'args=("$@"); jqf=""',
        'for ((i = 0; i < ${#args[@]}; i++)); do [ "${args[$i]}" = "--jq" ] && jqf="${args[$((i + 1))]}"; done',
        '[[ "$*" == *"/comments --paginate"* ]] && echo "$PR_COMMENTS" | jq -r "$jqf"',
        '[[ "$*" == *"/reactions"* ]] && echo "$CODEX_REACTIONS" | jq -r "$jqf"',
        'exit 0',
        '',
      ].join('\n'),
    );
    chmodSync(join(bin, 'gh'), 0o755);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('head가 바뀌었으면 메인테이너 토큰으로 재검토를 요청한다', () => {
    const result = run({});

    expect(result.status).toBe(0);
    expect(readCalls()).toContain('[actions-token] api repos/owner/repo/pulls/111 --jq .head.sha');
    expect(readCalls()).toContain(
      '[maintainer-token] api -X POST repos/owner/repo/issues/111/comments -f body=@codex review',
    );
  });

  it('Codex가 새 head를 스스로 리뷰하기 시작했으면 요청하지 않는다', () => {
    const started = run({ PR_COMMENTS: stateComments('b'.repeat(40)) });
    expect(started.status).toBe(0);
    expect(started.stdout).toContain('이미 리뷰');
    expect(readCalls()).not.toContain('-X POST');

    const eyes = run({ CODEX_REACTIONS: reactions('2026-11-13T00:06:00Z') });
    expect(eyes.stdout).toContain('이미 리뷰');
    expect(readCalls()).not.toContain('-X POST');
  });

  it('이전 리뷰 때 남은 👀는 이번 커밋의 리뷰로 보지 않는다', () => {
    const result = run({ CODEX_REACTIONS: reactions('2026-11-13T00:01:00Z') });
    expect(result.stdout).toContain('재검토를 요청했습니다');
    expect(readCalls()).toContain(
      '-X POST repos/owner/repo/issues/111/comments -f body=@codex review',
    );
  });

  it('다른 계정이나 다른 반응은 세지 않는다', () => {
    const others = JSON.stringify([
      { id: 1, user: { login: 'someone' }, content: 'eyes', created_at: '2026-11-13T00:06:00Z' },
      { id: 2, user: { login: CODEX }, content: '+1', created_at: '2026-11-13T00:06:00Z' },
    ]);
    expect(run({ CODEX_REACTIONS: others }).stdout).toContain('재검토를 요청했습니다');
  });

  it('push 뒤에 메인테이너가 이미 @codex review를 달았으면 다시 달지 않는다', () => {
    const asked = (at: string, login = 'jundragon7419', body = '@codex review') =>
      JSON.stringify([{ id: 7, user: { login }, created_at: at, body }]);
    expect(run({ PR_COMMENTS: asked('2026-11-13T00:06:00Z') }).stdout).toContain('이미 리뷰');
    expect(readCalls()).not.toContain('-X POST');

    // push 전의 요청, 다른 계정의 요청, 다른 내용의 댓글은 세지 않는다.
    for (const comments of [
      asked('2026-11-13T00:01:00Z'),
      asked('2026-11-13T00:06:00Z', 'someone'),
      asked('2026-11-13T00:06:00Z', 'jundragon7419', '@codex review 하고 고쳐 줘'),
    ]) {
      expect(run({ PR_COMMENTS: comments }).stdout).toContain('재검토를 요청했습니다');
    }
  });

  it('이전 커밋의 상태 표시만 있으면 요청한다', () => {
    const result = run({ PR_COMMENTS: stateComments('a'.repeat(40)) });
    expect(result.stdout).toContain('재검토를 요청했습니다');
    expect(readCalls()).toContain(
      '-X POST repos/owner/repo/issues/111/comments -f body=@codex review',
    );
  });

  it('워크플로는 push 시각을 기준 시각으로 넘긴다', () => {
    const workflow = readFileSync('.github/workflows/codex-review-request.yml', 'utf8');
    expect(workflow).toContain('REVIEW_SINCE: ${{ github.event.pull_request.updated_at }}');
    expect(workflow).toContain('run: bash scripts/ai/request-review.sh');
  });

  it('head가 그대로면 요청하지 않는다', () => {
    const result = run({ NOW_SHA: 'a'.repeat(40) });

    expect(result.status).toBe(0);
    expect(readCalls()).not.toContain('comments');
  });

  it('메인테이너 토큰이 없으면 요청하지 않고 경고만 남긴다', () => {
    const result = run({ GH_TOKEN: '' });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('MAINTAINER_PR_TOKEN');
    expect(readCalls()).not.toContain('-X POST');
  });
});

// Claude 질문(ask, objection)과 Codex 답(answer, need-user)의 흐름
const CLAUDE = 'claude[bot]';
const roles = rolesOf({ codexBot: CODEX, maintainer: ME });
let nextId = 100;
const ask = (question = '진도율 셀은 어디인가?', id = nextId++) => ({
  id,
  login: CLAUDE,
  body: formatMessage(
    { type: 'ask', issue: 104 },
    { 단계: '구현 전', 질문: question, '확인한 것': 'utils/' },
  ),
});
const objection = (id = nextId++) => ({
  id,
  login: CLAUDE,
  body: formatMessage(
    { type: 'objection', issue: 104 },
    { '문제 항목': '지적 1', 근거: 'tests/a.test.ts', 제안: '그대로 둔다' },
  ),
});
const answer = (replyTo: number, restart = '예', login = CODEX) => ({
  id: nextId++,
  login,
  body: formatMessage(
    { type: 'answer', issue: 104, 'reply-to': replyTo },
    { 답: '두 번째 열', 근거: 'docs/', 재시작: restart },
  ),
});
const needUser = (replyTo: number) => ({
  id: nextId++,
  login: CODEX,
  body: formatMessage(
    { type: 'need-user', issue: 104, 'reply-to': replyTo },
    { '확인할 것': '표 구조', '확인 방법': '개발자 도구', '붙일 것': 'DOM 발췌' },
  ),
});

describe('decideRelayTarget', () => {
  it('Claude의 마지막 ask나 objection을 Codex에게 넘긴다', () => {
    const a = ask();
    expect(decideRelayTarget({ comments: [a], roles })).toEqual({
      target: 'codex',
      askId: a.id,
      reason: 'ask',
      errors: [],
    });
    const o = objection();
    expect(decideRelayTarget({ comments: [a, o], roles }).askId).toBe(o.id);
  });

  it('Claude 메시지가 없으면 사용자에게 바로 알린다', () => {
    const plain = { id: 1, login: CLAUDE, body: '멈춤 보고: 구현 전' };
    expect(decideRelayTarget({ comments: [plain], roles })).toEqual({
      target: 'user',
      askId: null,
      reason: 'Claude가 ask나 objection을 남기지 않음',
      errors: [],
    });
  });

  it('최신 Claude 메시지의 형식이 틀리면 이전의 정상 질문을 넘기지 않고 오류와 함께 사용자에게 알린다', () => {
    const good = ask();
    const broken = {
      id: 9,
      login: CLAUDE,
      body: '<!-- ai-msg:v1 type=ask issue=104 -->\n### 단계\n\n구현 전',
    };
    const d = decideRelayTarget({ comments: [good, broken], roles });
    expect(d).toMatchObject({ target: 'user', askId: 9, reason: 'Claude 메시지 형식 오류' });
    expect(d.errors).toContain('본문 절 "### 질문"이 없거나 비어 있습니다.');
  });

  it('최신 Claude 메시지가 ask나 objection이 아니면 사용자에게 알린다', () => {
    const report = {
      id: 10,
      login: CLAUDE,
      body: formatMessage(
        { type: 'report', issue: 104, pr: 111, head: 'a'.repeat(40) },
        { 결과: '고침: 1', '실행한 검사': 'npm test' },
      ),
    };
    expect(decideRelayTarget({ comments: [ask(), report], roles })).toMatchObject({
      target: 'user',
      reason: '마지막 Claude 메시지가 report임',
    });
  });

  it('이미 Codex 답을 받은 질문은 다시 넘기지 않고 사용자에게 알린다', () => {
    const a = ask();
    expect(decideRelayTarget({ comments: [a, answer(a.id)], roles })).toMatchObject({
      target: 'user',
      askId: a.id,
      reason: 'Claude가 새 메시지 없이 멈춤(마지막 질문은 이미 답을 받음)',
    });
    expect(decideRelayTarget({ comments: [a, needUser(a.id)], roles }).target).toBe('user');
    // 답을 받은 뒤 새 질문을 하면 그 질문을 넘긴다.
    const next = ask('다른 질문');
    expect(decideRelayTarget({ comments: [a, answer(a.id), next], roles })).toMatchObject({
      target: 'codex',
      askId: next.id,
    });
  });

  it('질문 횟수와 반복은 연결된 이슈의 질문까지 합쳐 센다', () => {
    const issueAsks = [ask('질문 A'), ask('질문 B')];
    const prAsk = ask('질문 C');
    expect(decideRelayTarget({ comments: [prAsk], history: issueAsks, roles })).toMatchObject({
      target: 'user',
      reason: `질문이 ${MAX_ASKS}회를 넘음`,
    });
    const repeat = ask('질문 A');
    expect(
      decideRelayTarget({ comments: [repeat], history: [issueAsks[0]!], roles }),
    ).toMatchObject({ target: 'user', reason: '같은 질문이 반복됨' });
    expect(decideRelayTarget({ comments: [prAsk], history: [], roles }).target).toBe('codex');
  });

  it('다른 계정이 쓴 ask는 세지 않는다', () => {
    const fake = { ...ask(), login: 'someone' };
    expect(decideRelayTarget({ comments: [fake], roles })).toMatchObject({
      target: 'user',
      askId: null,
    });
  });

  it(`ask가 ${MAX_ASKS}회를 넘으면 사용자에게 바로 알린다`, () => {
    const asks = Array.from({ length: MAX_ASKS + 1 }, (_, i) => ask(`질문 ${i}`));
    expect(decideRelayTarget({ comments: asks, roles })).toMatchObject({
      target: 'user',
      reason: `질문이 ${MAX_ASKS}회를 넘음`,
    });
    expect(decideRelayTarget({ comments: asks.slice(0, MAX_ASKS), roles }).target).toBe('codex');
  });

  it('같은 질문을 다시 하면 사용자에게 바로 알린다', () => {
    const comments = [ask('표가 몇 개인가?'), ask('표가   몇 개인가?')];
    expect(decideRelayTarget({ comments, roles })).toMatchObject({
      target: 'user',
      reason: '같은 질문이 반복됨',
    });
  });
});

describe('classifyCodexReply', () => {
  it('Claude ask에 답하고 재시작이 예면 restart', () => {
    const a = ask();
    const reply = answer(a.id);
    expect(
      classifyCodexReply({ comment: reply, comments: [a, reply], roles, expectedIssue: 104 }),
    ).toEqual({
      kind: 'restart',
      errors: [],
      replyTo: a.id,
    });
  });

  it('objection에 대한 답도 근거로 인정한다', () => {
    const o = objection();
    expect(
      classifyCodexReply({ comment: answer(o.id), comments: [o], roles, expectedIssue: 104 }).kind,
    ).toBe('restart');
  });

  it('재시작이 아니오면 hold, need-user는 need-user', () => {
    const a = ask();
    expect(
      classifyCodexReply({
        comment: answer(a.id, '아니오'),
        comments: [a],
        roles,
        expectedIssue: 104,
      }).kind,
    ).toBe('hold');
    expect(
      classifyCodexReply({ comment: needUser(a.id), comments: [a], roles, expectedIssue: 104 })
        .kind,
    ).toBe('need-user');
  });

  it('reply-to가 이 스레드의 Claude 메시지가 아니면 invalid', () => {
    const a = ask();
    const result = classifyCodexReply({
      comment: answer(999_999),
      comments: [a],
      roles,
      expectedIssue: 104,
    });
    expect(result.kind).toBe('invalid');
    expect(result.errors[0]).toContain('reply-to 999999');
  });

  it('answer나 Claude 메시지의 issue 값이 이 스레드의 이슈와 다르면 invalid', () => {
    const a = ask();
    const result = classifyCodexReply({
      comment: answer(a.id),
      comments: [a],
      roles,
      expectedIssue: 117,
    });
    expect(result.kind).toBe('invalid');
    expect(result.errors[0]).toContain('#117');

    // Claude 메시지는 맞고 answer만 다른 경우
    const own = { ...ask(), body: ask().body.replace('issue=104', 'issue=117') };
    const wrong = answer(own.id);
    expect(
      classifyCodexReply({ comment: wrong, comments: [own], roles, expectedIssue: 117 }).kind,
    ).toBe('invalid');
  });

  it('기대 이슈 번호를 모르면 invalid', () => {
    const a = ask();
    expect(
      classifyCodexReply({ comment: answer(a.id), comments: [a], roles, expectedIssue: null }).kind,
    ).toBe('invalid');
  });

  it('형식이 틀린 답은 invalid, ai-msg가 아닌 댓글과 다른 계정은 other', () => {
    const a = ask();
    const broken = { id: 1, login: CODEX, body: '<!-- ai-msg:v1 type=answer issue= -->' };
    expect(
      classifyCodexReply({ comment: broken, comments: [a], roles, expectedIssue: 104 }).kind,
    ).toBe('invalid');
    const plain = { id: 2, login: CODEX, body: '사용자가 할 일: ...' };
    expect(
      classifyCodexReply({ comment: plain, comments: [a], roles, expectedIssue: 104 }).kind,
    ).toBe('other');
    expect(
      classifyCodexReply({
        comment: answer(a.id, '예', 'someone'),
        comments: [a],
        roles,
        expectedIssue: 104,
      }).kind,
    ).toBe('other');
  });
});

describe('decidePing와 Codex 답', () => {
  const withTime = <T extends object>(c: T, minutes: number) => ({ ...c, createdAt: at(minutes) });

  it('Codex 답이 재시작이면 알리지 않는다', () => {
    const a = withTime(ask(), -1);
    const reply = withTime(answer(a.id), 2);
    const d = decidePing({
      comments: [a, relay(), reply],
      now: T0 + 5 * 60_000,
      codexBot: CODEX,
      maintainer: ME,
      pingBot: PING_BOT,
      roles,
      expectedIssue: 104,
    });
    expect(d.ping).toBeNull();
  });

  it('need-user, hold, 형식 오류면 알린다', () => {
    const a = withTime(ask(), -1);
    for (const reply of [
      needUser(a.id),
      answer(a.id, '아니오'),
      { id: 3, login: CODEX, body: '<!-- ai-msg:v1 type=answer -->' },
    ]) {
      const d = decidePing({
        comments: [a, relay(), withTime(reply, 2)],
        now: T0 + 5 * 60_000,
        codexBot: CODEX,
        maintainer: ME,
        pingBot: PING_BOT,
        roles,
        expectedIssue: 104,
      });
      expect(d.ping).toBe('codex');
    }
  });

  it('리뷰 응답 댓글은 Codex 답으로 보지 않는다', () => {
    const receipt = { login: CODEX, body: '<!-- codex-review-receipt:v1 -->', createdAt: at(2) };
    expect(decide([relay(), receipt]).ping).toBeNull();
  });
});

describe('expectedIssueOf', () => {
  it('이슈는 그 번호, PR은 브랜치 이름의 이슈 번호', () => {
    expect(expectedIssueOf({ number: 104 })).toBe(104);
    expect(expectedIssueOf({ number: 111, headRef: 'feat/104-hide-completed' })).toBe(104);
    expect(expectedIssueOf({ number: 111, headRef: 'chore/ai-stop-relay' })).toBeNull();
  });
});
