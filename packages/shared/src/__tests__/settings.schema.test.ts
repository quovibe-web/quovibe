import { describe, it, expect } from 'vitest';
import {
  quovibeSettingsSchema,
  DEFAULT_SETTINGS,
  reportingPeriodDefSchema,
  tableIdSchema,
  allocationViewSchema,
} from '../schemas/settings.schema';

describe('quovibeSettingsSchema', () => {
  it('produces complete defaults from empty input', () => {
    const result = quovibeSettingsSchema.parse({});
    expect(result.version).toBe(1);
    expect(result.app.lastImport).toBeNull();
    expect(result.app.appVersion).toBeNull();
    expect(result.preferences.language).toBe('en');
    expect(result.preferences.theme).toBe('system');
    expect(result.preferences.sharesPrecision).toBe(1);
    expect(result.preferences.quotesPrecision).toBe(2);
    expect(result.preferences.showCurrencyCode).toBe(false);
    expect(result.preferences.showPaSuffix).toBe(true);
    expect(result.preferences.privacyMode).toBe(false);
    expect(result.reportingPeriods).toEqual([]);
  });

  it('DEFAULT_SETTINGS matches schema parse of empty input', () => {
    const parsed = quovibeSettingsSchema.parse({});
    expect(DEFAULT_SETTINGS).toEqual(parsed);
  });

  it('preserves provided values over defaults', () => {
    const result = quovibeSettingsSchema.parse({
      preferences: { language: 'it', theme: 'dark' },
    });
    expect(result.preferences.language).toBe('it');
    expect(result.preferences.theme).toBe('dark');
    expect(result.preferences.sharesPrecision).toBe(1);
  });

  it('rejects invalid theme value', () => {
    expect(() =>
      quovibeSettingsSchema.parse({ preferences: { theme: 'blue' } })
    ).toThrow();
  });

  it('rejects sharesPrecision outside 1-8', () => {
    expect(() =>
      quovibeSettingsSchema.parse({ preferences: { sharesPrecision: 0 } })
    ).toThrow();
    expect(() =>
      quovibeSettingsSchema.parse({ preferences: { sharesPrecision: 9 } })
    ).toThrow();
  });
});

describe('reportingPeriodDefSchema', () => {
  it('validates lastYearsMonths', () => {
    const result = reportingPeriodDefSchema.parse({
      type: 'lastYearsMonths', years: 5, months: 6,
    });
    expect(result.type).toBe('lastYearsMonths');
  });

  it('validates lastDays', () => {
    const result = reportingPeriodDefSchema.parse({
      type: 'lastDays', days: 365,
    });
    expect(result.type).toBe('lastDays');
  });

  it('validates lastTradingDays with optional calendarId', () => {
    const result = reportingPeriodDefSchema.parse({
      type: 'lastTradingDays', days: 256, calendarId: 'nyse',
    });
    expect(result).toEqual({ type: 'lastTradingDays', days: 256, calendarId: 'nyse' });
  });

  it('validates fromTo', () => {
    const result = reportingPeriodDefSchema.parse({
      type: 'fromTo', from: '2020-09-01', to: '2026-03-19',
    });
    expect(result.type).toBe('fromTo');
  });

  it('validates since', () => {
    const result = reportingPeriodDefSchema.parse({
      type: 'since', date: '2020-09-01',
    });
    expect(result.type).toBe('since');
  });

  it('validates year', () => {
    const result = reportingPeriodDefSchema.parse({
      type: 'year', year: 2025,
    });
    expect(result.type).toBe('year');
  });

  it('validates current period types', () => {
    for (const type of ['currentWeek', 'currentMonth', 'currentQuarter', 'currentYTD']) {
      const result = reportingPeriodDefSchema.parse({ type });
      expect(result.type).toBe(type);
    }
  });

  it('validates previous period types', () => {
    for (const type of ['previousDay', 'previousTradingDay', 'previousWeek', 'previousMonth', 'previousQuarter', 'previousYear']) {
      const result = reportingPeriodDefSchema.parse({ type });
      expect(result.type).toBe(type);
    }
  });

  it('rejects unknown type', () => {
    expect(() =>
      reportingPeriodDefSchema.parse({ type: 'invalid' })
    ).toThrow();
  });
});

describe('tableLayouts schema', () => {
  it('defaults to empty object when tableLayouts is absent', () => {
    const result = quovibeSettingsSchema.parse({});
    expect(result.tableLayouts).toEqual({});
  });

  it('parses a valid tableLayouts entry with all fields', () => {
    const result = quovibeSettingsSchema.parse({
      tableLayouts: {
        transactions: {
          columnOrder: ['date', 'type', 'amount'],
          columnSizing: { date: 120, type: 80 },
          sorting: [{ id: 'date', desc: true }],
          columnVisibility: { amount: false, shares: true },
          version: 1,
        },
      },
    });
    const entry = result.tableLayouts['transactions'];
    expect(entry.columnOrder).toEqual(['date', 'type', 'amount']);
    expect(entry.columnSizing['date']).toBe(120);
    expect(entry.sorting).toEqual([{ id: 'date', desc: true }]);
    expect(entry.columnVisibility).toEqual({ amount: false, shares: true });
    expect(entry.version).toBe(1);
  });

  it('parses legacy entry without sorting/visibility (backward compat)', () => {
    const result = quovibeSettingsSchema.parse({
      tableLayouts: {
        transactions: {
          columnOrder: ['date', 'type', 'amount'],
          columnSizing: { date: 120, type: 80 },
        },
      },
    });
    const entry = result.tableLayouts['transactions'];
    expect(entry.columnOrder).toEqual(['date', 'type', 'amount']);
    expect(entry.columnSizing['date']).toBe(120);
    expect(entry.sorting).toBeNull();
    expect(entry.columnVisibility).toBeNull();
    expect(entry.version).toBe(1);
  });

  it('defaults columnOrder to [] and columnSizing to {} if absent', () => {
    const result = quovibeSettingsSchema.parse({
      tableLayouts: { transactions: {} },
    });
    expect(result.tableLayouts['transactions'].columnOrder).toEqual([]);
    expect(result.tableLayouts['transactions'].columnSizing).toEqual({});
    expect(result.tableLayouts['transactions'].sorting).toBeNull();
    expect(result.tableLayouts['transactions'].columnVisibility).toBeNull();
  });

  it('DEFAULT_SETTINGS still matches parse of empty input after tableLayouts added', () => {
    const parsed = quovibeSettingsSchema.parse({});
    expect(DEFAULT_SETTINGS).toEqual(parsed);
  });
});

describe('tableIdSchema', () => {
  it.each([
    'investments',
    'transactions',
    'security-detail',
    'account-transactions',
    'cash-transactions',
    'abc',
  ])('accepts valid tableId: %s', (id) => {
    expect(tableIdSchema.parse(id)).toBe(id);
  });

  it.each([
    '',
    'ab',           // too short (min 3 chars)
    'Ab',           // uppercase
    '1abc',         // starts with digit
    'a'.repeat(32), // too long (max 31 chars)
    'a b',          // space
    'a_b',          // underscore
    'a.b',          // dot
  ])('rejects invalid tableId: %s', (id) => {
    expect(() => tableIdSchema.parse(id)).toThrow();
  });
});

describe('allocationViewSchema', () => {
  it('applies default chartMode=pie when parsed from empty object', () => {
    const parsed = allocationViewSchema.parse({});
    expect(parsed.chartMode).toBe('pie');
  });

  it('accepts the three known chartMode values', () => {
    for (const v of ['pie', 'treemap', 'off'] as const) {
      expect(allocationViewSchema.parse({ chartMode: v }).chartMode).toBe(v);
    }
  });

  it('rejects an unknown chartMode value', () => {
    const res = allocationViewSchema.safeParse({ chartMode: 'donut' });
    expect(res.success).toBe(false);
  });

  it('is included in the top-level quovibeSettingsSchema with a default', () => {
    const parsed = quovibeSettingsSchema.parse({});
    expect(parsed.allocationView).toEqual({ chartMode: 'pie' });
  });
});
