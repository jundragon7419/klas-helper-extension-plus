import { defineConfig } from '@playwright/test';

// 빌드한 확장을 Chromium에 올려 보는 E2E 테스트 설정.
// Chrome과 Edge는 확장을 명령줄로 올리는 옵션을 막아서, Playwright가 내려받는 Chromium이 둘을 대표한다.
// 실행 전에 npm run build와 npx playwright install chromium이 필요하다.
export default defineConfig({
  testDir: 'e2e',
  outputDir: 'test-results',
  // 확장은 브라우저 프로필 하나를 통째로 쓰므로 테스트를 동시에 돌리지 않는다.
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
