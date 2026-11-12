import { chromium, test as base, type BrowserContext, type Worker } from '@playwright/test';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// 빌드한 Chromium 확장(.output/chrome-mv3)을 올린 브라우저를 테스트마다 새로 띄운다.
export const extensionPath = resolve('.output/chrome-mv3');

export const test = base.extend<{
  context: BrowserContext;
  serviceWorker: Worker;
  extensionId: string;
}>({
  // eslint-disable-next-line no-empty-pattern -- Playwright fixture는 첫 인자를 구조 분해해야 한다.
  context: async ({}, use) => {
    if (!existsSync(resolve(extensionPath, 'manifest.json'))) {
      throw new Error(`${extensionPath}가 없습니다. npm run build를 먼저 실행합니다.`);
    }
    const context = await chromium.launchPersistentContext('', {
      // 확장을 headless로 올리려면 Playwright의 chromium 채널이 필요하다.
      // CHROMIUM_PATH로 다른 Chromium(Chrome for Testing 등)을 지정할 수 있다.
      ...(process.env.CHROMIUM_PATH
        ? { executablePath: process.env.CHROMIUM_PATH }
        : { channel: 'chromium' }),
      headless: true,
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    });
    await use(context);
    await context.close();
  },
  serviceWorker: async ({ context }, use) => {
    const worker =
      context.serviceWorkers()[0] ??
      (await context.waitForEvent('serviceworker', { timeout: 15_000 }));
    await use(worker);
  },
  extensionId: async ({ serviceWorker }, use) => {
    await use(new URL(serviceWorker.url()).host);
  },
});

export const expect = test.expect;
