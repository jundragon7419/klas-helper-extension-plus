import { describe, expect, it } from 'vitest';
import { formatRemaining, UNKNOWN_REMAINING } from '@/utils/format';

const HOUR = 3_600_000;

describe('formatRemaining', () => {
  it('1시간 미만은 분으로 표시한다', () => {
    expect(formatRemaining(30 * 60_000)).toBe('30분');
  });

  it('48시간 미만은 시간으로 표시한다', () => {
    expect(formatRemaining(5 * HOUR)).toBe('5시간');
  });

  it('48시간 이상은 일과 시간으로 표시한다', () => {
    expect(formatRemaining(52 * HOUR)).toBe('2일 4시간');
  });

  it('이미 지난 시간은 0분으로 표시한다', () => {
    expect(formatRemaining(-1000)).toBe('0분');
  });

  it('숫자가 아니거나 무한대면 "알 수 없음"으로 표시한다', () => {
    expect(formatRemaining(Number.NaN)).toBe(UNKNOWN_REMAINING);
    expect(formatRemaining(Number.POSITIVE_INFINITY)).toBe(UNKNOWN_REMAINING);
    expect(formatRemaining(Number.NEGATIVE_INFINITY)).toBe(UNKNOWN_REMAINING);
  });
});
