// KLAS 날짜 문자열을 시각(epoch ms)으로 바꾼다.
//
// KLAS는 API마다 날짜 형식이 다르고, 대부분 시간대 표시 없이 한국 시간으로 준다.
// `new Date('2026-10-12 23:59')`처럼 PC 시간대로 해석하면 해외에 있는 사용자는
// 마감이 최대 17시간 어긋나므로, 시간대 표시가 없는 형식은 항상 한국 시간으로 본다.
// 형식 목록은 docs/ARCHITECTURE.md의 "날짜 형식"을 따른다.

/** 한국 표준시와 UTC의 차이. 한국은 일광 절약 시간을 쓰지 않는다. */
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** `2026-12-01 18:00:59`, `2026-10-12 23:59` */
const DASHED = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})(?::(\d{2}))?$/;

/** `202610122359` */
const COMPACT = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})$/;

/** `2026-11-13T14:59:59.000+00:00`, `2026-11-13T14:59:59Z` */
const ISO_WITH_ZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

/** 한국 시간 기준 날짜와 시각을 epoch ms로 바꾼다. 없는 날짜(2월 30일 등)면 null. */
function fromKst(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
): number | null {
  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) return null;
  const utc = Date.UTC(year, month - 1, day, hour, minute, second);
  const check = new Date(utc);
  // Date.UTC는 2월 30일을 3월 2일로 넘겨 버리므로 날짜가 그대로인지 확인한다.
  if (check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  return utc - KST_OFFSET_MS;
}

/**
 * KLAS 날짜 문자열을 epoch ms로 바꾼다. 해석할 수 없으면 null.
 *
 * - 시간대 표시가 없는 형식(`2026-12-01 18:00:59`, `2026-10-12 23:59`, `202610122359`)은
 *   PC 시간대와 관계없이 한국 시간으로 본다.
 * - 시간대가 적힌 ISO 형식(`2026-11-13T14:59:59.000+00:00`)은 적힌 시간대를 따른다.
 */
export function parseKlasDate(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();

  const dashed = DASHED.exec(text);
  if (dashed) {
    const [, y, mo, d, h, mi, s] = dashed;
    return fromKst(Number(y), Number(mo), Number(d), Number(h), Number(mi), Number(s ?? 0));
  }

  const compact = COMPACT.exec(text);
  if (compact) {
    const [, y, mo, d, h, mi] = compact;
    return fromKst(Number(y), Number(mo), Number(d), Number(h), Number(mi), 0);
  }

  if (ISO_WITH_ZONE.test(text)) {
    const time = Date.parse(text);
    return Number.isNaN(time) ? null : time;
  }

  return null;
}
