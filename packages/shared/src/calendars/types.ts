export interface HolidayRule {
  name: string;
  rule: (year: number) => string | null; // 'YYYY-MM-DD' or null
}

export interface CalendarDefinition {
  id: string;           // e.g. 'nyse', 'de', 'default', 'empty'
  label: string;        // display label
  weekendDays: number[]; // [0,6] = Sun,Sat; [] = no weekends (as in 'empty')
  holidays: HolidayRule[];
  customTradingDayCheck?: (dateStr: string) => boolean; // for 'first-of-month'
}

export interface CalendarInfo {
  id: string;
  label: string;
}

export interface HolidayEntry {
  date: string;  // 'YYYY-MM-DD'
  name: string;
}
