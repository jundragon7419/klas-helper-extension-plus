import { afterAll, describe, expect, it } from 'vitest';
import { parseKlasDate } from '@/utils/date';
import fixture from './fixtures/klas/2026-2.json';

// 2026-12-01 18:00:59 KST = 2026-12-01 09:00:59 UTC
const DEC_1_1800_59_KST = Date.UTC(2026, 11, 1, 9, 0, 59);
// 2026-10-12 23:59 KST = 2026-10-12 14:59 UTC
const OCT_12_2359_KST = Date.UTC(2026, 9, 12, 14, 59, 0);

describe('parseKlasDate: ARCHITECTURE의 날짜 형식 4종', () => {
  it('`2026-12-01 18:00:59` (과제 expiredate)는 한국 시간이다', () => {
    expect(parseKlasDate('2026-12-01 18:00:59')).toBe(DEC_1_1800_59_KST);
  });

  it('`2026-10-12 23:59` (온라인 강의 endDate, 퀴즈 edt)는 한국 시간이다', () => {
    expect(parseKlasDate('2026-10-12 23:59')).toBe(OCT_12_2359_KST);
  });

  it('`202610122359` (온라인 강의, 퀴즈 edate)는 한국 시간이다', () => {
    expect(parseKlasDate('202610122359')).toBe(OCT_12_2359_KST);
  });

  it('`2026-11-13T14:59:59.000+00:00` (팀 프로젝트 expiredate)는 적힌 시간대를 따른다', () => {
    // 한국 시간 2026-11-13 23:59:59
    expect(parseKlasDate('2026-11-13T14:59:59.000+00:00')).toBe(Date.UTC(2026, 10, 13, 14, 59, 59));
    expect(parseKlasDate('2026-11-13T23:59:59+09:00')).toBe(Date.UTC(2026, 10, 13, 14, 59, 59));
    expect(parseKlasDate('2026-11-13T14:59:59Z')).toBe(Date.UTC(2026, 10, 13, 14, 59, 59));
  });

  it('같은 시각을 가리키는 세 형식은 같은 값이 된다', () => {
    expect(parseKlasDate('2026-10-12 23:59')).toBe(parseKlasDate('202610122359'));
    expect(parseKlasDate('2026-10-12 23:59:00')).toBe(parseKlasDate('2026-10-12 23:59'));
  });
});

describe('parseKlasDate: 해석할 수 없는 값', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['숫자', 202610122359],
    ['빈 문자열', ''],
    ['날짜만', '2026-10-12'],
    ['시간대 없는 ISO', '2026-10-12T23:59:00'],
    ['다른 구분자', '2026.10.12 23:59'],
    ['없는 날짜', '2026-02-30 12:00'],
    ['없는 월', '2026-13-01 12:00'],
    ['없는 시각', '2026-10-12 24:00'],
    ['없는 분', '202610122360'],
    ['자리수가 다름', '20261012235'],
    ['익명화된 문구', 'lrnPd 12'],
  ])('%s → null', (_name, value) => {
    expect(parseKlasDate(value)).toBeNull();
  });

  it('앞뒤 공백은 무시한다', () => {
    expect(parseKlasDate(' 2026-10-12 23:59 ')).toBe(OCT_12_2359_KST);
  });
});

describe('parseKlasDate: PC 시간대와 관계없음', () => {
  const originalTz = process.env.TZ;
  afterAll(() => {
    process.env.TZ = originalTz;
  });

  const zones = ['Asia/Seoul', 'UTC', 'America/Los_Angeles', 'Pacific/Kiritimati'];
  const samples = [
    '2026-12-01 18:00:59',
    '2026-10-12 23:59',
    '202610122359',
    '2026-11-13T14:59:59.000+00:00',
  ];

  it.each(zones)('%s에서도 같은 결과', (zone) => {
    process.env.TZ = zone;
    // 시간대가 실제로 바뀌었는지 확인한다. (바뀌지 않으면 이 테스트는 의미가 없다)
    const offset = new Date(Date.UTC(2026, 0, 1)).getTimezoneOffset();
    const expectedOffset = {
      'Asia/Seoul': -540,
      UTC: 0,
      'America/Los_Angeles': 480,
      'Pacific/Kiritimati': -840,
    }[zone];
    expect(offset).toBe(expectedOffset);

    process.env.TZ = 'Asia/Seoul';
    const inSeoul = samples.map(parseKlasDate);
    process.env.TZ = zone;
    expect(samples.map(parseKlasDate)).toEqual(inSeoul);
    expect(parseKlasDate('2026-10-12 23:59')).toBe(OCT_12_2359_KST);
  });
});

describe('parseKlasDate: 실제 KLAS 응답 (tests/fixtures/klas/2026-2.json)', () => {
  const deadlineFields: Record<string, string[]> = {
    online: ['startDate', 'endDate', 'sdate', 'edate'],
    task: ['startdate', 'expiredate', 'restartdate', 'reexpiredate'],
    project: ['startdate', 'expiredate', 'restartdate', 'reexpiredate'],
    quiz: ['sdate', 'edate', 'sdt', 'edt'],
  };
  const lists = fixture.lists as Record<string, Record<string, Record<string, unknown>[]>>;

  it('마감과 시작 날짜 필드는 값이 있으면 모두 해석된다', () => {
    let checked = 0;
    for (const entry of Object.values(lists)) {
      for (const [kind, fields] of Object.entries(deadlineFields)) {
        for (const row of entry[kind] ?? []) {
          for (const field of fields) {
            const value = row[field];
            if (value === null || value === undefined) continue;
            expect(
              parseKlasDate(value),
              `${kind}.${field} = ${JSON.stringify(value)}`,
            ).not.toBeNull();
            checked += 1;
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(50);
  });

  it('온라인 강의의 endDate와 edate는 같은 시각이다', () => {
    for (const entry of Object.values(lists)) {
      for (const row of entry.online ?? []) {
        if (typeof row.edate !== 'string') continue;
        expect(parseKlasDate(row.endDate)).toBe(parseKlasDate(row.edate));
      }
    }
  });
});
