import { describe, expect, it } from 'vitest';
import { STUDENT_NUMBER_PATTERN } from '../scripts/fixtures/anonymize.ts';
import fixture from './fixtures/klas/2026-2.json';

/** 결과에 들어 있는 문자열 값을 모두 모은다. */
function strings(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) value.forEach((item) => strings(item, out));
  else if (value !== null && typeof value === 'object') {
    Object.values(value).forEach((child) => strings(child, out));
  } else if (typeof value === 'string') out.push(value);
  return out;
}

// 세션 만료 응답은 로그인 페이지 HTML이라 따로 본다.
const { sessionExpired, ...data } = fixture;
const values = strings(data);

describe('tests/fixtures/klas/2026-2.json', () => {
  it('학번 형식의 숫자가 없다', () => {
    for (const value of values) expect(value).not.toMatch(STUDENT_NUMBER_PATTERN);
  });

  it('한글은 가짜 과목명과 학기 표시에만 있다', () => {
    const hangul = values.filter((value) => /[가-힣]/.test(value));
    for (const value of hangul) expect(value).toMatch(/^(과목 \d+|\d{4}년도 \d학기)$/);
  });

  it('ARCHITECTURE의 날짜 형식 4종이 모두 들어 있다', () => {
    const formats = {
      '2026-12-01 18:00:59': /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/,
      '2026-11-13T14:59:59.000+00:00': /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}\+00:00$/,
      '2026-10-12 23:59': /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/,
      '202610122359': /^\d{12}$/,
    };
    for (const [example, pattern] of Object.entries(formats)) {
      expect(
        values.some((value) => pattern.test(value)),
        example,
      ).toBe(true);
    }
  });

  it('과목 목록의 과목마다 네 종류 목록이 있다', () => {
    const subjects = fixture.subjects as { value: string; subjList: { value: string }[] }[];
    const lists = fixture.lists as Record<string, Record<string, unknown> | undefined>;
    const current = subjects[0];
    expect(current?.value).toBe(fixture.semester);
    for (const subject of current?.subjList ?? []) {
      const entry = lists[subject.value];
      expect(Object.keys(entry ?? {}).sort()).toEqual(['online', 'project', 'quiz', 'task']);
    }
  });

  it('세션이 없을 때의 응답은 200과 로그인 페이지 HTML이다', () => {
    expect(sessionExpired.status).toBe(200);
    expect(sessionExpired.contentType).toContain('text/html');
    expect(sessionExpired.path).toContain('LoginForm');
  });
});
