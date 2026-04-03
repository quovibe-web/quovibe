import type { CalendarDefinition } from '../types';
import { fixedObserved, fixed, nthWeekdayOfMonth, easterOffset } from '../rules';

export const asxCalendar: CalendarDefinition = {
  id: 'asx',
  label: 'ASX (Sydney)',
  weekendDays: [0, 6],
  holidays: [
    { name: "New Year's Day", rule: fixedObserved(1, 1) },
    { name: 'Australia Day', rule: fixedObserved(1, 26) },
    { name: 'Good Friday', rule: easterOffset(-2) },
    { name: 'Easter Saturday', rule: easterOffset(-1) },
    { name: 'Easter Monday', rule: easterOffset(1) },
    { name: 'Anzac Day', rule: fixed(4, 25) },
    { name: "Queen's/King's Birthday", rule: nthWeekdayOfMonth(2, 1, 6) },
    { name: 'Bank Holiday', rule: nthWeekdayOfMonth(1, 1, 8) },
    { name: 'Labour Day', rule: nthWeekdayOfMonth(1, 1, 10) },
    { name: 'Christmas Day', rule: fixedObserved(12, 25) },
    { name: 'Boxing Day', rule: fixedObserved(12, 26) },
  ],
};
