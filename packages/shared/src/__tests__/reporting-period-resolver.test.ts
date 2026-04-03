import { describe, it, expect } from 'vitest';
import { resolveReportingPeriod } from '../reporting-period-resolver';

// Reporting period — date range for performance calculations
// Uses an exclusive lower boundary (periodStart is excluded, engine uses '>').
// The resolver returns the excluded boundary date so the engine can apply '> periodStart'.

const TODAY = '2026-03-19'; // Thursday, pinned for deterministic tests

describe('resolveReportingPeriod — lastYearsMonths', () => {
  it('Last 1y0m → 2025-03-19 to 2026-03-19', () => {
    const result = resolveReportingPeriod({ type: 'lastYearsMonths', years: 1, months: 0 }, TODAY);
    expect(result).toEqual({ periodStart: '2025-03-19', periodEnd: '2026-03-19' });
  });

  it('Last 5y6m → 2020-09-19 to 2026-03-19', () => {
    const result = resolveReportingPeriod({ type: 'lastYearsMonths', years: 5, months: 6 }, TODAY);
    expect(result).toEqual({ periodStart: '2020-09-19', periodEnd: '2026-03-19' });
  });

  it('Last 0y3m → 2025-12-19 to 2026-03-19', () => {
    const result = resolveReportingPeriod({ type: 'lastYearsMonths', years: 0, months: 3 }, TODAY);
    expect(result).toEqual({ periodStart: '2025-12-19', periodEnd: '2026-03-19' });
  });
});

describe('resolveReportingPeriod — lastDays', () => {
  it('Last 365 days → 2025-03-19 to 2026-03-19', () => {
    const result = resolveReportingPeriod({ type: 'lastDays', days: 365 }, TODAY);
    expect(result).toEqual({ periodStart: '2025-03-19', periodEnd: '2026-03-19' });
  });

  it('Last 7 days → 2026-03-12 to 2026-03-19', () => {
    const result = resolveReportingPeriod({ type: 'lastDays', days: 7 }, TODAY);
    expect(result).toEqual({ periodStart: '2026-03-12', periodEnd: '2026-03-19' });
  });
});

describe('resolveReportingPeriod — fromTo', () => {
  it('fixed range → passthrough', () => {
    const result = resolveReportingPeriod(
      { type: 'fromTo', from: '2024-01-01', to: '2024-12-31' },
      TODAY,
    );
    expect(result).toEqual({ periodStart: '2024-01-01', periodEnd: '2024-12-31' });
  });
});

describe('resolveReportingPeriod — since', () => {
  it('since date → date to today', () => {
    const result = resolveReportingPeriod({ type: 'since', date: '2023-06-15' }, TODAY);
    expect(result).toEqual({ periodStart: '2023-06-15', periodEnd: '2026-03-19' });
  });
});

describe('resolveReportingPeriod — year (Dec31 prev year → Dec31 year)', () => {
  it('year 2025 → 2024-12-31 to 2025-12-31', () => {
    const result = resolveReportingPeriod({ type: 'year', year: 2025 }, TODAY);
    expect(result).toEqual({ periodStart: '2024-12-31', periodEnd: '2025-12-31' });
  });

  it('year 2024 (leap year) → 2023-12-31 to 2024-12-31', () => {
    const result = resolveReportingPeriod({ type: 'year', year: 2024 }, TODAY);
    expect(result).toEqual({ periodStart: '2023-12-31', periodEnd: '2024-12-31' });
  });
});

describe('resolveReportingPeriod — current periods', () => {
  it('currentYTD → 2025-12-31 to 2026-03-19', () => {
    // Jan 1 2026 starts the year; excluded boundary is Dec 31 2025
    const result = resolveReportingPeriod({ type: 'currentYTD' }, TODAY);
    expect(result).toEqual({ periodStart: '2025-12-31', periodEnd: '2026-03-19' });
  });

  it('currentMonth → 2026-02-28 to 2026-03-19', () => {
    // Mar 1 2026 starts the month; excluded boundary is Feb 28
    const result = resolveReportingPeriod({ type: 'currentMonth' }, TODAY);
    expect(result).toEqual({ periodStart: '2026-02-28', periodEnd: '2026-03-19' });
  });

  it('currentWeek (Mon-based) → 2026-03-15 to 2026-03-19', () => {
    // TODAY=Thu Mar 19 2026; week starts Mon Mar 16; excluded boundary = Sun Mar 15
    const result = resolveReportingPeriod({ type: 'currentWeek' }, TODAY);
    expect(result).toEqual({ periodStart: '2026-03-15', periodEnd: '2026-03-19' });
  });

  it('currentQuarter → 2025-12-31 to 2026-03-19', () => {
    // Q1 2026 starts Jan 1; excluded boundary = Dec 31 2025
    const result = resolveReportingPeriod({ type: 'currentQuarter' }, TODAY);
    expect(result).toEqual({ periodStart: '2025-12-31', periodEnd: '2026-03-19' });
  });
});

describe('resolveReportingPeriod — previous periods', () => {
  it('previousMonth → 2026-01-31 to 2026-02-28', () => {
    // February 2026: Feb 1 → Feb 28; excluded boundary = Jan 31
    const result = resolveReportingPeriod({ type: 'previousMonth' }, TODAY);
    expect(result).toEqual({ periodStart: '2026-01-31', periodEnd: '2026-02-28' });
  });

  it('previousYear → 2024-12-31 to 2025-12-31', () => {
    // Year 2025: Jan 1 → Dec 31; excluded boundary = Dec 31 2024
    const result = resolveReportingPeriod({ type: 'previousYear' }, TODAY);
    expect(result).toEqual({ periodStart: '2024-12-31', periodEnd: '2025-12-31' });
  });

  it('previousQuarter → 2025-09-30 to 2025-12-31', () => {
    // Q4 2025: Oct 1 → Dec 31; excluded boundary = Sep 30
    const result = resolveReportingPeriod({ type: 'previousQuarter' }, TODAY);
    expect(result).toEqual({ periodStart: '2025-09-30', periodEnd: '2025-12-31' });
  });

  it('previousWeek → 2026-03-08 to 2026-03-15', () => {
    // Previous week: Mon Mar 9 → Sun Mar 15; excluded boundary = Sun Mar 8
    const result = resolveReportingPeriod({ type: 'previousWeek' }, TODAY);
    expect(result).toEqual({ periodStart: '2026-03-08', periodEnd: '2026-03-15' });
  });

  it('previousDay → 2026-03-17 to 2026-03-18', () => {
    // Yesterday = Mar 18; excluded boundary = Mar 17
    const result = resolveReportingPeriod({ type: 'previousDay' }, TODAY);
    expect(result).toEqual({ periodStart: '2026-03-17', periodEnd: '2026-03-18' });
  });
});

describe('resolveReportingPeriod — trading day periods', () => {
  it('lastTradingDays(5, default) → 2026-03-12 to 2026-03-19', () => {
    // default calendar: weekends off. Going back from Mar 19:
    // Mar 18(W)=#1, Mar 17(T)=#2, Mar 16(M)=#3, Mar 15(Sun)=skip, Mar 14(Sat)=skip,
    // Mar 13(F)=#4, Mar 12(Th)=#5 → periodStart=Mar 12
    const result = resolveReportingPeriod(
      { type: 'lastTradingDays', days: 5 },
      TODAY,
      'default',
    );
    expect(result).toEqual({ periodStart: '2026-03-12', periodEnd: '2026-03-19' });
  });

  it('previousTradingDay (default) → 2026-03-17 to 2026-03-18', () => {
    // Mar 19 is Thursday; previous trading day = Mar 18 (Wednesday)
    // periodStart = day before Mar 18 = Mar 17
    const result = resolveReportingPeriod({ type: 'previousTradingDay' }, TODAY, 'default');
    expect(result).toEqual({ periodStart: '2026-03-17', periodEnd: '2026-03-18' });
  });
});

describe('resolveReportingPeriod — edge cases', () => {
  it('currentMonth on Mar 1 → 2026-02-28 to 2026-03-01', () => {
    const result = resolveReportingPeriod({ type: 'currentMonth' }, '2026-03-01');
    expect(result).toEqual({ periodStart: '2026-02-28', periodEnd: '2026-03-01' });
  });

  it('previousMonth in January → 2025-11-30 to 2025-12-31', () => {
    // Previous month when today=Jan 15 2026 → December 2025
    const result = resolveReportingPeriod({ type: 'previousMonth' }, '2026-01-15');
    expect(result).toEqual({ periodStart: '2025-11-30', periodEnd: '2025-12-31' });
  });

  it('currentMonth on Feb 29 2024 (leap year) → 2024-01-31 to 2024-02-29', () => {
    const result = resolveReportingPeriod({ type: 'currentMonth' }, '2024-02-29');
    expect(result).toEqual({ periodStart: '2024-01-31', periodEnd: '2024-02-29' });
  });
});
