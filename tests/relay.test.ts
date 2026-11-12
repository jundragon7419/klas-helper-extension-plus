import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { decidePing, PING_TIMEOUT_MS, pingBody, relayRequestBody } from '../scripts/ai/relay.js';

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
});
