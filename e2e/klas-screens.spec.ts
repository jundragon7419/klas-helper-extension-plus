import type { Page, TestInfo } from '@playwright/test';
import { expect, test } from './fixtures';
import { KLAS_ORIGIN, mockKlas, PAGES } from './klas';

// 가짜 KLAS 화면(e2e/klas.ts)에 확장을 올려 content script 기능을 확인한다.
// 테스트마다 마지막 화면을 스크린샷으로 남긴다. CI는 test-results/를 e2e-screenshots artifact로 올린다.

async function open(context: import('@playwright/test').BrowserContext, path: string) {
  await mockKlas(context);
  const page = await context.newPage();
  await page.goto(`${KLAS_ORIGIN}${path}`);
  return page;
}

async function screenshot(page: Page, testInfo: TestInfo, name: string) {
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: true });
  await testInfo.attach(name, { path, contentType: 'image/png' });
}

test('KLAS 탭 버튼이 보이고, 열면 마감 일정 탭과 마감 목록이 나온다', async ({
  context,
}, testInfo) => {
  const page = await open(context, PAGES.home);
  const handle = page.getByRole('button', { name: '마감 일정 열기' });
  await expect(handle).toBeVisible();
  await screenshot(page, testInfo, 'drawer-closed');

  await handle.click();
  const drawer = page.getByRole('complementary', { name: 'KLAS Helper+' });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole('tab', { name: '마감 일정' })).toHaveAttribute(
    'aria-selected',
    'true',
  );

  // API fixture의 과제가 남은 마감으로 나온다. 조회 실패나 로그인 안내는 없어야 한다.
  const items = drawer.locator('.deadline-item');
  await expect(items.first()).toBeVisible({ timeout: 15_000 });
  await expect(drawer.getByText('마지막 확인')).toBeVisible();
  await expect(drawer.getByText(/확인하지 못했습니다|로그인이 필요합니다/)).toHaveCount(0);
  await expect(items.first().locator('.deadline-kind')).toHaveText(/과제|강의|퀴즈|팀 프로젝트/);
  await screenshot(page, testInfo, 'drawer-open');
});

test('수업시간표 항목에 실제 수업 시각을 붙인다', async ({ context }, testInfo) => {
  const page = await open(context, PAGES.home);
  const times = page.locator('table.scheduletb [data-khp-lesson-time]');
  await expect(times).toHaveCount(2);
  await expect(times.nth(0)).toHaveAttribute('data-khp-lesson-time', '09:00 ~ 10:15');
  await expect(times.nth(1)).toHaveAttribute('data-khp-lesson-time', '10:30 ~ 13:15');
  await screenshot(page, testInfo, 'lesson-time');
});

test('과목 머리말에 강의계획서 바로가기를 붙인다', async ({ context }, testInfo) => {
  const page = await open(context, PAGES.onlineLectures);
  const link = page.locator('.subtitle a[data-khp-syllabus-link]');
  await expect(link).toHaveCount(1);
  await expect(link).toHaveAttribute(
    'href',
    '/std/cps/atnlc/popup/LectrePlanStdView.do?selectSubj=X0000000000000001',
  );
  await expect(link).toContainText('강의계획서 조회');
  await screenshot(page, testInfo, 'syllabus-link');
});

test('강의계획서 검색에서 Enter로 조회 버튼을 누른다', async ({ context }, testInfo) => {
  const page = await open(context, PAGES.syllabusSearch);
  // KLAS 조회 함수 대신 버튼이 눌렸는지만 기록한다.
  await page.evaluate(() => {
    document.querySelector('.btnCon button')?.addEventListener('click', () => {
      document.body.dataset.searched = String(Number(document.body.dataset.searched ?? 0) + 1);
    });
  });
  const input = page.locator('input[name="selectText"]');
  // content script가 붙기 전에 누르지 않도록, 붙을 때까지 다시 누른다.
  await expect(async () => {
    await input.press('Enter');
    await expect(page.locator('body')).toHaveAttribute('data-searched', /\d+/, { timeout: 500 });
  }).toPass({ timeout: 10_000 });
  await screenshot(page, testInfo, 'syllabus-search');
});

test('시청 완료한 강의를 숨기고 다시 표시한다', async ({ context }, testInfo) => {
  const page = await open(context, PAGES.onlineLectures);
  const button = page.getByRole('button', { name: /완료한 강의 숨기기/ });
  await expect(button).toBeVisible();
  const rows = page.locator('.tablelistbox tbody tr');
  await expect(rows).toHaveCount(4);
  await screenshot(page, testInfo, 'lecture-filter-before');

  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.khp-lecture-filter-status')).toHaveText(
    '완료한 강의 2개를 숨겼습니다.',
  );
  // 1주차(전부 완료)는 숨기고, 2주차의 완료 강의는 공통 칸을 남긴 채 내용만 숨긴다.
  await expect(page.locator('tr[data-khp-lecture="hidden"]')).toHaveCount(1);
  await expect(page.locator('tr[data-khp-lecture="shell"]')).toHaveCount(1);
  await expect(page.locator('tr[data-khp-lecture="hidden"]')).toBeHidden();
  await expect(page.locator('tr[data-khp-lecture="shell"] td.weekNo-2')).toBeVisible();
  await expect(page.getByText('텍스트6')).toBeVisible();
  await screenshot(page, testInfo, 'lecture-filter-after');

  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('tr[data-khp-lecture]')).toHaveCount(0);
  await expect(page.getByText('텍스트3')).toBeVisible();
});
