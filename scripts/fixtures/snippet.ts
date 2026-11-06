// 브라우저 개발자 도구 콘솔에 붙여 넣는 스크립트의 진입점.
// `npm run fixtures:snippet`이 이 파일을 묶어 local-data/klas-fixture-snippet.js를 만든다.

import { collectKlasFixture } from './collect.ts';

declare global {
  interface Window {
    __klasFixture?: Awaited<ReturnType<typeof collectKlasFixture>>;
  }
}

function download(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

void (async () => {
  if (location.hostname !== 'klas.kw.ac.kr') {
    console.error('[KLAS fixture] KLAS(klas.kw.ac.kr)에 로그인한 탭에서 실행하세요.');
    return;
  }
  console.log('[KLAS fixture] 수집을 시작합니다. 과목 수에 따라 10~30초 걸립니다.');
  const result = await collectKlasFixture();
  window.__klasFixture = result;
  console.log('[KLAS fixture] 항목 수', result.counts);
  if (result.leaks.length > 0) {
    console.error('[KLAS fixture] 개인정보가 남아 있어 파일을 만들지 않았습니다.', result.leaks);
    return;
  }
  const name = `${result.fixture.semester.replace(',', '-')}.json`;
  download(name, JSON.stringify(result.fixture, null, 2) + '\n');
  console.log(`[KLAS fixture] ${name}을 내려받았습니다. tests/fixtures/klas/에 넣으세요.`);
})();
