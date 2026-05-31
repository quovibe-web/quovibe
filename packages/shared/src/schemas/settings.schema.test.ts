import { describe, it, expect } from 'vitest';
import { calculationViewSchema, forexViewSchema, quovibeSettingsSchema, DEFAULT_SETTINGS, fiscalYearSchema, preferencesSchema } from './settings.schema';

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

describe('forexViewSchema (Phase 3 Task 19)', () => {
  it('defaults: 4 surfaces base, securityDetail native', () => {
    const parsed = forexViewSchema.parse({});
    expect(parsed.dashboard).toBe('base');
    expect(parsed.investments).toBe('base');
    expect(parsed.securityDrawer).toBe('base');
    expect(parsed.securityDetail).toBe('native');
    expect(parsed.statement).toBe('base');
  });

  it('accepts partial override (per-surface)', () => {
    const parsed = forexViewSchema.parse({ securityDetail: 'base', dashboard: 'native' });
    expect(parsed.securityDetail).toBe('base');
    expect(parsed.dashboard).toBe('native');
    expect(parsed.investments).toBe('base');
  });

  it('rejects invalid view value', () => {
    expect(() => forexViewSchema.parse({ dashboard: 'banana' })).toThrow();
  });

  it('is wired into preferencesSchema (via DEFAULT_SETTINGS)', () => {
    expect(DEFAULT_SETTINGS.preferences.forexView.securityDetail).toBe('native');
    expect(DEFAULT_SETTINGS.preferences.forexView.dashboard).toBe('base');
  });
});

describe('fiscalYearSchema', () => {
  it('defaults to disabled Jan-1 endYear', () => {
    expect(fiscalYearSchema.parse(undefined)).toEqual({
      enabled: false,
      startMonth: 1,
      startDay: 1,
      numbering: 'endYear',
    });
  });

  it('preferences without fiscalYear parse to the default block', () => {
    const prefs = preferencesSchema.parse({ language: 'en' });
    expect(prefs.fiscalYear).toEqual({
      enabled: false,
      startMonth: 1,
      startDay: 1,
      numbering: 'endYear',
    });
  });

  it('DEFAULT_SETTINGS carries the fiscalYear default', () => {
    expect(DEFAULT_SETTINGS.preferences.fiscalYear.enabled).toBe(false);
  });

  it('rejects out-of-range month', () => {
    expect(() => fiscalYearSchema.parse({ startMonth: 13 })).toThrow();
  });

  it('rejects out-of-range day', () => {
    expect(() => fiscalYearSchema.parse({ startDay: 0 })).toThrow();
    expect(() => fiscalYearSchema.parse({ startDay: 32 })).toThrow();
  });

  it('rejects invalid numbering value', () => {
    expect(() => fiscalYearSchema.parse({ numbering: 'calendarYear' })).toThrow();
  });
});
