export function resolveCalendarId(
  securityCalendar: string | null | undefined,
  globalCalendar: string | null | undefined,
): string {
  const sec = securityCalendar || null;
  const global = globalCalendar || null;
  return sec ?? global ?? 'default';
}
