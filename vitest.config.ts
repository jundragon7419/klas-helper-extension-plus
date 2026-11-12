import { configDefaults, defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing/vitest-plugin';

export default defineConfig({
  plugins: [WxtVitest()],
  // e2e/는 Playwright가 실행한다(npm run test:e2e).
  test: { exclude: [...configDefaults.exclude, 'e2e/**'] },
});
