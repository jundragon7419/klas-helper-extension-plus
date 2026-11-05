import { describe, expect, it } from 'vitest';
import { formatRemaining } from '@/utils/format';

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
});
