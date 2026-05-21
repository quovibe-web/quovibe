// Reference: ForexViewChip — per-surface base/native toggle
import { describe, it, expect } from 'vitest';
import { resolveForexView, getDefaultsForSurface } from '../ForexViewChip';

describe('resolveForexView (pure helper)', () => {
  it('returns base when state says base', () => {
    expect(resolveForexView({ investments: 'base' }, 'investments')).toBe('base');
  });

  it('returns native when state says native', () => {
    expect(resolveForexView({ investments: 'native' }, 'investments')).toBe('native');
  });

  it('defaults to base when surface missing', () => {
    expect(resolveForexView({}, 'investments')).toBe('base');
  });

  it('defaults to native for securityDetail when missing', () => {
    expect(resolveForexView({}, 'securityDetail')).toBe('native');
  });

  it('defaults are consistent with forexViewSchema (Task 19)', () => {
    expect(getDefaultsForSurface('dashboard')).toBe('base');
    expect(getDefaultsForSurface('investments')).toBe('base');
    expect(getDefaultsForSurface('securityDrawer')).toBe('base');
    expect(getDefaultsForSurface('securityDetail')).toBe('native');
    expect(getDefaultsForSurface('statement')).toBe('base');
  });
});
