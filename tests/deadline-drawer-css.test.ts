import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../utils/ui/deadline-drawer.css', import.meta.url), 'utf8');

describe('deadline drawer header buttons', () => {
  it('keeps the settings and close buttons the same color on hover', () => {
    expect(css).not.toMatch(/\.drawer-(settings-button|close):hover/);
  });

  it('keeps the keyboard focus indicator', () => {
    expect(css).toMatch(/\.drawer-settings-button:focus-visible/);
    expect(css).toMatch(/\.drawer-close:focus-visible/);
  });
});
