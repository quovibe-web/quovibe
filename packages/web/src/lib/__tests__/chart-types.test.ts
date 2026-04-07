import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { withAlpha, getSavedChartType } from '../chart-types';

describe('withAlpha', () => {
  // --- Existing formats (must still work) ---
  it('applies alpha to #rrggbb hex', () => {
    expect(withAlpha('#ff0000', 0.5)).toBe('#ff000080');
  });

  it('applies alpha to #rgb shorthand', () => {
    expect(withAlpha('#f00', 0.5)).toBe('#ff000080');
  });

  it('applies alpha to hsl() comma syntax', () => {
    expect(withAlpha('hsl(225, 15%, 20%)', 0.5)).toBe('hsla(225, 15%, 20%, 0.5)');
  });

  it('replaces alpha in hsla() comma syntax', () => {
    expect(withAlpha('hsla(225, 15%, 20%, 0.8)', 0.5)).toBe('hsla(225, 15%, 20%, 0.5)');
  });

  it('applies alpha to rgb() comma syntax', () => {
    expect(withAlpha('rgb(255, 0, 0)', 0.5)).toBe('rgba(255, 0, 0, 0.5)');
  });

  it('replaces alpha in rgba() comma syntax', () => {
    expect(withAlpha('rgba(255, 0, 0, 0.8)', 0.5)).toBe('rgba(255, 0, 0, 0.5)');
  });

  // --- Modern CSS formats (currently broken) ---
  it('applies alpha to hsl() space syntax', () => {
    expect(withAlpha('hsl(225 15% 20%)', 0.5)).toBe('hsl(225 15% 20% / 0.5)');
  });

  it('replaces alpha in hsl() slash syntax', () => {
    expect(withAlpha('hsl(225 15% 20% / 0.8)', 0.5)).toBe('hsl(225 15% 20% / 0.5)');
  });

  it('applies alpha to rgb() space syntax', () => {
    expect(withAlpha('rgb(255 0 0)', 0.5)).toBe('rgb(255 0 0 / 0.5)');
  });

  it('replaces alpha in rgb() slash syntax', () => {
    expect(withAlpha('rgb(255 0 0 / 0.8)', 0.5)).toBe('rgb(255 0 0 / 0.5)');
  });

  // --- Edge cases ---
  it('returns unknown colors as-is', () => {
    expect(withAlpha('red', 0.5)).toBe('red');
  });

  it('handles alpha = 0', () => {
    expect(withAlpha('#ff0000', 0)).toBe('#ff000000');
  });

  it('handles alpha = 1', () => {
    expect(withAlpha('#ff0000', 1)).toBe('#ff0000ff');
  });
});

describe('getSavedChartType', () => {
  beforeAll(() => {
    // Stub localStorage in the node test environment
    (globalThis as Record<string, unknown>).localStorage = {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined,
    };
  });

  afterAll(() => {
    delete (globalThis as Record<string, unknown>).localStorage;
  });

  it('returns null for unknown chart ID', () => {
    expect(getSavedChartType('nonexistent-id-xyz')).toBeNull();
  });
});
