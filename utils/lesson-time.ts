// 교시별 수업 시간. 2026-11-11에 메인테이너가 제공한 기준이다. (#98)
// 0교시는 45분, 1~6교시는 75분, 7~9교시는 45분 수업이며 사이에 15분씩 쉰다.
const PERIODS: readonly (readonly [string, string])[] = [
  ['08:00', '08:45'],
  ['09:00', '10:15'],
  ['10:30', '11:45'],
  ['12:00', '13:15'],
  ['13:30', '14:45'],
  ['15:00', '16:15'],
  ['16:30', '17:45'],
  ['18:00', '18:45'],
  ['19:00', '19:45'],
  ['20:00', '20:45'],
];

/** 시작 교시부터 `count`개 연속 교시의 시간 범위. 해석할 수 없으면 null. */
export function lessonTimeRange(startPeriod: number, count: number): string | null {
  if (!Number.isInteger(startPeriod) || !Number.isInteger(count) || count < 1) return null;
  const first = PERIODS[startPeriod];
  const last = PERIODS[startPeriod + count - 1];
  if (!first || !last) return null;
  return `${first[0]} ~ ${last[1]}`;
}
