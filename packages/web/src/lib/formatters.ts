import { it, de, fr, es, nl, pl, pt, enGB } from 'date-fns/locale';
import type { Locale } from 'date-fns';
import i18n from '../i18n';

// `en` maps to en-GB so date-fns `P` ('dd/MM/yyyy') agrees with Intl's en-GB
// output in formatDate below — otherwise table cells and form inputs would
// disagree within the same UI (BUG-12).
const DATE_LOCALES: Record<string, Locale> = { it, de, fr, es, nl, pl, pt, en: enGB };

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
  return DATE_LOCALES[lang] ?? DATE_LOCALES[lang.split('-')[0]] ?? enGB;
}

// quovibe:allow-module-state — Intl.NumberFormat cache keyed by locale + serialized opts; portfolio-agnostic (ADR-016).
// Hot path: lightweight-charts Y-axis tick formatter calls formatPercentage on every visible tick per render frame.
const nfCache = new Map<string, Intl.NumberFormat>();
function getCachedNF(locale: string, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  let nf = nfCache.get(key);
  if (!nf) {
    nf = new Intl.NumberFormat(locale, options);
    nfCache.set(key, nf);
  }
  return nf;
}

export interface FormatCurrencyOptions {
  showCurrencyCode?: boolean;
}

export function formatCurrency(
  value: number,
  currency?: string | null,
  options?: FormatCurrencyOptions,
): string {
  const locale = getIntlLocale();
  const currencyCode = currency || 'EUR';
  if (options?.showCurrencyCode) {
    const formatted = getCachedNF(locale, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
      useGrouping: true,
    }).format(value);
    return `${formatted} ${currencyCode}`;
  }
  return getCachedNF(locale, {
    style: 'currency',
    currency: currencyCode,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    useGrouping: true,
  }).format(value);
}

const DIGIT_PART_TYPES = new Set<Intl.NumberFormatPartTypes>(['integer', 'group', 'decimal', 'fraction']);

/**
 * Split locale-formatted currency parts into prefix/suffix strings around
 * the numeric digits. Lets callers render the currency symbol as plain DOM
 * text so its color matches surrounding spans — `<NumberFlow style:'currency'>`
 * paints `.symbol__value` with `mix-blend-mode: plus-lighter` in shadow DOM,
 * which shifts the symbol's shade away from the integer digits on dark
 * surfaces.
 */
export function formatCurrencyAffixes(
  value: number,
  currency?: string | null,
): { prefix: string; suffix: string } {
  const parts = getCachedNF(getIntlLocale(), {
    style: 'currency',
    currency: currency || 'EUR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).formatToParts(value);
  const firstDigit = parts.findIndex((p) => DIGIT_PART_TYPES.has(p.type));
  const prefix = parts.slice(0, firstDigit).map((p) => p.value).join('');
  const suffix = parts.slice(firstDigit).filter((p) => !DIGIT_PART_TYPES.has(p.type)).map((p) => p.value).join('');
  return { prefix, suffix };
}

// Some locales (e.g. de-DE, fr-FR) insert a no-break space between the number
// and `%` per CLDR. Strip it for visual consistency across locales.
const PERCENT_NBSP_RE = /[\u00A0\u202F\u2009]%/g;

export function formatPercentage(value: number, decimals = 2): string {
  const formatted = getCachedNF(getIntlLocale(), {
    style: 'percent',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
    useGrouping: true,
  }).format(value);
  return formatted.replace(PERCENT_NBSP_RE, '%');
}

/**
 * Format a percentage given on the 0–100 scale (e.g. wire-shape weight = 23.5
 * → "23.50 %"). Wraps formatPercentage so callers don't repeat `value / 100`.
 */
export function formatPercentFromBasis100(value: number, decimals = 2): string {
  return formatPercentage(value / 100, decimals);
}

export function formatNumber(value: number, options: Intl.NumberFormatOptions): string {
  return getCachedNF(getIntlLocale(), { useGrouping: true, ...options }).format(value);
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
  return getCachedNF(getIntlLocale(), {
    minimumFractionDigits: isInteger ? 0 : precision,
    maximumFractionDigits: precision,
    useGrouping: true,
  }).format(value);
}

export interface FormatQuoteOptions {
  quotesPrecision?: number;
}

export function formatQuote(value: number, options?: FormatQuoteOptions): string {
  const precision = options?.quotesPrecision ?? 2;
  return getCachedNF(getIntlLocale(), {
    minimumFractionDigits: precision,
    maximumFractionDigits: precision,
    useGrouping: true,
  }).format(value);
}

/** TTWROR annualizzato: (1 + cumulative)^(365/days) - 1 */
export function computeTtwrorPa(ttwrorCumulative: number, daysSinceStart: number): number {
  if (daysSinceStart <= 0) return 0;
  return Math.pow(1 + ttwrorCumulative, 365 / daysSinceStart) - 1;
}
