import { describe, expect, it } from 'vitest';
import { isExtensionMessage, isTabMessage } from '@/utils/messages';

describe('isExtensionMessage', () => {
  it.each(['klas/opened'])('%s를 허용한다', (type) => {
    expect(isExtensionMessage({ type })).toBe(true);
  });

  it.each([
    { type: 'session/extend' },
    { type: 'deadlines/report' },
    { type: 'unknown' },
    {},
    null,
    'klas/opened',
  ])('%j를 거부한다', (message) => {
    expect(isExtensionMessage(message)).toBe(false);
  });
});

describe('isTabMessage', () => {
  it.each(['session/extend'])('%s를 허용한다', (type) => {
    expect(isTabMessage({ type })).toBe(true);
  });

  it.each([{ type: 'klas/opened' }, { type: 'unknown' }, {}, null, 'session/extend'])(
    '%j를 거부한다',
    (message) => {
      expect(isTabMessage(message)).toBe(false);
    },
  );
});
