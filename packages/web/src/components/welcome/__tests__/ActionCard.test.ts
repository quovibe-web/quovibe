import { describe, it, expect } from 'vitest';
import { ACCENT_VAR, type ActionCardAccent } from '../ActionCard';

describe('ActionCard — ACCENT_VAR', () => {
  it('maps primary to --color-primary', () => {
    expect(ACCENT_VAR.primary).toBe('var(--color-primary)');
  });

  it('maps teal to --color-chart-2 (Flexoki #3AA99F)', () => {
    expect(ACCENT_VAR.teal).toBe('var(--color-chart-2)');
  });

  it('maps orange to --color-chart-3 (Flexoki #DA702C)', () => {
    expect(ACCENT_VAR.orange).toBe('var(--color-chart-3)');
  });

  it('covers every ActionCardAccent union member', () => {
    const accents = Object.keys(ACCENT_VAR) as ActionCardAccent[];
    for (const a of accents) {
      expect(ACCENT_VAR[a]).toMatch(/^var\(--/);
    }
  });
});
