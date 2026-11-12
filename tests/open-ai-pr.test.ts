import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// AI implement 워크플로의 PR 생성 단계(scripts/ai/open-ai-pr.sh)를 가짜 gh로 검사한다.
// bash와 git이 있는 환경(CI의 ubuntu)에서만 실행한다.
const script = resolve('scripts/ai/open-ai-pr.sh');
const hasBash = process.platform !== 'win32' && spawnSync('bash', ['--version']).status === 0;

const fakeGh = `#!/usr/bin/env bash
echo "[$GH_TOKEN] $*" >> "$GH_CALLS"
case "$1 $2" in
  "issue view") if [[ "$*" == *labels* ]]; then printf 'task\\narea: ui\\n'; else echo "2: 마감 일정"; fi ;;
  "pr create") echo "https://github.com/owner/repo/pull/95" ;;
esac
`;

describe.skipIf(!hasBash)('open-ai-pr.sh', () => {
  let root: string;
  let work: string;
  let calls: string;
  let bin: string;

  const git = (...args: string[]) => execFileSync('git', args, { cwd: work, stdio: 'pipe' });

  // 워크플로는 구현 작업이 넘긴 브랜치와 커밋을 BRANCH, HEAD_SHA로 준다. 기본값은 현재 작업 공간의 HEAD다.
  const head = () => ({
    BRANCH: git('rev-parse', '--abbrev-ref', 'HEAD').toString().trim(),
    HEAD_SHA: git('rev-parse', 'HEAD').toString().trim(),
  });

  const run = (env: Record<string, string>) =>
    spawnSync('bash', [script], {
      cwd: work,
      encoding: 'utf8',
      env: {
        PATH: `${bin}:${process.env.PATH ?? ''}`,
        HOME: root,
        GH_CALLS: calls,
        ISSUE: '92',
        GH_TOKEN: 'maintainer-token',
        ACTIONS_TOKEN: 'actions-token',
        ...head(),
        ...env,
      },
    });

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'open-ai-pr-'));
    work = join(root, 'work');
    bin = join(root, 'bin');
    calls = join(root, 'calls.log');
    mkdirSync(bin);
    writeFileSync(join(bin, 'gh'), fakeGh);
    chmodSync(join(bin, 'gh'), 0o755);
    execFileSync('git', ['init', '-q', '--bare', join(root, 'remote.git')]);
    mkdirSync(work);
    git('init', '-q', '-b', 'develop');
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'test');
    git('commit', '-q', '--allow-empty', '-m', 'init');
    git('remote', 'add', 'origin', join(root, 'remote.git'));
    git('switch', '-q', '-c', 'fix/92-remove-hover');
    git('commit', '-q', '--allow-empty', '-m', 'Remove hover');
    git('push', '-q', 'origin', 'fix/92-remove-hover');
    mkdirSync(join(work, '.ai-pr'));
    writeFileSync(join(work, '.ai-pr', 'title.txt'), 'Remove hover\n');
    writeFileSync(
      join(work, '.ai-pr', 'body.md'),
      '본문\n\n## Squash 커밋 메시지\n\nRemove hover (#PR)\n',
    );
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const readCalls = () => {
    try {
      return readFileSync(calls, 'utf8');
    } catch {
      return '';
    }
  };

  it('메인테이너 토큰으로 PR을 열고 이슈의 라벨과 마일스톤을 붙인다', () => {
    const result = run({});

    expect(result.status).toBe(0);
    const log = readCalls();
    expect(log).toContain(
      '[maintainer-token] pr create --base develop --head fix/92-remove-hover --title Remove hover --body-file .ai-pr/body.md --assignee jundragon7419 --label ai:in-progress --label task --label area: ui --milestone 2: 마감 일정',
    );
    expect(log).toContain('[maintainer-token] pr edit 95 --body-file .ai-pr/body.md');
    expect(log).toContain('[actions-token] issue comment 92');
    expect(readFileSync(join(work, '.ai-pr', 'body.md'), 'utf8')).toContain('Remove hover (#95)');
  });

  it('작업 공간의 HEAD가 아니라 넘겨받은 브랜치와 커밋으로 PR을 연다', () => {
    const pushed = head();
    git('switch', '-q', 'develop');

    const result = run(pushed);

    expect(result.status).toBe(0);
    expect(readCalls()).toContain('--head fix/92-remove-hover');
  });

  it('넘겨받은 커밋이 원격 브랜치의 커밋과 다르면 PR을 열지 않는다', () => {
    const result = run({ HEAD_SHA: 'f'.repeat(40) });

    expect(result.status).not.toBe(0);
    expect(readCalls()).toBe('');
  });

  it('secret이 없으면 PR을 열지 않는다', () => {
    const result = run({ GH_TOKEN: '' });

    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain('MAINTAINER_PR_TOKEN');
    expect(readCalls()).toBe('');
  });

  it('브랜치 이름이 이슈 번호와 다르면 PR을 열지 않는다', () => {
    git('switch', '-q', '-c', 'fix/99-other');
    // 원격에도 올려 두어, 브랜치 이름 검사만으로 멈추는지 확인한다.
    git('push', '-q', 'origin', 'fix/99-other');

    const result = run({});

    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain('fix/99-other');
    expect(readCalls()).toBe('');
  });

  it('현재 커밋이 원격에 없으면 PR을 열지 않는다', () => {
    git('commit', '-q', '--allow-empty', '-m', 'not pushed');

    const result = run({});

    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain('원격에 없습니다');
    expect(readCalls()).toBe('');
  });
});
