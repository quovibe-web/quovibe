import type { CalendarDefinition } from '../types';
import { fixed, easterOffset } from '../rules';

export const emptyCalendar: CalendarDefinition = {
  id: 'empty',
  label: '(None)',
  weekendDays: [],    // no weekends — every day is trading
  holidays: [],
};

export const defaultCalendar: CalendarDefinition = {
  id: 'default',
  label: 'Default',
  weekendDays: [0, 6],  // Sun=0, Sat=6
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

export const minimumCalendar: CalendarDefinition = {
  id: 'minimum',
  label: 'Minimum',
  weekendDays: [0, 6],
  holidays: [
    { name: "New Year's Day", rule: fixed(1, 1) },
    { name: 'Good Friday', rule: easterOffset(-2) },
    { name: 'Labour Day', rule: fixed(5, 1) },
    { name: 'Christmas Day', rule: fixed(12, 25) },
  ],
};

export const firstOfMonthCalendar: CalendarDefinition = {
  id: 'first-of-month',
  label: 'First of Month',
  weekendDays: [0, 6],
  holidays: [],
  customTradingDayCheck: (dateStr: string) => {
    return dateStr.endsWith('-01');  // only 1st of each month is a trading day
  },
};
