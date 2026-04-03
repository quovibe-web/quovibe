import { easterSunday } from './easter';

// Helper to format date as YYYY-MM-DD
function fmt(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// Helper to get day-of-week for a YYYY-MM-DD string (0=Sun, 6=Sat)
function dow(dateStr: string): number {
  return new Date(dateStr + 'T12:00:00').getDay();
}

// Helper to shift a YYYY-MM-DD string by N days
function shiftDate(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + days);
  return fmt(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

// Rule interface with chainable modifiers
export interface RuleFn {
  (year: number): string | null;
  moveIf(dayOfWeek: number, shiftDays: number): RuleFn;
  validFrom(year: number): RuleFn;
  validTo(year: number): RuleFn;
  onlyIn(...years: number[]): RuleFn;
  exceptIn(...years: number[]): RuleFn;
}

function wrapRule(fn: (year: number) => string | null): RuleFn {
  const wrapped = fn as RuleFn;

  wrapped.moveIf = (dayOfWeek: number, shiftDays: number): RuleFn =>
    wrapRule((year: number) => {
      const date = fn(year);
      if (date === null) return null;
      if (dow(date) === dayOfWeek) return shiftDate(date, shiftDays);
      return date;
    });

  wrapped.validFrom = (fromYear: number): RuleFn =>
    wrapRule((year: number) => {
      if (year < fromYear) return null;
      return fn(year);
    });

  wrapped.validTo = (toYear: number): RuleFn =>
    wrapRule((year: number) => {
      if (year > toYear) return null;
      return fn(year);
    });

  wrapped.onlyIn = (...years: number[]): RuleFn =>
    wrapRule((year: number) => {
      if (!years.includes(year)) return null;
      return fn(year);
    });

  wrapped.exceptIn = (...years: number[]): RuleFn =>
    wrapRule((year: number) => {
      if (years.includes(year)) return null;
      return fn(year);
    });

  return wrapped;
}

// Returns a fixed date each year (e.g., Jan 1 = New Year's)
export function fixed(month: number, day: number): RuleFn {
  return wrapRule((year: number) => fmt(year, month, day));
}

// Returns the nth occurrence of weekday in month (n=1 is first, n=2 is second, etc.)
export function nthWeekdayOfMonth(n: number, weekday: number, month: number): RuleFn {
  return wrapRule((year: number) => {
    // Find first occurrence of weekday in the month
    const firstOfMonth = new Date(`${year}-${String(month).padStart(2, '0')}-01T12:00:00`);
    const firstDow = firstOfMonth.getDay();
    let dayOffset = weekday - firstDow;
    if (dayOffset < 0) dayOffset += 7;
    // dayOffset is now the day (0-based index) of the first occurrence
    const day = 1 + dayOffset + (n - 1) * 7;
    // Check the result is within the month
    const result = new Date(year, month - 1, day);
    if (result.getMonth() !== month - 1) return null;
    return fmt(year, month, day);
  });
}

// Returns the last occurrence of weekday in month
export function lastWeekdayOfMonth(weekday: number, month: number): RuleFn {
  return wrapRule((year: number) => {
    // Find last day of month
    const lastDay = new Date(year, month, 0); // day 0 of next month = last day of current month
    const lastDow = lastDay.getDay();
    let dayOffset = lastDow - weekday;
    if (dayOffset < 0) dayOffset += 7;
    const day = lastDay.getDate() - dayOffset;
    return fmt(year, month, day);
  });
}

// Returns Easter Sunday ± days (e.g., -2 = Good Friday, +1 = Easter Monday, -48 = Mardi Gras)
export function easterOffset(days: number): RuleFn {
  return wrapRule((year: number) => {
    const { month, day } = easterSunday(year);
    const easterStr = fmt(year, month, day);
    if (days === 0) return easterStr;
    return shiftDate(easterStr, days);
  });
}

// Shorthand for fixed(m,d).moveIf(6, -1).moveIf(0, 1) (Sat→Fri, Sun→Mon observed rule)
export function fixedObserved(month: number, day: number): RuleFn {
  return fixed(month, day).moveIf(6, -1).moveIf(0, 1);
}
