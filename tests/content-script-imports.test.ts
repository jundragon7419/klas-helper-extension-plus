import { describe, expect, it } from 'vitest';

// content script가 불러오는 모듈에는 storage.session 항목이 없어야 한다.
// WXT의 storage.defineItem은 정의하는 순간 값을 읽는데, content script는 storage.session에
// 접근할 수 없어서 "Access to storage is not allowed from this context" 오류가 난다.
// 가짜 브라우저(fakeBrowser)에는 이 제한이 없어서, 소스를 직접 읽어 확인한다.

const sources = import.meta.glob<string>(
  ['../entrypoints/**/*.{ts,tsx}', '../utils/**/*.{ts,tsx}'],
  {
    query: '?raw',
    import: 'default',
    eager: true,
  },
);

/** '../utils/x.ts' 형식의 키로 바꾼다. */
function resolve(from: string, specifier: string): string | null {
  let path: string;
  if (specifier.startsWith('@/')) path = `../${specifier.slice(2)}`;
  else if (specifier.startsWith('.'))
    path = new URL(specifier, new URL(from, 'file:///root/tests/')).pathname.replace(
      '/root/',
      '../',
    );
  else return null; // 패키지
  return [path, path + '.ts', path + '.tsx'].find((candidate) => candidate in sources) ?? null;
}

/** 값으로 불러오는 모듈만 따라간다. `import type`은 빌드에서 사라지므로 뺀다. */
function valueImports(source: string): string[] {
  const specifiers: string[] = [];
  for (const match of source.matchAll(/^import\s+(?!type\b)[^;]*?from\s+'([^']+)';/gms)) {
    specifiers.push(match[1]!);
  }
  return specifiers;
}

function contentScriptModules(entry: string): string[] {
  const seen = new Set<string>();
  const stack = [entry];
  while (stack.length > 0) {
    const path = stack.pop()!;
    if (seen.has(path)) continue;
    seen.add(path);
    for (const specifier of valueImports(sources[path] ?? '')) {
      const next = resolve(path, specifier);
      if (next) stack.push(next);
    }
  }
  return [...seen];
}

describe('content script가 불러오는 모듈', () => {
  const modules = contentScriptModules('../entrypoints/klas.content.ts');

  it('필요한 모듈을 따라가 찾는다', () => {
    expect(modules).toContain('../utils/ui/deadline-drawer.tsx');
    expect(modules).toContain('../utils/deadline-cache.ts');
    expect(modules).toContain('../utils/klas/api.ts');
    // 타입으로만 불러오는 모듈은 빠진다.
    expect(modules).not.toContain('../utils/fetch-coordinator.ts');
  });

  it('storage.session 항목을 정의하지 않는다', () => {
    const offenders = modules.filter((path) => /['"`]session:/.test(sources[path] ?? ''));
    expect(offenders).toEqual([]);
  });
});
