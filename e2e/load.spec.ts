import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, extensionPath, test } from './fixtures';

// 확장이 Chromium에 올라가고 background service worker가 실행되는지 확인한다.
// KLAS 화면 테스트는 klas-screens.spec.ts에 있다.
const built = JSON.parse(readFileSync(resolve(extensionPath, 'manifest.json'), 'utf8')) as {
  name: string;
  version: string;
  background: { service_worker: string };
};

// service worker 안에서 쓰는 chrome API 중 테스트에 필요한 부분만 적는다.
interface ChromeGlobal {
  chrome: {
    runtime: {
      getManifest(): { name: string; version: string };
      onMessage: { hasListeners(): boolean };
    };
  };
}

test('확장이 올라가고 background service worker가 실행된다', async ({
  serviceWorker,
  extensionId,
}) => {
  expect(extensionId).toMatch(/^[a-p]{32}$/);
  expect(new URL(serviceWorker.url()).pathname).toBe(`/${built.background.service_worker}`);

  const manifest = await serviceWorker.evaluate(() =>
    (globalThis as unknown as ChromeGlobal).chrome.runtime.getManifest(),
  );
  expect(manifest.name).toBe(built.name);
  expect(manifest.version).toBe(built.version);
});

test('background가 오류 없이 메시지를 받을 준비가 된다', async ({ serviceWorker }) => {
  // service worker 최상위 코드에서 예외가 나면 리스너가 등록되지 않는다.
  const hasListener = await serviceWorker.evaluate(() =>
    (globalThis as unknown as ChromeGlobal).chrome.runtime.onMessage.hasListeners(),
  );
  expect(hasListener).toBe(true);
});
