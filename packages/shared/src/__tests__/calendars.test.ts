import { describe, it, expect } from 'vitest';
import { easterSunday } from '../calendars/easter';
import {
  isTradingDay,
  isHoliday,
  getHolidaysForYear,
  filterTradingDays,
  getNextTradingDay,
} from '../calendars/calendar-utils';
import { resolveCalendarId } from '../calendars/resolve';
import { getAllCalendarInfos, getCalendarById } from '../calendars/registry';

// ---------------------------------------------------------------------------
// easterSunday
// ---------------------------------------------------------------------------
describe('easterSunday', () => {
  // Known Easter dates verified against real calendar
  it.each([
    [2020, 4, 12],
    [2021, 4, 4],
    [2022, 4, 17],
    [2023, 4, 9],
    [2024, 3, 31],
    [2025, 4, 20],
    [2026, 4, 5],
    [2027, 3, 28],
  ])('year %i → month %i, day %i', (year, month, day) => {
    const result = easterSunday(year);
    expect(result.month).toBe(month);
    expect(result.day).toBe(day);
  });
});

// ---------------------------------------------------------------------------
// resolveCalendarId
// ---------------------------------------------------------------------------
describe('resolveCalendarId', () => {
  it('returns security calendar when set', () => {
    expect(resolveCalendarId('nyse', 'default')).toBe('nyse');
  });
  it('falls back to global when security is null', () => {
    expect(resolveCalendarId(null, 'lse')).toBe('lse');
  });
  it('falls back to default when both null', () => {
    expect(resolveCalendarId(null, null)).toBe('default');
  });
  it('falls back to default when both undefined', () => {
    expect(resolveCalendarId(undefined, undefined)).toBe('default');
  });
});

// ---------------------------------------------------------------------------
// empty calendar — every day is a trading day
// ---------------------------------------------------------------------------
describe('empty calendar', () => {
  it('every day is trading', () => {
    expect(isTradingDay('empty', '2026-01-01')).toBe(true); // New Year
    expect(isTradingDay('empty', '2026-01-03')).toBe(true); // Saturday
    expect(isTradingDay('empty', '2026-01-04')).toBe(true); // Sunday
    expect(isTradingDay('empty', '2026-12-25')).toBe(true); // Christmas
  });
});

// ---------------------------------------------------------------------------
// default calendar
// ---------------------------------------------------------------------------
describe('default calendar', () => {
  it('weekends are non-trading', () => {
    expect(isTradingDay('default', '2026-01-03')).toBe(false); // Saturday
    expect(isTradingDay('default', '2026-01-04')).toBe(false); // Sunday
  });
  it('New Year is holiday', () => {
    expect(isTradingDay('default', '2026-01-01')).toBe(false);
  });
  it('Christmas Day is holiday', () => {
    expect(isTradingDay('default', '2026-12-25')).toBe(false);
  });
  it('regular weekday is trading', () => {
    expect(isTradingDay('default', '2026-03-11')).toBe(true); // Wednesday
  });
  it('Good Friday is holiday (default has Good Friday)', () => {
    // Easter 2026 = April 5, Good Friday = April 3
    expect(isTradingDay('default', '2026-04-03')).toBe(false);
  });
  it('Christmas Eve is holiday', () => {
    expect(isTradingDay('default', '2026-12-24')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// first-of-month calendar
// ---------------------------------------------------------------------------
describe('first-of-month calendar', () => {
  it('1st of month is trading', () => {
    expect(isTradingDay('first-of-month', '2026-01-01')).toBe(true);
    expect(isTradingDay('first-of-month', '2026-06-01')).toBe(true);
  });
  it('other days are non-trading', () => {
    expect(isTradingDay('first-of-month', '2026-01-02')).toBe(false);
    expect(isTradingDay('first-of-month', '2026-03-11')).toBe(false);
    expect(isTradingDay('first-of-month', '2026-12-25')).toBe(false);
  });
  it('first-of-month on a Sunday is still trading', () => {
    // 2026-03-01 is a Sunday — customTradingDayCheck overrides weekend logic
    expect(isTradingDay('first-of-month', '2026-03-01')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// NYSE calendar
// ---------------------------------------------------------------------------
describe('NYSE calendar', () => {
  it('weekends are non-trading', () => {
    expect(isTradingDay('nyse', '2026-01-03')).toBe(false); // Saturday
    expect(isTradingDay('nyse', '2026-01-04')).toBe(false); // Sunday
  });
  it('New Year 2026 is holiday (Jan 1 is Thursday)', () => {
    expect(isTradingDay('nyse', '2026-01-01')).toBe(false);
  });
  it('MLK Day 2026 is holiday (3rd Monday of January)', () => {
    // 2026: Jan 5=Mon, Jan 12=Mon, Jan 19=MLK Day
    expect(isTradingDay('nyse', '2026-01-19')).toBe(false);
  });
  it('Thanksgiving 2026 is holiday (4th Thursday of November)', () => {
    // Nov 2026: Nov 5=Thu, 12=Thu, 19=Thu, 26=Thu (4th)
    expect(isTradingDay('nyse', '2026-11-26')).toBe(false);
  });
  it('Independence Day observed: July 4 on Saturday 2026 → July 3 (Friday) is holiday', () => {
    // July 4 2026 = Saturday → observed July 3 = Friday
    expect(isTradingDay('nyse', '2026-07-03')).toBe(false);
  });
  it('regular trading day', () => {
    expect(isTradingDay('nyse', '2026-03-11')).toBe(true); // Wednesday
  });
  it('Juneteenth 2026 is holiday (validFrom 2022)', () => {
    // June 19 2026 = Friday
    expect(isTradingDay('nyse', '2026-06-19')).toBe(false);
  });
  it('Juneteenth before 2022 is NOT a holiday', () => {
    // Before validFrom(2022), Juneteenth should not be in NYSE holidays
    expect(isHoliday('nyse', '2021-06-19')).toBe(false);
  });
  it('Good Friday 2026 is holiday', () => {
    // Easter 2026 = April 5, Good Friday = April 3
    expect(isTradingDay('nyse', '2026-04-03')).toBe(false);
  });
  it('9/11 2001 was closed', () => {
    expect(isTradingDay('nyse', '2001-09-11')).toBe(false);
  });
  it('MLK Day not a holiday before 1998', () => {
    // MLK Day at NYSE has validFrom(1998)
    expect(isHoliday('nyse', '1997-01-20')).toBe(false);
  });
  it('Presidents Day 2026 is holiday (3rd Monday of February)', () => {
    // 2026: Feb 2=Mon, 9=Mon, 16=Mon (3rd)
    expect(isTradingDay('nyse', '2026-02-16')).toBe(false);
  });
  it('Memorial Day 2026 is holiday (last Monday of May)', () => {
    // May 2026: May 4=Mon, 11=Mon, 18=Mon, 25=Mon (last)
    expect(isTradingDay('nyse', '2026-05-25')).toBe(false);
  });
  it('Labor Day 2026 is holiday (1st Monday of September)', () => {
    // Sep 2026: Sep 7=Mon (1st)
    expect(isTradingDay('nyse', '2026-09-07')).toBe(false);
  });
  it('Hurricane Sandy 2012 closures', () => {
    expect(isTradingDay('nyse', '2012-10-29')).toBe(false);
    expect(isTradingDay('nyse', '2012-10-30')).toBe(false);
  });
  it('Christmas 2026 is holiday (Dec 25 is Friday)', () => {
    expect(isTradingDay('nyse', '2026-12-25')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// IBOV calendar
// ---------------------------------------------------------------------------
describe('IBOV calendar', () => {
  it('Carnival 2026 (Mardi Gras) is holiday', () => {
    // Easter 2026 = April 5
    // Shrove Monday = April 5 - 48 = Feb 16
    // Mardi Gras = April 5 - 47 = Feb 17
    expect(isTradingDay('ibov', '2026-02-17')).toBe(false);
    expect(isTradingDay('ibov', '2026-02-16')).toBe(false);
  });
  it('Labour Day is holiday', () => {
    expect(isTradingDay('ibov', '2026-05-01')).toBe(false);
  });
  it('Good Friday is holiday', () => {
    // Easter 2026 = April 5, Good Friday = April 3
    expect(isTradingDay('ibov', '2026-04-03')).toBe(false);
  });
  it('New Year is holiday', () => {
    expect(isTradingDay('ibov', '2026-01-01')).toBe(false);
  });
  it('Black Consciousness Day 2026 is holiday (validFrom 2024)', () => {
    expect(isHoliday('ibov', '2026-11-20')).toBe(true);
  });
  it('Black Consciousness Day before 2024 is NOT a holiday', () => {
    expect(isHoliday('ibov', '2023-11-20')).toBe(false);
  });
  it('regular weekday is trading', () => {
    expect(isTradingDay('ibov', '2026-03-11')).toBe(true); // Wednesday
  });
});

// ---------------------------------------------------------------------------
// DE calendar (Xetra Frankfurt)
// ---------------------------------------------------------------------------
describe('DE calendar', () => {
  it('Christmas Eve is holiday', () => {
    expect(isTradingDay('de', '2026-12-24')).toBe(false);
  });
  it('New Year Eve is holiday', () => {
    expect(isTradingDay('de', '2026-12-31')).toBe(false);
  });
  it('regular weekday is trading', () => {
    expect(isTradingDay('de', '2026-03-11')).toBe(true);
  });
  it('German Unity Day is holiday', () => {
    expect(isTradingDay('de', '2026-10-03')).toBe(false);
  });
  it('Easter Monday 2026 is holiday', () => {
    // Easter 2026 = April 5, Easter Monday = April 6
    expect(isTradingDay('de', '2026-04-06')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getHolidaysForYear
// ---------------------------------------------------------------------------
describe('getHolidaysForYear', () => {
  it('returns a sorted array of HolidayEntry objects', () => {
    const holidays = getHolidaysForYear('nyse', 2026);
    expect(Array.isArray(holidays)).toBe(true);
    expect(holidays.length).toBeGreaterThan(0);
    // Each entry has date and name
    for (const h of holidays) {
      expect(typeof h.date).toBe('string');
      expect(typeof h.name).toBe('string');
      expect(h.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    // Should be sorted by date
    for (let i = 1; i < holidays.length; i++) {
      expect(holidays[i].date >= holidays[i - 1].date).toBe(true);
    }
  });
  it('returns empty array for empty calendar', () => {
    const holidays = getHolidaysForYear('empty', 2026);
    expect(holidays).toEqual([]);
  });
  it('includes known NYSE holidays for 2026', () => {
    const holidays = getHolidaysForYear('nyse', 2026);
    const dates = holidays.map(h => h.date);
    expect(dates).toContain('2026-01-01'); // New Year
    expect(dates).toContain('2026-04-03'); // Good Friday
    expect(dates).toContain('2026-11-26'); // Thanksgiving
    expect(dates).toContain('2026-12-25'); // Christmas
  });
  it('excludes one-time closures from other years', () => {
    const holidays2026 = getHolidaysForYear('nyse', 2026);
    const dates2026 = holidays2026.map(h => h.date);
    // 9/11 only applies to 2001
    expect(dates2026).not.toContain('2026-09-11');
  });
});

// ---------------------------------------------------------------------------
// filterTradingDays
// ---------------------------------------------------------------------------
describe('filterTradingDays', () => {
  it('removes weekends and holidays', () => {
    const dates = ['2026-01-01', '2026-01-02', '2026-01-03', '2026-01-05'];
    // Jan 1 = holiday, Jan 3 = Saturday
    const result = filterTradingDays('nyse', dates);
    expect(result).toContain('2026-01-02'); // Friday - trading
    expect(result).toContain('2026-01-05'); // Monday - trading
    expect(result).not.toContain('2026-01-01'); // New Year
    expect(result).not.toContain('2026-01-03'); // Saturday
  });
  it('returns all dates for empty calendar', () => {
    const dates = ['2026-01-01', '2026-01-03', '2026-01-04'];
    expect(filterTradingDays('empty', dates)).toEqual(dates);
  });
  it('returns empty array when no trading days', () => {
    const dates = ['2026-01-03', '2026-01-04']; // Saturday + Sunday
    expect(filterTradingDays('default', dates)).toEqual([]);
  });
  it('preserves order of trading days', () => {
    const dates = ['2026-01-05', '2026-01-06', '2026-01-07'];
    const result = filterTradingDays('nyse', dates);
    expect(result).toEqual(['2026-01-05', '2026-01-06', '2026-01-07']);
  });
});

// ---------------------------------------------------------------------------
// getNextTradingDay
// ---------------------------------------------------------------------------
describe('getNextTradingDay', () => {
  it('advances from Friday to Monday', () => {
    // 2026-01-02 is Friday, next trading = 2026-01-05 Monday (Jan 3=Sat, Jan 4=Sun)
    expect(getNextTradingDay('default', '2026-01-02')).toBe('2026-01-05');
  });
  it('advances past holiday', () => {
    // Dec 31 2025 (Wed), next = Jan 2 2026 (Fri) because Jan 1 is New Year (holiday at NYSE)
    expect(getNextTradingDay('nyse', '2025-12-31')).toBe('2026-01-02');
  });
  it('advances one day when next is already trading', () => {
    // 2026-03-10 is Tuesday, next = 2026-03-11 Wednesday
    expect(getNextTradingDay('default', '2026-03-10')).toBe('2026-03-11');
  });
  it('advances past a weekend for nyse', () => {
    // 2026-01-09 is Friday, next = 2026-01-12 Monday
    expect(getNextTradingDay('nyse', '2026-01-09')).toBe('2026-01-12');
  });
});

// ---------------------------------------------------------------------------
// getAllCalendarInfos
// ---------------------------------------------------------------------------
describe('getAllCalendarInfos', () => {
  it('returns 17 calendars', () => {
    const infos = getAllCalendarInfos();
    expect(infos.length).toBe(17);
  });
  it('includes expected IDs', () => {
    const ids = getAllCalendarInfos().map(c => c.id);
    expect(ids).toContain('nyse');
    expect(ids).toContain('lse');
    expect(ids).toContain('default');
    expect(ids).toContain('empty');
    expect(ids).toContain('first-of-month');
    expect(ids).toContain('ibov');
    expect(ids).toContain('tsx');
    expect(ids).toContain('sse');
    expect(ids).toContain('euronext');
    expect(ids).toContain('de');
    expect(ids).toContain('ise');
    expect(ids).toContain('six');
    expect(ids).toContain('vse');
    expect(ids).toContain('micex-rts');
    expect(ids).toContain('target2');
    expect(ids).toContain('asx');
    expect(ids).toContain('minimum');
  });
  it('each entry has id and label as strings', () => {
    const infos = getAllCalendarInfos();
    for (const info of infos) {
      expect(typeof info.id).toBe('string');
      expect(typeof info.label).toBe('string');
      expect(info.id.length).toBeGreaterThan(0);
      expect(info.label.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// getCalendarById
// ---------------------------------------------------------------------------
describe('getCalendarById', () => {
  it('returns the calendar definition for a known ID', () => {
    const cal = getCalendarById('nyse');
    expect(cal).toBeDefined();
    expect(cal!.id).toBe('nyse');
    expect(cal!.label).toBe('NYSE');
  });
  it('returns undefined for unknown ID', () => {
    expect(getCalendarById('unknown-calendar')).toBeUndefined();
  });
  it('empty calendar has no weekendDays and no holidays', () => {
    const cal = getCalendarById('empty');
    expect(cal).toBeDefined();
    expect(cal!.weekendDays).toEqual([]);
    expect(cal!.holidays).toEqual([]);
  });
  it('default calendar has weekendDays [0, 6]', () => {
    const cal = getCalendarById('default');
    expect(cal).toBeDefined();
    expect(cal!.weekendDays).toEqual([0, 6]);
  });
  it('first-of-month calendar has customTradingDayCheck defined', () => {
    const cal = getCalendarById('first-of-month');
    expect(cal).toBeDefined();
    expect(typeof cal!.customTradingDayCheck).toBe('function');
  });
});
