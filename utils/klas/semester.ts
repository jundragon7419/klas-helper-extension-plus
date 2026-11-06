// 마감을 조회할 학기를 고른다.
//
// KLAS 과목 목록은 들은 학기를 최근 순으로 준다. 수강 신청 기간에는 아직 시작하지 않은
// 다음 학기가 맨 앞에 올 수 있어서, 첫 학기를 그대로 쓰지 않고 오늘 날짜로 거른다.

import type { KlasSemester } from './schema';

/** 한국 표준시와 UTC의 차이 */
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/**
 * 학기 코드의 순서. 1학기(3~6월) → 여름 계절학기 → 2학기(9~12월) → 겨울 계절학기.
 * 계절학기 코드(3: 여름, 4: 겨울)는 아직 실제 응답으로 확인하지 않았다.
 */
const TERM_ORDER: Record<number, number> = { 1: 1, 3: 2, 2: 3, 4: 4 };

interface Term {
  year: number;
  term: number;
}

/** "2026,2" → { year: 2026, term: 2 }. 형식이 다르면 null */
export function parseSemester(value: string): Term | null {
  const match = /^(\d{4}),(\d)$/.exec(value);
  if (!match) return null;
  const term = Number(match[2]);
  return TERM_ORDER[term] === undefined ? null : { year: Number(match[1]), term };
}

function rank({ year, term }: Term): number {
  return year * 10 + (TERM_ORDER[term] ?? 0);
}

/**
 * 오늘(한국 날짜) 마감을 볼 가장 늦은 학기.
 * - 1~2월: 전년도 겨울 계절학기
 * - 3~6월: 1학기 (6월에는 기말 마감이 남아 있다)
 * - 7~8월: 여름 계절학기
 * - 9~12월: 2학기 (12월에는 기말 마감이 남아 있다)
 *
 * 계절학기는 정규 학기가 끝나기 전(6월 말, 12월 말)에 시작하지만, 정규 학기 마감을
 * 놓치지 않도록 정규 학기를 그 달 끝까지 쓴다.
 */
export function latestStartedTerm(now: number): Term {
  const kst = new Date(now + KST_OFFSET_MS);
  const year = kst.getUTCFullYear();
  const month = kst.getUTCMonth() + 1;
  if (month <= 2) return { year: year - 1, term: 4 };
  if (month <= 6) return { year, term: 1 };
  if (month <= 8) return { year, term: 3 };
  return { year, term: 2 };
}

/**
 * 마감을 조회할 학기를 고른다. 오늘 이미 시작했을 수 있는 학기 중 가장 최근 학기다.
 * 아직 시작하지 않은 학기(수강 신청 기간의 다음 학기)는 건너뛴다. 고를 학기가 없으면 null.
 */
export function pickCurrentSemester(
  semesters: readonly KlasSemester[],
  now: number,
): KlasSemester | null {
  const limit = rank(latestStartedTerm(now));
  let best: { semester: KlasSemester; rank: number } | null = null;
  for (const semester of semesters) {
    const term = parseSemester(semester.value);
    if (!term) continue;
    const r = rank(term);
    if (r <= limit && (best === null || r > best.rank)) best = { semester, rank: r };
  }
  return best?.semester ?? null;
}
