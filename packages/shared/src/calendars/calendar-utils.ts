import type { HolidayEntry } from './types';
import { getCalendarById } from './registry';

// Memoization cache: 'calendarId:year' -> Map<dateStr, holidayName>
const holidayCache = new Map<string, Map<string, string>>();

function buildHolidayMap(calendarId: string, year: number): Map<string, string> {
  const cacheKey = `${calendarId}:${year}`;
  const cached = holidayCache.get(cacheKey);
  if (cached) return cached;

  const cal = getCalendarById(calendarId);
  const map = new Map<string, string>();

  if (cal) {
    for (const holiday of cal.holidays) {
      const dateStr = holiday.rule(year);
      if (dateStr !== null) {
        map.set(dateStr, holiday.name);
      }
    }
  }

  holidayCache.set(cacheKey, map);
  return map;
}

export function getHolidaysForYear(calendarId: string, year: number): HolidayEntry[] {
  const map = buildHolidayMap(calendarId, year);
  return Array.from(map.entries())
    .map(([date, name]) => ({ date, name }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function isHoliday(calendarId: string, dateStr: string): boolean {
  const year = parseInt(dateStr.slice(0, 4), 10);
  const map = buildHolidayMap(calendarId, year);
  return map.has(dateStr);
}

export function isTradingDay(calendarId: string, dateStr: string): boolean {
  const cal = getCalendarById(calendarId);
  if (!cal) return true; // unknown calendar: treat all days as trading

  // For 'empty' calendar: every day is a trading day
  if (cal.weekendDays.length === 0 && cal.holidays.length === 0 && !cal.customTradingDayCheck) {
    return true;
  }

  // customTradingDayCheck overrides everything: if provided, only those days are trading
  if (cal.customTradingDayCheck) {
    return cal.customTradingDayCheck(dateStr);
  }

  // Check weekend
  const dow = new Date(dateStr + 'T12:00:00').getDay();
  if (cal.weekendDays.includes(dow)) return false;

  // Check holiday
  if (isHoliday(calendarId, dateStr)) return false;

  return true;
}

export function filterTradingDays(calendarId: string, dates: string[]): string[] {
  return dates.filter(d => isTradingDay(calendarId, d));
}

export function getNextTradingDay(calendarId: string, dateStr: string): string {
  // Advance one day at a time until we find a trading day
  let current = dateStr;
  for (let i = 0; i < 30; i++) { // max 30 days forward to prevent infinite loop
    const d = new Date(current + 'T12:00:00');
    d.setDate(d.getDate() + 1);
    const next = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (isTradingDay(calendarId, next)) return next;
    current = next;
  }
  return current; // fallback
}
