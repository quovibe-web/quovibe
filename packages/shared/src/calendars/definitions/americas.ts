import type { CalendarDefinition } from '../types';
import { fixed, fixedObserved, nthWeekdayOfMonth, lastWeekdayOfMonth, easterOffset } from '../rules';

export const nyseCalendar: CalendarDefinition = {
  id: 'nyse',
  label: 'NYSE',
  weekendDays: [0, 6],
  holidays: [
    { name: "New Year's Day", rule: fixedObserved(1, 1) },
    { name: 'Martin Luther King Jr. Day', rule: nthWeekdayOfMonth(3, 1, 1).validFrom(1998) },
    { name: "Presidents' Day", rule: nthWeekdayOfMonth(3, 1, 2) },
    { name: 'Good Friday', rule: easterOffset(-2) },
    { name: 'Memorial Day', rule: lastWeekdayOfMonth(1, 5) },
    { name: 'Juneteenth', rule: fixedObserved(6, 19).validFrom(2022) },
    { name: 'Independence Day', rule: fixedObserved(7, 4) },
    { name: 'Labor Day', rule: nthWeekdayOfMonth(1, 1, 9) },
    { name: 'Thanksgiving', rule: nthWeekdayOfMonth(4, 4, 11) },
    { name: 'Christmas Day', rule: fixedObserved(12, 25) },
    // Special one-time closures
    { name: '9/11 Closure (Day 1)', rule: fixed(9, 11).onlyIn(2001) },
    { name: '9/11 Closure (Day 2)', rule: fixed(9, 12).onlyIn(2001) },
    { name: '9/11 Closure (Day 3)', rule: fixed(9, 13).onlyIn(2001) },
    { name: '9/11 Closure (Day 4)', rule: fixed(9, 14).onlyIn(2001) },
    { name: 'Hurricane Sandy Closure (Day 1)', rule: fixed(10, 29).onlyIn(2012) },
    { name: 'Hurricane Sandy Closure (Day 2)', rule: fixed(10, 30).onlyIn(2012) },
    { name: 'President Ford Funeral', rule: fixed(1, 2).onlyIn(2007) },
    { name: 'President Reagan Funeral', rule: fixed(6, 11).onlyIn(2004) },
    { name: 'President Bush Funeral', rule: fixed(12, 5).onlyIn(2018) },
  ],
};

export const ibovCalendar: CalendarDefinition = {
  id: 'ibov',
  label: 'B3 (São Paulo)',
  weekendDays: [0, 6],
  holidays: [
    { name: "New Year's Day", rule: fixed(1, 1) },
    { name: 'Carnival Monday', rule: easterOffset(-48) },
    { name: 'Carnival Tuesday (Mardi Gras)', rule: easterOffset(-47) },
    { name: 'Good Friday', rule: easterOffset(-2) },
    { name: 'Corpus Christi', rule: easterOffset(60) },
    { name: 'Tiradentes', rule: fixed(4, 21) },
    { name: 'Labour Day', rule: fixed(5, 1) },
    { name: 'Independence Day', rule: fixed(9, 7) },
    { name: 'Our Lady of Aparecida', rule: fixed(10, 12) },
    { name: "All Souls' Day", rule: fixed(11, 2) },
    { name: 'Republic Proclamation Day', rule: fixed(11, 15) },
    { name: 'Black Consciousness Day', rule: fixed(11, 20).validFrom(2024) },
    { name: 'Christmas Eve', rule: fixed(12, 24) },
    { name: 'Christmas Day', rule: fixed(12, 25) },
    { name: "New Year's Eve", rule: fixed(12, 31) },
  ],
};

export const tsxCalendar: CalendarDefinition = {
  id: 'tsx',
  label: 'TSX (Toronto)',
  weekendDays: [0, 6],
  holidays: [
    { name: "New Year's Day", rule: fixedObserved(1, 1) },
    { name: 'Family Day', rule: nthWeekdayOfMonth(3, 1, 2).validFrom(2008) },
    { name: 'Good Friday', rule: easterOffset(-2) },
    {
      name: 'Victoria Day',
      rule: (year: number) => {
        // Last Monday on or before May 24
        const may24 = new Date(year, 4, 24);
        const d = may24.getDay(); // 0=Sun, 1=Mon, ...
        const offset = d === 1 ? 0 : d === 0 ? -6 : 1 - d;
        const result = new Date(year, 4, 24 + offset);
        return `${year}-${String(result.getMonth() + 1).padStart(2, '0')}-${String(result.getDate()).padStart(2, '0')}`;
      },
    },
    { name: 'Canada Day', rule: fixedObserved(7, 1) },
    { name: 'Civic Holiday', rule: nthWeekdayOfMonth(1, 1, 8) },
    { name: 'Labour Day', rule: nthWeekdayOfMonth(1, 1, 9) },
    { name: 'Thanksgiving', rule: nthWeekdayOfMonth(2, 1, 10) },
    { name: 'Christmas Day', rule: fixedObserved(12, 25) },
    { name: 'Boxing Day', rule: fixedObserved(12, 26) },
  ],
};

export const sseCalendar: CalendarDefinition = {
  id: 'sse',
  label: 'SSE (Santiago)',
  weekendDays: [0, 6],
  holidays: [
    { name: "New Year's Day", rule: fixed(1, 1) },
    { name: 'Good Friday', rule: easterOffset(-2) },
    { name: 'Holy Saturday', rule: easterOffset(-1) },
    { name: 'Labour Day', rule: fixed(5, 1) },
    { name: 'Navy Day', rule: fixed(5, 21) },
    { name: 'St. Peter & Paul Day', rule: fixed(6, 29) },
    { name: 'Our Lady of Mount Carmel', rule: fixed(7, 16) },
    { name: 'Assumption of Mary', rule: fixed(8, 15) },
    { name: 'National Day (Dieciocho)', rule: fixed(9, 18) },
    { name: 'Army Day', rule: fixed(9, 19) },
    { name: 'Columbus Day', rule: fixed(10, 12) },
    { name: 'Evangelical Day', rule: fixed(10, 31) },
    { name: "All Saints' Day", rule: fixed(11, 1) },
    { name: 'Immaculate Conception', rule: fixed(12, 8) },
    { name: 'Christmas Day', rule: fixed(12, 25) },
  ],
};
