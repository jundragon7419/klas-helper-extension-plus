import { describe, expect, it } from 'vitest';
import {
  CONTRAST_PAIRS,
  contrastRatio,
  cssDeclarations,
  resolvePair,
  tokens,
  tokensToCss,
} from '@/utils/ui/tokens';

describe('디자인 토큰', () => {
  it('색은 모두 #rrggbb 형식이다', () => {
    for (const [name, value] of Object.entries(tokens.color)) {
      expect(value, name).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it.each(CONTRAST_PAIRS)('$use: $fg / $bg 대비가 $min:1 이상이다', (pair) => {
    const [fg, bg] = resolvePair(pair);
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(pair.min);
  });

  it('대비 계산이 알려진 값과 맞는다', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
    expect(contrastRatio('#767676', '#ffffff')).toBeCloseTo(4.54, 2);
  });

  it('CSS 변수 이름이 겹치지 않는다', () => {
    const names = cssDeclarations().map(([name]) => name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('숫자 토큰에 단위를 붙인다', () => {
    const css = tokensToCss();
    expect(css).toContain('--khp-font-size-sm: 13px;');
    expect(css).toContain('--khp-line-height-body: 1.6;');
    expect(css).toContain('--khp-duration-drawer: 200ms;');
    expect(css).toContain('all: initial;');
  });

  it('움직임 줄이기 설정에서는 서랍 움직임 시간을 0으로 한다', () => {
    expect(tokensToCss()).toMatch(
      /prefers-reduced-motion: reduce[\s\S]*--khp-duration-drawer: 0ms/,
    );
  });
});
