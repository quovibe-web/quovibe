import type { CalendarDefinition } from '../types';
import { fixed, fixedObserved, nthWeekdayOfMonth, lastWeekdayOfMonth, easterOffset } from '../rules';

export const euronextCalendar: CalendarDefinition = {
  id: 'euronext',
  label: 'Euronext',
  weekendDays: [0, 6],
  holidays: [
    { name: "New Year's Day", rule: fixed(1, 1) },
    { name: 'Good Friday', rule: easterOffset(-2) },
    { name: 'Easter Monday', rule: easterOffset(1) },
    { name: 'Labour Day', rule: fixed(5, 1) },
    { name: 'Christmas Eve', rule: fixed(12, 24) },
    { name: 'Christmas Day', rule: fixed(12, 25) },
    { name: "St. Stephen's Day", rule: fixed(12, 26) },
  ],
};

export const deCalendar: CalendarDefinition = {
  id: 'de',
  label: 'Xetra (Frankfurt)',
  weekendDays: [0, 6],
  holidays: [
    { name: "New Year's Day", rule: fixed(1, 1) },
    { name: 'Good Friday', rule: easterOffset(-2) },
    { name: 'Easter Monday', rule: easterOffset(1) },
    { name: 'Labour Day', rule: fixed(5, 1) },
    { name: 'German Unity Day', rule: fixed(10, 3) },
    { name: 'Christmas Eve', rule: fixed(12, 24) },
    { name: 'Christmas Day', rule: fixed(12, 25) },
    { name: 'Boxing Day', rule: fixed(12, 26) },
    { name: "New Year's Eve", rule: fixed(12, 31) },
  ],
};

export const iseCalendar: CalendarDefinition = {
  id: 'ise',
  label: 'Borsa Italiana (Milan)',
  weekendDays: [0, 6],
  holidays: [
    { name: "New Year's Day", rule: fixed(1, 1) },
    { name: 'Good Friday', rule: easterOffset(-2) },
    { name: 'Easter Monday', rule: easterOffset(1) },
    { name: 'Labour Day', rule: fixed(5, 1) },
    { name: 'Assumption of Mary', rule: fixed(8, 15) },
    { name: 'Christmas Eve', rule: fixed(12, 24) },
    { name: 'Christmas Day', rule: fixed(12, 25) },
    { name: "St. Stephen's Day", rule: fixed(12, 26) },
    { name: "New Year's Eve", rule: fixed(12, 31) },
  ],
};

export const lseCalendar: CalendarDefinition = {
  id: 'lse',
  label: 'LSE (London)',
  weekendDays: [0, 6],
  holidays: [
    { name: "New Year's Day", rule: fixedObserved(1, 1) },
    { name: 'Good Friday', rule: easterOffset(-2) },
    { name: 'Easter Monday', rule: easterOffset(1) },
    { name: 'Early May Bank Holiday', rule: nthWeekdayOfMonth(1, 1, 5) },
    { name: 'Spring Bank Holiday', rule: lastWeekdayOfMonth(1, 5) },
    { name: 'Summer Bank Holiday', rule: lastWeekdayOfMonth(1, 8) },
    { name: 'Christmas Day', rule: fixedObserved(12, 25) },
    { name: 'Boxing Day', rule: fixedObserved(12, 26) },
    // Special one-time closures
    { name: "Queen's Golden Jubilee (Day 1)", rule: fixed(6, 3).onlyIn(2002) },
    { name: "Queen's Golden Jubilee (Day 2)", rule: fixed(6, 4).onlyIn(2002) },
    { name: "Queen's Diamond Jubilee (Day 1)", rule: fixed(6, 4).onlyIn(2012) },
    { name: "Queen's Diamond Jubilee (Day 2)", rule: fixed(6, 5).onlyIn(2012) },
    { name: "Queen's Platinum Jubilee (Day 1)", rule: fixed(6, 2).onlyIn(2022) },
    { name: "Queen's Platinum Jubilee (Day 2)", rule: fixed(6, 3).onlyIn(2022) },
    { name: "Queen's Funeral", rule: fixed(9, 19).onlyIn(2022) },
    { name: 'King Charles III Coronation', rule: fixed(5, 8).onlyIn(2023) },
  ],
};

export const sixCalendar: CalendarDefinition = {
  id: 'six',
  label: 'SIX (Swiss Exchange)',
  weekendDays: [0, 6],
  holidays: [
    { name: "New Year's Day", rule: fixed(1, 1) },
    { name: 'Berchtoldstag', rule: fixed(1, 2) },
    { name: 'Good Friday', rule: easterOffset(-2) },
    { name: 'Easter Monday', rule: easterOffset(1) },
    { name: 'Labour Day', rule: fixed(5, 1) },
    { name: 'Ascension', rule: easterOffset(39) },
    { name: 'Whit Monday', rule: easterOffset(50) },
    { name: 'Swiss National Day', rule: fixed(8, 1) },
    { name: 'Christmas Eve', rule: fixed(12, 24) },
    { name: 'Christmas Day', rule: fixed(12, 25) },
    { name: 'Boxing Day', rule: fixed(12, 26) },
    { name: "New Year's Eve", rule: fixed(12, 31) },
  ],
};

export const vseCalendar: CalendarDefinition = {
  id: 'vse',
  label: 'Wiener Börse (Vienna)',
  weekendDays: [0, 6],
  holidays: [
    { name: "New Year's Day", rule: fixed(1, 1) },
    { name: 'Good Friday', rule: easterOffset(-2) },
    { name: 'Easter Monday', rule: easterOffset(1) },
    { name: 'Labour Day', rule: fixed(5, 1) },
    { name: 'Ascension', rule: easterOffset(39) },
    { name: 'Whit Monday', rule: easterOffset(50) },
    { name: 'National Day', rule: fixed(10, 26) },
    { name: "All Saints' Day", rule: fixed(11, 1) },
    { name: 'Christmas Eve', rule: fixed(12, 24) },
    { name: 'Christmas Day', rule: fixed(12, 25) },
    { name: 'Boxing Day', rule: fixed(12, 26) },
    { name: "New Year's Eve", rule: fixed(12, 31) },
  ],
};

export const micexRtsCalendar: CalendarDefinition = {
  id: 'micex-rts',
  label: 'MOEX (Moscow)',
  weekendDays: [0, 6],
  holidays: [
    { name: "New Year's Day", rule: fixed(1, 1) },
    { name: 'New Year Holiday (Jan 2)', rule: fixed(1, 2) },
    { name: 'New Year Holiday (Jan 3)', rule: fixed(1, 3) },
    { name: 'New Year Holiday (Jan 5)', rule: fixed(1, 5) },
    { name: 'New Year Holiday (Jan 6)', rule: fixed(1, 6) },
    { name: 'Orthodox Christmas', rule: fixed(1, 7) },
    { name: 'New Year Holiday (Jan 8)', rule: fixed(1, 8) },
    { name: 'Defender of the Fatherland Day', rule: fixed(2, 23) },
    { name: "International Women's Day", rule: fixed(3, 8) },
    { name: 'Spring & Labour Day', rule: fixed(5, 1) },
    { name: 'Victory Day', rule: fixed(5, 9) },
    { name: 'Russia Day', rule: fixed(6, 12) },
    { name: 'National Unity Day', rule: fixed(11, 4) },
  ],
};

export const target2Calendar: CalendarDefinition = {
  id: 'target2',
  label: 'TARGET2 (Eurozone)',
  weekendDays: [0, 6],
  holidays: [
    { name: "New Year's Day", rule: fixed(1, 1) },
    { name: 'Good Friday', rule: easterOffset(-2) },
    { name: 'Easter Monday', rule: easterOffset(1) },
    { name: 'Labour Day', rule: fixed(5, 1) },
    { name: 'Christmas Day', rule: fixed(12, 25) },
    { name: 'Boxing Day', rule: fixed(12, 26) },
  ],
};
