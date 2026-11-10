// scripts/fixtures/snippet.ts를 콘솔에 붙여 넣을 수 있는 한 파일로 묶는다.
// 실행: npm run fixtures:snippet

import { build, type Plugin } from 'vite';

const outDir = 'local-data';
const fileName = 'klas-fixture-snippet.js';

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
      entry: 'scripts/fixtures/snippet.ts',
      formats: ['iife'],
      name: 'klasFixture',
      fileName: () => fileName,
    },
  },
});

console.log(`${outDir}/${fileName}을 만들었습니다. KLAS 탭의 개발자 도구 콘솔에 붙여 넣으세요.`);
