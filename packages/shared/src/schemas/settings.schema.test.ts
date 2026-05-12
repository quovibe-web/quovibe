import { describe, it, expect } from 'vitest';
import { calculationViewSchema, quovibeSettingsSchema, DEFAULT_SETTINGS } from './settings.schema';

describe('calculationViewSchema', () => {
  it('defaults to premium layout and comfortable density', () => {
    const parsed = calculationViewSchema.parse({});
    expect(parsed).toEqual({ layout: 'premium', tableDensity: 'comfortable' });
  });

  it('accepts classic layout', () => {
    const parsed = calculationViewSchema.parse({ layout: 'classic' });
    expect(parsed.layout).toBe('classic');
    expect(parsed.tableDensity).toBe('comfortable');
  });

  it('accepts dense tableDensity', () => {
    const parsed = calculationViewSchema.parse({ tableDensity: 'dense' });
    expect(parsed.tableDensity).toBe('dense');
    expect(parsed.layout).toBe('premium');
  });

  it('rejects unknown layout values', () => {
    expect(() => calculationViewSchema.parse({ layout: 'rainbow' })).toThrow();
  });

  it('rejects unknown tableDensity values', () => {
    expect(() => calculationViewSchema.parse({ tableDensity: 'cramped' })).toThrow();
  });

  it('is wired into quovibeSettingsSchema and DEFAULT_SETTINGS', () => {
    expect(DEFAULT_SETTINGS.calculationView).toEqual({
      layout: 'premium',
      tableDensity: 'comfortable',
    });
    expect(quovibeSettingsSchema.shape.calculationView).toBeDefined();
  });
});
