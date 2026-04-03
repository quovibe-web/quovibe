import Decimal from 'decimal.js';
import { format, parse, parseISO } from 'date-fns';

export function toYMD(date: Date): string {
  return format(date, 'yyyy-MM-dd');
}

export function safeDecimal(value: number | string): Decimal {
  // Yahoo returns float32 values (e.g. 146.8800048828125 instead of 146.88).
  // Rounding to 4 decimal places removes the float32 noise without losing real precision.
  return new Decimal(String(value)).toDecimalPlaces(4);
}

export function parseFlexibleDate(raw: unknown, dateFormat: string | null): string | null {
  if (raw == null) return null;

  // Unix timestamp (seconds)
  if (typeof raw === 'number') {
    return toYMD(new Date(raw * 1000));
  }

  const str = String(raw);

  // Try with explicit format first
  if (dateFormat) {
    try {
      const parsed = parse(str, dateFormat, new Date());
      if (!isNaN(parsed.getTime())) return toYMD(parsed);
    } catch { /* fall through */ }
  }

  // Try ISO (parseISO treats date-only strings as local midnight, unlike new Date() which uses UTC)
  try {
    const iso = parseISO(str);
    if (!isNaN(iso.getTime())) return toYMD(iso);
  } catch { /* fall through */ }

  // Try dd.MM.yyyy
  try {
    const parsed = parse(str, 'dd.MM.yyyy', new Date());
    if (!isNaN(parsed.getTime())) return toYMD(parsed);
  } catch { /* fall through */ }

  // Try dd/MM/yyyy (European — most financial sites)
  try {
    const parsed = parse(str, 'dd/MM/yyyy', new Date());
    if (!isNaN(parsed.getTime())) return toYMD(parsed);
  } catch { /* fall through */ }

  // Try MM/dd/yyyy (US)
  try {
    const parsed = parse(str, 'MM/dd/yyyy', new Date());
    if (!isNaN(parsed.getTime())) return toYMD(parsed);
  } catch { /* fall through */ }

  return null;
}

export function inDateRange(date: string, startDate?: string, endDate?: string): boolean {
  if (startDate && date < startDate) return false;
  if (endDate && date > endDate) return false;
  return true;
}
