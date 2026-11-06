import { describe, expect, it } from 'vitest';
import { parseKlasDate } from '@/utils/date';
import type { KlasSemester } from '@/utils/klas/schema';
import { latestStartedTerm, parseSemester, pickCurrentSemester } from '@/utils/klas/semester';
import fixture from './fixtures/klas/2026-2.json';

const at = (text: string) => parseKlasDate(text)!;
const semester = (value: string): KlasSemester => ({ value, label: value, subjList: [] });
const pick = (values: string[], date: string) =>
  pickCurrentSemester(values.map(semester), at(date))?.value ?? null;

describe('parseSemester', () => {
  it('학기 코드를 읽는다', () => {
    expect(parseSemester('2026,2')).toEqual({ year: 2026, term: 2 });
    expect(parseSemester('2026,3')).toEqual({ year: 2026, term: 3 });
  });

  it.each(['2026-2', '2026,5', '26,1', ''])('%s → null', (value) => {
    expect(parseSemester(value)).toBeNull();
  });
});

describe('latestStartedTerm (한국 날짜 기준)', () => {
  it.each([
    ['2027-01-15 12:00', { year: 2026, term: 4 }],
    ['2027-02-28 23:59', { year: 2026, term: 4 }],
    ['2027-03-01 00:00', { year: 2027, term: 1 }],
    ['2027-06-30 23:59', { year: 2027, term: 1 }],
    ['2027-07-01 00:00', { year: 2027, term: 3 }],
    ['2027-09-01 00:00', { year: 2027, term: 2 }],
    ['2027-12-31 23:59', { year: 2027, term: 2 }],
  ])('%s → %o', (date, term) => {
    expect(latestStartedTerm(at(date))).toEqual(term);
  });

  it('UTC로는 전날이어도 한국 날짜로 판단한다', () => {
    // 2027-03-01 00:30 KST = 2027-02-28 15:30 UTC
    expect(latestStartedTerm(at('2027-03-01 00:30'))).toEqual({ year: 2027, term: 1 });
  });
});

describe('pickCurrentSemester', () => {
  it('실제 응답: 2026년 11월에는 2026,2', () => {
    const value = pickCurrentSemester(fixture.subjects, at('2026-11-06 12:00'));
    expect(value?.value).toBe('2026,2');
  });

  it('수강 신청 기간에 다음 학기가 맨 앞에 와도 지금 학기를 고른다', () => {
    expect(pick(['2027,1', '2026,2', '2026,1'], '2027-02-10 12:00')).toBe('2026,2');
    expect(pick(['2027,1', '2026,2'], '2027-03-02 09:00')).toBe('2027,1');
  });

  it('목록 순서와 관계없이 가장 최근 학기를 고른다', () => {
    expect(pick(['2026,1', '2026,2', '2025,2'], '2026-11-06 12:00')).toBe('2026,2');
  });

  it('휴학 뒤처럼 이번 학기가 없으면 들은 학기 중 가장 최근 학기를 고른다', () => {
    expect(pick(['2024,1', '2023,2'], '2026-11-06 12:00')).toBe('2024,1');
  });

  it('계절학기는 그 기간에만 고르고, 정규 학기 마감 달에는 정규 학기를 고른다', () => {
    const list = ['2027,3', '2027,1'];
    expect(pick(list, '2027-06-25 12:00')).toBe('2027,1');
    expect(pick(list, '2027-07-10 12:00')).toBe('2027,3');
    expect(pick(['2026,4', '2026,2'], '2026-12-26 12:00')).toBe('2026,2');
    expect(pick(['2026,4', '2026,2'], '2027-01-10 12:00')).toBe('2026,4');
  });

  it('고를 학기가 없으면 null (입학 전, 형식이 다른 값만 있음)', () => {
    expect(pick(['2027,1'], '2027-02-20 12:00')).toBeNull();
    expect(pick(['2026-2'], '2026-11-06 12:00')).toBeNull();
    expect(pick([], '2026-11-06 12:00')).toBeNull();
  });
});
