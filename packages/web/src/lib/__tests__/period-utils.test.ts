import { describe, it, expect } from 'vitest';
import { getPeriodId, DEFAULT_PERIODS, ALL_PERIOD_ID, formatPeriodLabel, formatPeriodShortLabel, buildFiscalPreview } from '../period-utils';
import { resolveReportingPeriod } from '@quovibe/shared';
import type { ReportingPeriodDef, FiscalYearConfig } from '@quovibe/shared';

describe('getPeriodId', () => {
  it('returns "1Y" for lastYearsMonths with 1 year, 0 months', () => {
    expect(getPeriodId({ type: 'lastYearsMonths', years: 1, months: 0 })).toBe('1Y');
  });

  it('returns "3Y" for lastYearsMonths with 3 years, 0 months', () => {
    expect(getPeriodId({ type: 'lastYearsMonths', years: 3, months: 0 })).toBe('3Y');
  });

  it('returns "6M" for lastYearsMonths with 0 years, 6 months', () => {
    expect(getPeriodId({ type: 'lastYearsMonths', years: 0, months: 6 })).toBe('6M');
  });

  it('returns "2Y3M" for lastYearsMonths with 2 years, 3 months', () => {
    expect(getPeriodId({ type: 'lastYearsMonths', years: 2, months: 3 })).toBe('2Y3M');
  });

  it('returns "YTD" for currentYTD', () => {
    expect(getPeriodId({ type: 'currentYTD' })).toBe('YTD');
  });

  it('returns deterministic IDs for all DEFAULT_PERIODS', () => {
    const ids = DEFAULT_PERIODS.map(getPeriodId);
    expect(ids).toEqual(['1Y', '3Y', 'YTD']);
  });

  it('returns stable IDs for fromTo periods', () => {
    const def: ReportingPeriodDef = { type: 'fromTo', from: '2024-01-01', to: '2024-12-31' };
    expect(getPeriodId(def)).toBe('fromTo:2024-01-01:2024-12-31');
  });

  it('returns stable IDs for since periods', () => {
    const def: ReportingPeriodDef = { type: 'since', date: '2020-06-15' };
    expect(getPeriodId(def)).toBe('since:2020-06-15');
  });

  it('returns stable IDs for year periods', () => {
    const def: ReportingPeriodDef = { type: 'year', year: 2025 };
    expect(getPeriodId(def)).toBe('year:2025');
  });
});

describe('ALL_PERIOD_ID', () => {
  it('is "ALL"', () => {
    expect(ALL_PERIOD_ID).toBe('ALL');
  });
});

describe('period active matching', () => {
  const today = '2026-03-20';

  it('resolved default period matches itself when compared by dates', () => {
    for (const def of DEFAULT_PERIODS) {
      const resolved1 = resolveReportingPeriod(def, today);
      const resolved2 = resolveReportingPeriod(def, today);
      expect(resolved1.periodStart).toBe(resolved2.periodStart);
      expect(resolved1.periodEnd).toBe(resolved2.periodEnd);
    }
  });

  it('different periods do not produce identical resolved dates', () => {
    const resolved = DEFAULT_PERIODS.map((def) => resolveReportingPeriod(def, today));
    const keys = resolved.map((r) => `${r.periodStart}|${r.periodEnd}`);
    const unique = new Set(keys);
    expect(unique.size).toBe(DEFAULT_PERIODS.length);
  });

  it('mismatched dates produce no active match', () => {
    const fakeStart = '2000-01-01';
    const fakeEnd = '2000-12-31';
    for (const def of DEFAULT_PERIODS) {
      const resolved = resolveReportingPeriod(def, today);
      const isActive =
        fakeStart === resolved.periodStart && fakeEnd === resolved.periodEnd;
      expect(isActive).toBe(false);
    }
  });
});

// Identity translator: returns the key + interpolated year so assertions are deterministic.
const tId = ((key: string, opts?: Record<string, unknown>) =>
  opts && 'year' in opts ? `${key}:${opts.year}` : key) as unknown as Parameters<typeof formatPeriodLabel>[1];

const FY_JULY_END: FiscalYearConfig = { enabled: true, startMonth: 7, startDay: 1, numbering: 'endYear' };
const FY_OFF: FiscalYearConfig = { enabled: false, startMonth: 1, startDay: 1, numbering: 'endYear' };

describe('period-utils fiscal labels', () => {
  it('year label is FY key when fiscal active', () => {
    expect(formatPeriodLabel({ type: 'year', year: 2026 }, tId, FY_JULY_END)).toBe('periods.labels.fiscalYear:2026');
  });
  it('year label is plain number when fiscal off', () => {
    expect(formatPeriodLabel({ type: 'year', year: 2026 }, tId, FY_OFF)).toBe('2026');
  });
  it('currentYTD label switches to fiscal key', () => {
    expect(formatPeriodLabel({ type: 'currentYTD' }, tId, FY_JULY_END)).toBe('periods.labels.fiscalYTD');
    expect(formatPeriodLabel({ type: 'currentYTD' }, tId, FY_OFF)).toBe('periods.labels.currentYTD');
  });
  it('previousYear label switches to fiscal key', () => {
    expect(formatPeriodLabel({ type: 'previousYear' }, tId, FY_JULY_END)).toBe('periods.labels.previousFiscalYear');
  });
});

describe('period-utils id stability (fiscal must not change ids)', () => {
  it('getPeriodId is unaffected by fiscal config', () => {
    expect(getPeriodId({ type: 'year', year: 2026 })).toBe('year:2026');
    expect(getPeriodId({ type: 'currentYTD' })).toBe('YTD');
    expect(getPeriodId({ type: 'previousYear' })).toBe('previousYear');
  });
});

describe('buildFiscalPreview', () => {
  it('July-end FY at 2026-03-19 → FY2026 spanning 2025-06-30..2026-06-30', () => {
    expect(buildFiscalPreview(FY_JULY_END, '2026-03-19')).toEqual({
      fyLabel: 2026,
      periodStart: '2025-06-30',
      periodEnd: '2026-06-30',
    });
  });
});
