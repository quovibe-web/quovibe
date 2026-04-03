import type { CalendarDefinition, CalendarInfo } from './types';
import { emptyCalendar, defaultCalendar, minimumCalendar, firstOfMonthCalendar } from './definitions/generic';
import { nyseCalendar, ibovCalendar, tsxCalendar, sseCalendar } from './definitions/americas';
import { euronextCalendar, deCalendar, iseCalendar, lseCalendar, sixCalendar, vseCalendar, micexRtsCalendar, target2Calendar } from './definitions/europe';
import { asxCalendar } from './definitions/asia-pacific';

export const CALENDAR_REGISTRY: Map<string, CalendarDefinition> = new Map([
  [emptyCalendar.id, emptyCalendar],
  [defaultCalendar.id, defaultCalendar],
  [minimumCalendar.id, minimumCalendar],
  [firstOfMonthCalendar.id, firstOfMonthCalendar],
  [nyseCalendar.id, nyseCalendar],
  [ibovCalendar.id, ibovCalendar],
  [tsxCalendar.id, tsxCalendar],
  [sseCalendar.id, sseCalendar],
  [euronextCalendar.id, euronextCalendar],
  [deCalendar.id, deCalendar],
  [iseCalendar.id, iseCalendar],
  [lseCalendar.id, lseCalendar],
  [sixCalendar.id, sixCalendar],
  [vseCalendar.id, vseCalendar],
  [micexRtsCalendar.id, micexRtsCalendar],
  [target2Calendar.id, target2Calendar],
  [asxCalendar.id, asxCalendar],
]);

export function getCalendarById(id: string): CalendarDefinition | undefined {
  return CALENDAR_REGISTRY.get(id);
}

export function getAllCalendarInfos(): CalendarInfo[] {
  return Array.from(CALENDAR_REGISTRY.values()).map(c => ({ id: c.id, label: c.label }));
}
