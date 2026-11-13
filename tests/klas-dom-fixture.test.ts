import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseHTML } from 'linkedom';
import { describe, expect, it } from 'vitest';
import {
  findDomLeaks,
  findInfoLeaks,
  PAGE_NAME_PATTERN,
  parseDomFixture,
} from '../scripts/fixtures/anonymize-dom.ts';

// tests/fixtures/klas/dom/에 커밋한 화면 발췌에 개인정보 형식이 없는지 검사한다.
const dir = join(import.meta.dirname, 'fixtures/klas/dom');
const files = existsSync(dir) ? readdirSync(dir).filter((name) => name.endsWith('.html')) : [];

describe('tests/fixtures/klas/dom', () => {
  it('파일 이름은 <페이지 이름>.html이다', () => {
    for (const name of readdirSync(dir).filter((n) => n !== 'README.md' && n !== '.gitkeep')) {
      expect(name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*\.html$/);
    }
  });

  for (const name of files) {
    describe(name, () => {
      const parsed = parseDomFixture(readFileSync(join(dir, name), 'utf8'));

      it('정보 줄이 있고 페이지 이름이 파일 이름과 같다', () => {
        expect(parsed).not.toBeNull();
        expect(PAGE_NAME_PATTERN.test(parsed!.info.page)).toBe(true);
        expect(`${parsed!.info.page}.html`).toBe(name);
        expect(parsed!.info.path).not.toContain('?');
        expect(findInfoLeaks(parsed!.info)).toEqual([]);
      });

      it('학번, 한글(남길 낱말 제외), 전화번호, 이메일이 없다', () => {
        const { document } = parseHTML(`<!doctype html><html><body>${parsed!.html}</body></html>`);
        expect(findDomLeaks(document.body, parsed!.info.keepText)).toEqual([]);
      });
    });
  }
});
