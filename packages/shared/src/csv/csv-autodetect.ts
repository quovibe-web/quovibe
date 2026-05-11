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
import { csvDateFormats, type CsvDateFormat } from './csv-types';
import { parseDate } from './csv-normalizer';

export interface AutodetectResult {
  dateFormat: CsvDateFormat | null;
  decimalSeparator: '.' | ',' | null;
  thousandSeparator: '' | '.' | ',' | ' ' | null;
  columnMapping: Record<string, number>;
}

// Accept a trailing ISO 8601 time tail (`T15:42:43`, `T15:42`) or a
// space-separated time tail. PP CSV exports always carry the time on the
// Data column; `parseDate` drops it before the strict format match.
const DATE_SHAPE_RE = /^\s*\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}(?:[T ]\d{1,2}:\d{2}(?::\d{2})?)?\s*$/;

function looksLikeDate(s: string): boolean {
  return DATE_SHAPE_RE.test(s);
}

function tryDateFormat(format: CsvDateFormat, samples: string[]): number {
  let matched = 0; // native-ok
  for (const s of samples) {
    if (parseDate(s, format) !== null) matched++; // native-ok
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
    .replace(/ß/g, 'ss')
    // Polish `ł` is a Latin-with-stroke codepoint that does NOT decompose
    // under NFD; explicit fold keeps `Opłaty` / `Symbol giełdowy` matchable
    // against ASCII alias keys.
    .replace(/ł/g, 'l')
    // Treat hyphens as word separators so `Ticker-Symbol` and `Compte-titres`
    // collapse to the same form as their space-separated cousins. The
    // whitespace collapse below then folds runs of separators.
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ');
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
  // ── German ──
  ['datum', 'date'],
  ['typ', 'type'],
  ['art', 'type'],
  ['wertpapier', 'security'],
  ['wertpapiername', 'security'],
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
  ['buchungswahrung', 'currency'],
  ['buchungswaehrung', 'currency'],
  ['ticker symbol', 'ticker'],
  ['tickersymbol', 'ticker'],
  ['notiz', 'note'],
  ['wechselkurs', 'fxRate'],
  ['bruttobetrag', 'grossAmount'],
  ['brutto', 'grossAmount'],
  ['wahrung bruttobetrag', 'currencyGrossAmount'],
  ['waehrung bruttobetrag', 'currencyGrossAmount'],
  ['wkn', 'wkn'],
  ['uhrzeit', 'time'],
  ['kursdatum', 'dateOfQuote'],
  ['depot', 'securitiesAccount'],
  ['gegendepot', 'offsetSecuritiesAccount'],
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
  // Cross-currency fees/taxes
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
  ['nome titolo', 'security'],
  ['quote', 'shares'],
  ['quantita', 'shares'],
  ['azioni', 'shares'],
  ['valore', 'amount'],
  ['importo', 'amount'],
  ['commissioni', 'fees'],
  ['tasse', 'taxes'],
  ['imposte', 'taxes'],
  ['valuta', 'currency'],
  ['valuta operazione', 'currency'],
  ['simbolo titolo', 'ticker'],
  ['nota', 'note'],
  ['tasso di cambio', 'fxRate'],
  ['cambio', 'fxRate'],
  ['importo lordo', 'grossAmount'],
  ['lordo', 'grossAmount'],
  ['importo lordo valuta', 'currencyGrossAmount'],
  ['valuta importo lordo', 'currencyGrossAmount'],
  // ── French ──
  ['type', 'type'],
  ['titre', 'security'],
  ['libelle', 'security'],
  ['nom du titre', 'security'],
  ['quantite', 'shares'],
  ['parts', 'shares'],
  ['valeur', 'amount'],
  ['montant', 'amount'],
  ['frais', 'fees'],
  ['impots', 'taxes'],
  ["impots / taxes", 'taxes'],
  ['devise', 'currency'],
  ["devise de l'operation", 'currency'],
  ['symbole boursier', 'ticker'],
  ['symbole', 'ticker'],
  ['taux de change', 'fxRate'],
  ['montant brut', 'grossAmount'],
  ['montant brut en devise', 'currencyGrossAmount'],
  ['compte de compensation', 'offsetAccount'],
  // ── Spanish ──
  ['fecha', 'date'],
  ['accion', 'type'],
  ['participaciones', 'shares'],
  ['cantidad', 'shares'],
  ['acciones', 'shares'],
  ['importe', 'amount'],
  ['comisiones', 'fees'],
  ['impuestos', 'taxes'],
  ['moneda', 'currency'],
  ['divisa de la transaccion', 'currency'],
  ['simbolo del ticker', 'ticker'],
  ['simbolo', 'ticker'],
  ['nombre del valor', 'security'],
  ['tipo de cambio', 'fxRate'],
  ['importe bruto', 'grossAmount'],
  ['divisa del importe bruto', 'currencyGrossAmount'],
  ['cuenta de contrapartida', 'offsetAccount'],
  ['cuenta de valores compensados', 'offsetSecuritiesAccount'],
  // ── Dutch ──
  ['effect', 'security'],
  ['transactietype', 'type'],
  ['aandelen', 'shares'],
  ['aantal', 'shares'],
  ['waarde', 'amount'],
  ['waarde (netto)', 'amount'],
  ['bedrag', 'amount'],
  ['kosten', 'fees'],
  ['belasting', 'taxes'],
  ['belastingen', 'taxes'],
  ['transactievaluta', 'currency'],
  ['tickersymbool', 'ticker'],
  ['opmerking', 'note'],
  ['notitie', 'note'],
  ['wisselkoers', 'fxRate'],
  ['waarde (bruto)', 'grossAmount'],
  ['bruto bedrag', 'grossAmount'],
  ['valuta (bruto)', 'currencyGrossAmount'],
  ['koersdatum', 'dateOfQuote'],
  // ── Polish ──
  ['papier', 'security'],
  ['nazwa waloru', 'security'],
  ['akcje', 'shares'],
  ['ilosc', 'shares'],
  ['wartosc', 'amount'],
  ['kwota', 'amount'],
  ['oplaty', 'fees'],
  ['podatki', 'taxes'],
  ['waluta', 'currency'],
  ['waluta transakcji', 'currency'],
  ['symbol gieldowy waloru', 'ticker'],
  ['symbol gieldowy', 'ticker'],
  ['uwaga', 'note'],
  ['notatka', 'note'],
  ['kurs wymiany', 'fxRate'],
  ['kwota brutto', 'grossAmount'],
  ['kwota waluty brutto', 'currencyGrossAmount'],
  ['konto pieniezne', 'account'],
  ['konto walorow', 'securitiesAccount'],
  ['konto przeciwstawne walorow', 'offsetSecuritiesAccount'],
  // ── Portuguese ──
  ['titulo', 'security'],
  ['nome do titulo', 'security'],
  ['quantidade', 'shares'],
  ['valor', 'amount'],
  ['comissoes', 'fees'],
  ['taxas', 'fees'],
  ['impostos', 'taxes'],
  ['moeda', 'currency'],
  ['moeda da transacao', 'currency'],
  ['simbolo ticker', 'ticker'],
  ['taxas de cambio', 'fxRate'],
  ['taxa de cambio', 'fxRate'],
  ['valor bruto', 'grossAmount'],
  ['valor bruto em moeda', 'currencyGrossAmount'],
  ['conta caixa', 'account'],
  ['conta de contrapartida', 'offsetAccount'],
  ['conta de titulos', 'securitiesAccount'],
  ['conta de titulos compensados', 'offsetSecuritiesAccount'],
  // ── Per-row account columns: account / securitiesAccount / offsetAccount / offsetSecuritiesAccount ──
  // 8-language aliases per column. PP-aligned naming.
  // account (deposit cash account)
  ['account', 'account'],
  ['cash account', 'account'],
  ['konto', 'account'],
  ['bargeldkonto', 'account'],
  ['conto', 'account'],
  ['conto contante', 'account'],
  ['compte', 'account'],
  ['compte especes', 'account'],
  ['cuenta', 'account'],
  ['cuenta efectivo', 'account'],
  ['rekening', 'account'],
  ['conta', 'account'],
  ['conta dinheiro', 'account'],
  // securitiesAccount (portfolio-type account)
  ['securities account', 'securitiesAccount'],
  ['wertpapierkonto', 'securitiesAccount'],
  ['conto titoli', 'securitiesAccount'],
  ['compte titres', 'securitiesAccount'],
  ['cuenta de valores', 'securitiesAccount'],
  ['effectenrekening', 'securitiesAccount'],
  ['conta de valores', 'securitiesAccount'],
  // offsetAccount (deposit-side counter)
  ['offset account', 'offsetAccount'],
  ['gegenkonto', 'offsetAccount'],
  ['conto controparte', 'offsetAccount'],
  ['compte miroir', 'offsetAccount'],
  ['contracuenta', 'offsetAccount'],
  ['tegenrekening', 'offsetAccount'],
  ['konto przeciwstawne', 'offsetAccount'],
  ['conta contrapartida', 'offsetAccount'],
  // offsetSecuritiesAccount (portfolio-side counter)
  ['offset securities account', 'offsetSecuritiesAccount'],
  ['gegen wertpapierkonto', 'offsetSecuritiesAccount'],
  ['conto titoli controparte', 'offsetSecuritiesAccount'],
  ['compte titres miroir', 'offsetSecuritiesAccount'],
  ['contracuenta de valores', 'offsetSecuritiesAccount'],
  ['tegen effectenrekening', 'offsetSecuritiesAccount'],
  ['conta de valores contrapartida', 'offsetSecuritiesAccount'],
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
