import { describe, expect, it } from 'vitest';
import { loadApiFixture, PAGES, readDomFixture, shiftDates } from '../e2e/klas.ts';

// 가짜 KLAS(e2e/klas.ts)의 날짜 옮기기와 fixture 읽기를 검사한다.
describe('shiftDates', () => {
  it('KLAS 날짜 형식의 날짜만 옮기고 시각은 둔다', () => {
    expect(shiftDates('2026-12-01 18:00:59', 7)).toBe('2026-12-08 18:00:59');
    expect(shiftDates('2026-10-12 23:59', 30)).toBe('2026-11-11 23:59');
    expect(shiftDates('2026-11-13T14:59:59.000+00:00', 1)).toBe('2026-11-14T14:59:59.000+00:00');
    expect(shiftDates('202612312359', 1)).toBe('202701012359');
    expect(shiftDates('20261231', 1)).toBe('20270101');
    expect(shiftDates('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('날짜가 아닌 값은 그대로 둔다', () => {
    for (const value of ['2026,2', 'title 1', 'X0000000000000001', '1234', '2026년도 2학기', '']) {
      expect(shiftDates(value, 5)).toBe(value);
    }
  });
});

describe('loadApiFixture', () => {
  it('모은 날이 오늘(한국 날짜)이 되도록 날짜를 옮긴다', () => {
    const now = Date.parse('2027-03-02T00:00:00+09:00');
    const fixture = loadApiFixture(now);
    expect(fixture.collectedOn).toBe('2027-03-02');
    const task = Object.values(fixture.lists).flatMap((lists) => lists.task ?? [])[0] as {
      expiredate: string;
    };
    // 원본 2026-11-06에서 116일 뒤
    expect(task.expiredate.slice(0, 4)).toBe('2027');
  });
});

describe('readDomFixture', () => {
  it('E2E가 쓰는 화면 fixture가 모두 있다', () => {
    for (const name of ['home', 'online-lectures', 'syllabus-search']) {
      expect(readDomFixture(name)).not.toMatch(/^<!--/);
    }
    expect(Object.keys(PAGES)).toEqual(['home', 'onlineLectures', 'syllabusSearch']);
  });
});
