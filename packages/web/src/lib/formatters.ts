import { it, de, fr, es, nl, pl, pt, enUS } from 'date-fns/locale';
import type { Locale } from 'date-fns';
import i18n from '../i18n';

const DATE_LOCALES: Record<string, Locale> = { it, de, fr, es, nl, pl, pt, en: enUS };

/** Map i18next language codes to BCP 47 locale tags for Intl APIs. */
const INTL_LOCALE_MAP: Record<string, string> = {
  en: 'en-GB', it: 'it-IT', de: 'de-DE', fr: 'fr-FR',
  es: 'es-ES', nl: 'nl-NL', pl: 'pl-PL', pt: 'pt-PT',
};

export function getIntlLocale(language?: string): string {
  const lang = language ?? i18n.language;
  return INTL_LOCALE_MAP[lang] ?? INTL_LOCALE_MAP[lang.split('-')[0]] ?? 'en-GB';
}

export function getDateLocale(language?: string): Locale {
  const lang = language ?? i18n.language;
  return DATE_LOCALES[lang] ?? DATE_LOCALES[lang.split('-')[0]] ?? enUS;
}

export interface FormatCurrencyOptions {
  showCurrencyCode?: boolean;
}

export function formatCurrency(
  value: number,
  currency?: string | null,
  options?: FormatCurrencyOptions,
): string {
  const currencyCode = currency || 'EUR';
  if (options?.showCurrencyCode) {
    const formatted = new Intl.NumberFormat(i18n.language, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
    return `${formatted} ${currencyCode}`;
  }
  return new Intl.NumberFormat(i18n.language, {
    style: 'currency',
    currency: currencyCode,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatPercentage(value: number, decimals = 2): string {
  return new Intl.NumberFormat(i18n.language, {
    style: 'percent',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

// quovibe:allow-module-state — Intl.DateTimeFormat cache keyed by locale; portfolio-agnostic (ADR-016).
const dtfCache = new Map<string, Intl.DateTimeFormat>();
function getCachedDTF(locale: string, withTime: boolean): Intl.DateTimeFormat {
  const key = `${locale}|${withTime}`;
  let dtf = dtfCache.get(key);
  if (!dtf) {
    const opts: Intl.DateTimeFormatOptions = { day: '2-digit', month: '2-digit', year: 'numeric' };
    if (withTime) { opts.hour = '2-digit'; opts.minute = '2-digit'; }
    dtf = new Intl.DateTimeFormat(locale, opts);
    dtfCache.set(key, dtf);
  }
  return dtf;
}

export function formatDate(dateStr: string, lng?: string): string {
  if (!dateStr) return '—';
  const locale = getIntlLocale(lng);
  const date = new Date(dateStr.length <= 10 ? dateStr + 'T00:00:00' : dateStr);
  if (isNaN(date.getTime())) return '—';
  const withTime = dateStr.includes('T') && dateStr.length > 10;
  return getCachedDTF(locale, withTime).format(date);
}

export function parseLocalDate(dateStr: string): Date {
  return new Date(dateStr + 'T00:00:00');
}

export interface FormatSharesOptions {
  sharesPrecision?: number;
}

export function formatShares(value: number, options?: FormatSharesOptions): string {
  const precision = options?.sharesPrecision ?? 4;
  const isInteger = Number.isInteger(value);
  return new Intl.NumberFormat(i18n.language, {
    minimumFractionDigits: isInteger ? 0 : precision,
    maximumFractionDigits: precision,
  }).format(value);
}

export interface FormatQuoteOptions {
  quotesPrecision?: number;
}

export function formatQuote(value: number, options?: FormatQuoteOptions): string {
  const precision = options?.quotesPrecision ?? 2;
  return new Intl.NumberFormat(i18n.language, {
    minimumFractionDigits: precision,
    maximumFractionDigits: precision,
  }).format(value);
}

/** TTWROR annualizzato: (1 + cumulative)^(365/days) - 1 */
export function computeTtwrorPa(ttwrorCumulative: number, daysSinceStart: number): number {
  if (daysSinceStart <= 0) return 0;
  return Math.pow(1 + ttwrorCumulative, 365 / daysSinceStart) - 1;
}
