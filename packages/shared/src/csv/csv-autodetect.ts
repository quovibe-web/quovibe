// packages/shared/src/csv/csv-autodetect.ts
//
// Autodetection helpers for the CSV import wizard. Pure functions, I/O-free.
// Three concerns, one entry point:
//
// - **dateFormat**: probe a date-shaped column against the four supported
//   `csvDateFormats` and pick the first that parses ≥ 80 % of samples and is
//   not contradicted by an unambiguous component (e.g. day > 12 rules out
//   MM/dd/yyyy).
// - **decimal / thousand separator**: classify numeric-looking cells by the
//   relative position of `.` vs `,`. The rightmost separator with ≤ 4
//   fractional digits is the decimal; the other, when present, is the
//   thousand separator.
// - **columnMapping**: normalize each header (trim, lowercase, NFD-strip
//   diacritics) and look it up in `HEADER_ALIASES`. First-wins: a header
//   already mapped to a field is not overwritten by a later column carrying
//   a synonymous label.
//
// PP's `CSVImporter` does the same shape of work in `DateField.guessFormat()`
// and `AmountField.guessFormat()` plus `normalizeColumnName()`. Quovibe's
// implementation is narrower (4 fixed date formats, no per-locale numeric
// templates) but cheaper and good enough for the wizard's pre-fill UX —
// the user can always override via dropdown.
import { parse, isValid } from 'date-fns';
import { csvDateFormats, type CsvDateFormat } from './csv-types';

export interface AutodetectResult {
  dateFormat: CsvDateFormat | null;
  decimalSeparator: '.' | ',' | null;
  thousandSeparator: '' | '.' | ',' | ' ' | null;
  columnMapping: Record<string, number>;
}

const DATE_SHAPE_RE = /^\s*\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}\s*$/;

function looksLikeDate(s: string): boolean {
  return DATE_SHAPE_RE.test(s);
}

function tryDateFormat(format: CsvDateFormat, samples: string[]): number {
  let matched = 0; // native-ok
  for (const s of samples) {
    const parsed = parse(s.trim(), format, new Date(2000, 0, 1));
    if (isValid(parsed)) matched++; // native-ok
  }
  return matched;
}

// Day/month-disambiguation: if any sample's first component is > 12 it
// cannot be MM/dd/yyyy; if the second component is > 12 and the first is
// ≤ 12 it cannot be dd/MM/yyyy. Used after a base parse pass to break ties
// on locale-ambiguous slash-separated dates.
function violatesMMddOrder(samples: string[]): boolean {
  for (const s of samples) {
    const m = s.trim().match(/^(\d{1,2})\/(\d{1,2})\/\d{4}$/);
    if (m && parseInt(m[1]!, 10) > 12) return true; // native-ok
  }
  return false;
}

function violatesDDMMOrder(samples: string[]): boolean {
  for (const s of samples) {
    const m = s.trim().match(/^(\d{1,2})\/(\d{1,2})\/\d{4}$/);
    if (m && parseInt(m[1]!, 10) <= 12 && parseInt(m[2]!, 10) > 12) return true; // native-ok
  }
  return false;
}

function detectDateFormat(samples: string[]): CsvDateFormat | null {
  if (samples.length === 0) return null;
  const required = Math.ceil(samples.length * 0.8); // native-ok

  let best: { format: CsvDateFormat; matched: number } | null = null;
  for (const fmt of csvDateFormats) {
    const matched = tryDateFormat(fmt, samples);
    if (matched < required) continue;
    if (fmt === 'MM/dd/yyyy' && violatesMMddOrder(samples)) continue;
    if (fmt === 'dd/MM/yyyy' && violatesDDMMOrder(samples)) continue;
    if (!best || matched > best.matched) best = { format: fmt, matched };
  }
  return best?.format ?? null;
}

function detectNumberFormat(
  numericCells: string[],
): { decimal: '.' | ',' | null; thousand: '' | '.' | ',' | ' ' | null } {
  if (numericCells.length === 0) return { decimal: null, thousand: null };

  let commaDecimal = 0; // native-ok
  let dotDecimal = 0; // native-ok
  let hasCommaThousand = false;
  let hasDotThousand = false;

  for (const s of numericCells) {
    const trimmed = s.trim();
    const lastComma = trimmed.lastIndexOf(',');
    const lastDot = trimmed.lastIndexOf('.');
    if (lastComma === -1 && lastDot === -1) continue;

    if (lastComma > lastDot) {
      const fractional = trimmed.length - lastComma - 1; // native-ok
      if (fractional > 4) continue; // native-ok
      commaDecimal++; // native-ok
      if (lastDot !== -1) hasDotThousand = true;
    } else if (lastDot > lastComma) {
      const fractional = trimmed.length - lastDot - 1; // native-ok
      if (fractional > 4) continue; // native-ok
      dotDecimal++; // native-ok
      if (lastComma !== -1) hasCommaThousand = true;
    }
  }

  if (commaDecimal === 0 && dotDecimal === 0) return { decimal: null, thousand: null };

  if (commaDecimal > dotDecimal) {
    return { decimal: ',', thousand: hasDotThousand ? '.' : '' };
  }
  return { decimal: '.', thousand: hasCommaThousand ? ',' : '' };
}

// Normalize a header: trim, lowercase, NFD-decompose and strip combining
// diacritics. Mirrors PP's `normalizeColumnName()` minus the German umlaut
// expansion (we rely on NFD which decomposes ü → u + combining-diaeresis,
// the diaeresis is then stripped). For alpha-only labels this collapses
// "Stück" → "stuck", "Größe" → "groSe" → "grosse" after sharp-s
// normalization.
function normalizeHeader(s: string): string {
  return s.trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/ß/g, 'ss');
}

// Header alias table. Maps normalized header strings to internal
// `tradeColumnFields` values. Multilingual coverage: en/de/it/fr/es/nl/pl/pt
// plus PP's English long-form labels. Adding a new language: append entries,
// keep first-wins ordering — no need to update consumers, the lookup is
// position-independent.
const HEADER_ALIASES: ReadonlyMap<string, string> = new Map([
  // ── English (PP's default + most broker exports) ──
  ['date', 'date'],
  ['transaction date', 'date'],
  ['type', 'type'],
  ['action', 'type'],
  ['transaction type', 'type'],
  ['security', 'security'],
  ['security name', 'security'],
  ['name', 'security'],
  ['shares', 'shares'],
  ['quantity', 'shares'],
  ['units', 'shares'],
  ['amount', 'amount'],
  ['value', 'amount'],
  ['net amount', 'amount'],
  ['price', 'amount'], // common in Ghostfolio etc.
  ['fees', 'fees'],
  ['fee', 'fees'],
  ['commission', 'fees'],
  ['taxes', 'taxes'],
  ['tax', 'taxes'],
  ['isin', 'isin'],
  ['ticker', 'ticker'],
  ['ticker symbol', 'ticker'],
  ['symbol', 'ticker'],
  ['code', 'ticker'],
  ['currency', 'currency'],
  ['transaction currency', 'currency'],
  ['note', 'note'],
  ['notes', 'note'],
  ['comment', 'note'],
  ['exchange rate', 'fxRate'],
  ['fx rate', 'fxRate'],
  ['rate', 'fxRate'],
  ['gross amount', 'grossAmount'],
  ['gross', 'grossAmount'],
  ['currency gross amount', 'currencyGrossAmount'],
  ['gross currency', 'currencyGrossAmount'],
  ['offset account', 'crossAccount'],
  ['offset securities account', 'crossAccount'],
  ['counter account', 'crossAccount'],
  ['account 2nd', 'crossAccount'],
  ['portfolio 2nd', 'crossAccount'],
  // ── German ──
  ['datum', 'date'],
  ['typ', 'type'],
  ['art', 'type'],
  ['wertpapier', 'security'],
  ['stuck', 'shares'],
  ['stueck', 'shares'],
  ['anteile', 'shares'],
  ['wert', 'amount'],
  ['betrag', 'amount'],
  ['gebuhren', 'fees'],
  ['gebuehren', 'fees'],
  ['steuern', 'taxes'],
  ['wahrung', 'currency'],
  ['waehrung', 'currency'],
  ['notiz', 'note'],
  ['wechselkurs', 'fxRate'],
  ['bruttobetrag', 'grossAmount'],
  ['brutto', 'grossAmount'],
  ['gegenkonto', 'crossAccount'],
  ['wkn', 'wkn'],
  ['time', 'time'],
  ['ora', 'time'],
  ['zeit', 'time'],
  ['heure', 'time'],
  ['hora', 'time'],
  ['tijd', 'time'],
  ['czas', 'time'],
  ['dateofquote', 'dateOfQuote'],
  ['date of quote', 'dateOfQuote'],
  ['data quotazione', 'dateOfQuote'],
  ['datum der notierung', 'dateOfQuote'],
  ['date de cotation', 'dateOfQuote'],
  ['fecha de cotizacion', 'dateOfQuote'],
  ['datum van notering', 'dateOfQuote'],
  ['data notowania', 'dateOfQuote'],
  ['data da cotacao', 'dateOfQuote'],
  // BUG-124: cross-currency fees/taxes
  ['fees foreign currency', 'feesFx'],
  ['foreign fees', 'feesFx'],
  ['commissioni valuta estera', 'feesFx'],
  ['gebuhren fremdwahrung', 'feesFx'],
  ['frais en devise etrangere', 'feesFx'],
  ['comisiones en moneda extranjera', 'feesFx'],
  ['taxes foreign currency', 'taxesFx'],
  ['foreign taxes', 'taxesFx'],
  ['tasse valuta estera', 'taxesFx'],
  ['steuern fremdwahrung', 'taxesFx'],
  ['taxes en devise etrangere', 'taxesFx'],
  ['impuestos en moneda extranjera', 'taxesFx'],
  ['fees currency', 'feesCurrency'],
  ['currency of fees', 'feesCurrency'],
  ['taxes currency', 'taxesCurrency'],
  ['currency of taxes', 'taxesCurrency'],
  // ── Italian ──
  ['data', 'date'],
  ['tipo', 'type'],
  ['operazione', 'type'],
  ['strumento', 'security'],
  ['titolo', 'security'],
  ['quote', 'shares'],
  ['quantita', 'shares'],
  ['valore', 'amount'],
  ['importo', 'amount'],
  ['commissioni', 'fees'],
  ['tasse', 'taxes'],
  ['imposte', 'taxes'],
  ['valuta', 'currency'],
  ['nota', 'note'],
  ['tasso di cambio', 'fxRate'],
  ['cambio', 'fxRate'],
  ['importo lordo', 'grossAmount'],
  ['lordo', 'grossAmount'],
  ['conto controparte', 'crossAccount'],
  // ── French ──
  ['type', 'type'],
  ['titre', 'security'],
  ['libelle', 'security'],
  ['quantite', 'shares'],
  ['parts', 'shares'],
  ['valeur', 'amount'],
  ['montant', 'amount'],
  ['frais', 'fees'],
  ['impots', 'taxes'],
  ['devise', 'currency'],
  ['taux de change', 'fxRate'],
  ['montant brut', 'grossAmount'],
  ['compte miroir', 'crossAccount'],
  // ── Spanish ──
  ['fecha', 'date'],
  ['accion', 'type'],
  ['participaciones', 'shares'],
  ['cantidad', 'shares'],
  ['comisiones', 'fees'],
  ['impuestos', 'taxes'],
  ['moneda', 'currency'],
  ['tipo de cambio', 'fxRate'],
  ['importe bruto', 'grossAmount'],
  ['contracuenta', 'crossAccount'],
  // ── Dutch ──
  ['effect', 'security'],
  ['aandelen', 'shares'],
  ['waarde', 'amount'],
  ['bedrag', 'amount'],
  ['kosten', 'fees'],
  ['belastingen', 'taxes'],
  ['wisselkoers', 'fxRate'],
  ['bruto bedrag', 'grossAmount'],
  ['tegenrekening', 'crossAccount'],
  // ── Polish ──
  ['papier', 'security'],
  ['akcje', 'shares'],
  ['ilosc', 'shares'],
  ['wartosc', 'amount'],
  ['kwota', 'amount'],
  ['oplaty', 'fees'],
  ['podatki', 'taxes'],
  ['waluta', 'currency'],
  ['kurs wymiany', 'fxRate'],
  ['kwota brutto', 'grossAmount'],
  ['konto przeciwstawne', 'crossAccount'],
  // ── Portuguese ──
  ['titulo', 'security'],
  ['quantidade', 'shares'],
  ['valor', 'amount'],
  ['taxas', 'fees'],
  ['impostos', 'taxes'],
  ['moeda', 'currency'],
  ['taxa de cambio', 'fxRate'],
  ['valor bruto', 'grossAmount'],
  ['conta contrapartida', 'crossAccount'],
]);

function detectColumnMapping(headers: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (let i = 0; i < headers.length; i++) { // native-ok
    const norm = normalizeHeader(headers[i] ?? '');
    const field = HEADER_ALIASES.get(norm);
    if (field && out[field] == null) out[field] = i; // first-wins
  }
  return out;
}

export function autodetectCsvFormat(
  headers: string[],
  sampleRows: string[][],
): AutodetectResult {
  // Per-column samples — sliced once so date/number probes share the work.
  const colSamples: string[][] = headers.map((_, i) =>
    sampleRows.map((r) => r[i] ?? '').filter((c) => c !== ''),
  );

  // Date format: pick the first column where ≥ 50 % of cells are date-shaped,
  // then probe formats against just those cells. Multiple date columns are
  // rare; the first one wins (matches PP's behavior).
  let dateFormat: CsvDateFormat | null = null;
  for (const col of colSamples) {
    if (col.length === 0) continue;
    const dateLike = col.filter(looksLikeDate);
    if (dateLike.length / col.length >= 0.5 && dateLike.length > 0) { // native-ok
      dateFormat = detectDateFormat(dateLike);
      if (dateFormat) break;
    }
  }

  // Number format: scan all numeric-looking cells across all columns. Date
  // cells with `-` or `.` are filtered by the regex (need at least one digit
  // and no letters).
  const numericCells: string[] = [];
  for (const col of colSamples) {
    for (const cell of col) {
      const trimmed = cell.trim();
      if (!trimmed) continue;
      if (looksLikeDate(trimmed)) continue;
      if (!/^-?[\d.,\s]+$/.test(trimmed)) continue;
      if (!/\d/.test(trimmed)) continue;
      numericCells.push(trimmed);
    }
  }
  const num = detectNumberFormat(numericCells);

  return {
    dateFormat,
    decimalSeparator: num.decimal,
    thousandSeparator: num.thousand,
    columnMapping: detectColumnMapping(headers),
  };
}
