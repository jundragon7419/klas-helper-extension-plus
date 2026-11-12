import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// AI review loop의 검토 반영 push(scripts/ai/push-fix.sh)를 로컬 저장소로 검사한다.
// 원격은 bare 저장소, Claude 작업 공간은 그 저장소의 clone으로 흉내 낸다.
// bash와 git이 있는 환경(CI의 ubuntu)에서만 실행한다.
const script = resolve('scripts/ai/push-fix.sh');
const hasBash = process.platform !== 'win32' && spawnSync('bash', ['--version']).status === 0;
const BRANCH = 'fix/111-hide-lectures';

describe.skipIf(!hasBash)('push-fix.sh', () => {
  let root: string;
  let remote: string;
  let work: string;
  let bundle: string;
  let before: string;

  const git = (cwd: string, ...args: string[]) =>
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.test', ...args], {
      cwd,
      encoding: 'utf8',
    }).trim();
  const commit = (cwd: string, file: string, text: string) => {
    mkdirSync(join(cwd, file, '..'), { recursive: true });
    writeFileSync(join(cwd, file), text);
    git(cwd, 'add', '-A');
    git(cwd, 'commit', '-q', '-m', `Change ${file}`);
    return git(cwd, 'rev-parse', 'HEAD');
  };
  const makeBundle = (from = before) =>
    git(work, 'bundle', 'create', '-q', bundle, `${from}..HEAD`);
  const remoteHead = () => git(remote, 'rev-parse', `refs/heads/${BRANCH}`);
  const run = (env: Record<string, string> = {}) =>
    spawnSync('bash', [script], {
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH ?? '',
        HOME: root,
        GH_TOKEN: 'maintainer-token',
        GH_REPO: 'owner/repo',
        BRANCH,
        BEFORE: before,
        BUNDLE: bundle,
        REMOTE_URL: remote,
        ...env,
      },
    });

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'push-fix-'));
    remote = join(root, 'remote.git');
    work = join(root, 'work');
    bundle = join(root, 'fix.bundle');
    git(root, 'init', '-q', '--bare', remote);
    git(root, 'init', '-q', work);
    git(work, 'switch', '-q', '-c', BRANCH);
    before = commit(work, 'src/a.ts', 'one');
    git(work, 'push', '-q', remote, `HEAD:refs/heads/${BRANCH}`);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('작업 전 커밋에서 이어진 검토 반영을 push한다', () => {
    const after = commit(work, 'src/a.ts', 'two');
    makeBundle();

    const result = run();

    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(remoteHead()).toBe(after);
  });

  it('워크플로 파일을 바꾸면 push하지 않는다', () => {
    commit(work, '.github/workflows/ci.yml', 'name: CI');
    makeBundle();

    const result = run();

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('워크플로 파일');
    expect(remoteHead()).toBe(before);
  });

  it('Claude 작업 중에 원격 브랜치가 바뀌었으면 push하지 않는다', () => {
    commit(work, 'src/a.ts', 'two');
    makeBundle();
    const other = join(root, 'other');
    git(root, 'clone', '-q', '-b', BRANCH, remote, other);
    const moved = commit(other, 'src/b.ts', 'other');
    git(other, 'push', '-q', 'origin', BRANCH);

    const result = run();

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('바뀌었습니다');
    expect(remoteHead()).toBe(moved);
  });

  it('작업 전 커밋에서 이어지지 않는 bundle은 push하지 않는다', () => {
    // 이전 커밋을 고쳐 쓴 경우: 작업 전 커밋이 새 커밋의 조상이 아니다.
    git(work, 'commit', '-q', '--amend', '-m', 'Rewrite history');
    git(work, 'bundle', 'create', '-q', bundle, 'HEAD');

    const result = run();

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('fast-forward');
    expect(remoteHead()).toBe(before);
  });

  it('새 커밋이 없는 bundle은 push하지 않는다', () => {
    git(work, 'bundle', 'create', '-q', bundle, 'HEAD');

    const result = run();

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('새 커밋이 없습니다');
  });

  it.each(['develop', 'main', 'feature/x'])(
    '작업 브랜치가 아닌 %s에는 push하지 않는다',
    (branch) => {
      commit(work, 'src/a.ts', 'two');
      makeBundle();

      const result = run({ BRANCH: branch });

      expect(result.status).toBe(1);
      expect(result.stdout).toContain('작업 브랜치가 아니어서');
    },
  );

  it('메인테이너 토큰이 없으면 push하지 않는다', () => {
    commit(work, 'src/a.ts', 'two');
    makeBundle();

    const result = run({ GH_TOKEN: '' });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('MAINTAINER_PR_TOKEN');
    expect(remoteHead()).toBe(before);
  });
});
