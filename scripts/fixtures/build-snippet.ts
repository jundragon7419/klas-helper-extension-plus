// 브라우저 콘솔에 붙여 넣을 수집 스크립트를 한 파일로 묶는다.
// 실행: npm run fixtures:snippet (API 응답), npm run fixtures:dom-snippet (화면 DOM 발췌)

import { build, type Plugin } from 'vite';

const SNIPPETS = {
  api: {
    entry: 'scripts/fixtures/snippet.ts',
    fileName: 'klas-fixture-snippet.js',
    name: 'klasFixture',
  },
  dom: {
    entry: 'scripts/fixtures/dom-snippet.ts',
    fileName: 'klas-dom-snippet.js',
    name: 'klasDomFixture',
  },
} as const;

const kind = (process.argv[2] ?? 'api') as keyof typeof SNIPPETS;
if (!Object.hasOwn(SNIPPETS, kind)) {
  console.error(`알 수 없는 스크립트 종류: ${kind} (api 또는 dom)`);
  process.exit(1);
}
const { entry, fileName, name } = SNIPPETS[kind];
const outDir = 'local-data';

/** 비ASCII 문자를 \uXXXX로 바꾼다. */
const toAscii = (code: string) =>
  code.replace(/[\u0080-￿]/g, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`);

/**
 * 결과 파일에 ASCII만 남긴다. Windows PowerShell 5의 Get-Content처럼 UTF-8을
 * 다른 인코딩으로 읽는 도구로 복사해도 한글 문자열이 깨지지 않는다.
 * 다른 단계가 문자열을 다시 쓰지 않도록 파일을 내보내기 직전에 바꾼다.
 */
const asciiOnly: Plugin = {
  name: 'ascii-only',
  enforce: 'post',
  generateBundle(_options, bundle) {
    for (const chunk of Object.values(bundle)) {
      if (chunk.type === 'chunk') chunk.code = toAscii(chunk.code);
    }
  },
};

await build({
  configFile: false,
  logLevel: 'warn',
  plugins: [asciiOnly],
  build: {
    outDir,
    emptyOutDir: false,
    minify: false,
    lib: {
      entry,
      formats: ['iife'],
      name,
      fileName: () => fileName,
    },
  },
});

console.log(`${outDir}/${fileName}을 만들었습니다. KLAS 탭의 개발자 도구 콘솔에 붙여 넣으세요.`);
