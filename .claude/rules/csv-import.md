globs: packages/api/src/routes/csv-import.*,packages/api/src/services/csv/**,packages/shared/src/csv/**,packages/web/src/components/domain/csv-import/**,packages/web/src/api/use-csv-import.*
---
# CSV Import Rules

## Boundary hardening (BUG-46 / BUG-47)

Uploads to `POST /api/p/:pid/csv-import/trades/parse` and
`/api/p/:pid/csv-import/prices/parse` must surface structural failures as
**400 with a machine-readable code**, never 500. The two failure classes are
invalid file shape and oversize payload.

### Server — CsvImportError codes and status mapping

All handled errors flow through `handleError` in
`packages/api/src/routes/csv-import.ts`. Only `CsvImportError` instances reach
the wire; anything else becomes 500 `INTERNAL_ERROR`.

| Code                 | Status | Meaning                                                                 |
|----------------------|--------|-------------------------------------------------------------------------|
| `NO_FILE`            | 400    | Request reached the handler with no `file` field                        |
| `INVALID_FILE_FORMAT`| 400    | Multer fileFilter reject (non-`.csv` extension) or any other multer fault |
| `FILE_TOO_LARGE`     | 400    | Multer `LIMIT_FILE_SIZE` — upload exceeded `UPLOAD_MAX_BYTES` (100 MB)  |
| `INVALID_SECURITIES_ACCOUNT` | 400 | Preview/execute `targetSecuritiesAccountId` does not resolve to an inner `account.uuid` with `type='portfolio'` |
| `NO_REFERENCE_ACCOUNT`| 400   | Portfolio has no linked deposit account                                 |
| `IMPORT_IN_PROGRESS` | 409    | Another import holds the temp-file lock                                 |
| `TEMP_FILE_EXPIRED`  | 410    | Upload's temp file was cleaned up before the wizard finished            |

### Server — Multer wrapping is mandatory

Routes that accept file uploads MUST wrap `upload.single(field)` in the local
`uploadSingle(field)` middleware (or an equivalent per-route handler). The
wrapper catches `multer.MulterError` and fileFilter rejects and routes them
through `handleError` as `CsvImportError`. Calling `upload.single(field)`
directly as middleware drops multer errors into the global Express error
handler, which has no status-code and returns 500 — that is BUG-46 returning.

### Client — validate before POST, gate Next on the sniff

`CsvUploadStep.tsx` is the single boundary for trade uploads. It must:

1. Reject locally before POST when the file extension is not `.csv` or when
   the first 4 KB contain a null byte (binary sniff). The browser's
   `accept=".csv"` attribute is a hint, not a check.
2. Surface server error codes (`INVALID_FILE_FORMAT`, `FILE_TOO_LARGE`,
   `NO_FILE`) inline via the drop-zone Alert — the global MutationCache toast
   alone is not discoverable enough for this step.
3. Run `sniffLikelyTradeCsv(headers, sampleRows, {dateFormat, decimalSeparator,
   thousandSeparator})` from `@quovibe/shared` after each successful parse
   and block the Next button when `ok === false`. The user's escape hatch is
   the format dropdowns (changing them re-evaluates the sniff in render).

### Shared — sniffLikelyTradeCsv contract

`packages/shared/src/csv/csv-sniff.ts` is pure, I/O-free, and the single source
of truth for the Step-1 heuristic. It accepts the parsed headers + sample rows
and returns `{ok, reason}`:

- `SINGLE_COLUMN` — fewer than 2 columns detected (classic "no delimiter" case)
- `NO_SAMPLE_ROWS` — parse yielded zero data rows
- `NO_DATE_COLUMN` — no column parses as a date with ≥ 50 % sample match ratio
- `NO_AMOUNT_COLUMN` — no column parses as a number with ≥ 50 % sample match ratio

This heuristic is intentionally loose — its only job is to stop obviously-wrong
input from reaching column mapping. Tight per-row validation still happens at
Preview time.

### Tests that lock the contract

- `packages/api/src/__tests__/csv-upload-hardening.test.ts` — supertest cases
  for `.exe`, oversize, missing-file, and golden-path.
- `packages/shared/src/csv/csv-sniff.test.ts` — unit cases for each reason
  plus a locale-specific positive case.

Any regression that bypasses `uploadSingle`, rolls back the new error codes,
or removes the client sniff must make one of these suites go red first.

## Cross-currency CSV import (BUG-121)

Quovibe's CSV import accepts the three Portfolio Performance cross-currency
columns documented in `docs/pp-reference/csv-import.md`:

- `Exchange Rate` — PP convention: deposit-per-security (`Value = Gross × Rate`).
  Stored on `NormalizedTradeRow` in **qv convention** (security-per-deposit)
  via `ppRateToQvRate` at parse time, so the rest of the pipeline matches
  `transaction.service.ts`. The inversion lives in
  `packages/shared/src/csv/csv-fx.ts > ppRateToQvRate` — single source of
  truth, never re-derive it elsewhere.
- `Gross Amount` — security-currency gross. Used to populate the FOREX
  `xact_unit.forex_amount` and to run PP's step-2
  `Gross × Rate = Value` consistency check
  (`csv-fx.ts > verifyGrossRateValue`, tolerance `5e-4`).
- `Currency Gross Amount` — security currency code (e.g. `"USD"`). Pinned
  against the resolved `security.currency` for `CURRENCY_MISMATCH` detection.

### Server — error codes added

| Code                     | Status | Meaning |
|--------------------------|--------|---------|
| `FX_RATE_REQUIRED`       | 400    | Cross-currency BUY/SELL/`TRANSFER_BETWEEN_ACCOUNTS` row with no `Exchange Rate` AND no rate cached in `vf_exchange_rate` for the date. |
| `INVALID_FX_RATE`        | 400    | `Exchange Rate` cell parsed as ≤ 0 or non-numeric. |
| `FX_VERIFICATION_FAILED` | 400    | `\|Gross × Rate − Value\|` exceeds the 0.05 % tolerance (matches PP wizard step-2 block). |
| `CURRENCY_MISMATCH`      | 400    | `Currency Gross Amount` differs from the resolved `security.currency`. |

### Server — gate locations

- **`csv-import.service.ts > parseTradeRow`** parses the three new columns and
  returns `INVALID_FX_RATE` on a malformed `Exchange Rate`.
- **`csv-import.service.ts > enrichRowsWithFxChecks`** auto-fills missing
  rates from the `vf_exchange_rate` cache (mirroring PP's "automatic" flow
  in `csv-import.md:142`), runs the PP step-2 verification, and runs the
  `CURRENCY_MISMATCH` check. Pending-new securities skip the check at
  preview time (currency unknown until execute) and are caught on the
  execute pass.
- **`csv-trade-mapper.ts > mapTradeRows`** runs the per-row gate using
  `CROSS_CURRENCY_FX_TYPES` from `packages/shared/src/transaction-gating.ts`
  — the same set the route-layer `enforceCrossCurrencyFxRate` uses.
- **`csv-import.service.ts > executeTradeImport`** hard-aborts the whole
  import with `CsvImportError('FX_RATE_REQUIRED', …)` BEFORE the SQLite
  transaction opens if any row carries any FX-class error. **Deliberate
  divergence** from the soft-skip posture used by `MISSING_SHARES`,
  `MISSING_SECURITY`, `MISSING_CROSS_ACCOUNT`: PP itself blocks at wizard
  step 2 in this scenario, and the wizard has no way for the user to
  repair an FX-required row mid-flight, so persisting "the rest" leaves
  the portfolio silently incomplete. Future contributors must NOT
  "normalize" this back to soft-skip.

### Server — xact_unit emission (parity with `transaction.service.ts`)

Before this work the CSV mapper emitted ZERO `xact_unit` rows — even FEE/TAX
units for plain same-currency BUY/SELL/DIVIDEND. CSV-imported transactions
were therefore observably different from JSON-imported ones at the engine
layer. Closing the cross-currency gap required closing this gap too:
`csv-trade-mapper.ts > emitFeeTaxUnits` mirrors the per-type matrix from
`transaction.service.ts > buildUnits` (lines 226-312), and the FOREX-unit
emission for cross-currency BUY/SELL and `TRANSFER_BETWEEN_ACCOUNTS` mirrors
lines 256-301 of the same file. **Same-currency FEE/TAX emission is a
deliberate scope addition under this work** — do not "revert" it as
out-of-scope; the parity is the point.

### Server — per-leg currency on transfers (deliberate non-fix)

`transaction.service.ts:549,560` writes BOTH legs of a
`TRANSFER_BETWEEN_ACCOUNTS` (and the BUY/SELL cash side) with the
**source-side** currency on `xact.currency`, even when the destination
account's intrinsic currency differs. The cross-currency information lives
on the FOREX `xact_unit` (amount = src-ccy hecto, `forex_amount` = dst-ccy
hecto). The CSV mapper now matches that behavior (was already partly there).
Fixing the per-leg-currency inconsistency is a service+engine+CSV refactor
out of scope for this work; both paths inherit the same upstream issue.

### Rate-direction convention (the load-bearing pin)

PP CSV `Exchange Rate` is **deposit-per-security**. Quovibe internal
`fxRate` (and `xact_unit.exchangeRate`) is **security-per-deposit**. They
are reciprocals: `PP_rate × qv_rate = 1`. The CSV-parse boundary inverts
once via `ppRateToQvRate`. The `vf_exchange_rate` cache stores the qv
direction (`getRate(deposit, security)` returns security-per-deposit), so
auto-filled rates need no inversion. The mapper's FOREX emission reads
`row.fxRate` already in qv convention and computes
`forex_amount_hecto = amount_deposit × qvRate × 100` (matches
`transaction.service.ts:258`). When the user supplies `Gross Amount`
explicitly, the mapper prefers that value over the back-computed one to
avoid the rounding drift inherent to 4-decimal PP rates × 2-decimal
amounts.

### Client — wizard surface

`CsvColumnMapStep.tsx` auto-renders the three new optional columns from
`tradeColumnFields` — no structural change. `CsvPreviewStep.tsx` extends
`ROW_ERROR_I18N` with the four new error codes plus an
`FX_RATE_REQUIRED` mapping in `mapExecuteError` for the execute-time
hard-abort. The `csv-import.json` locale files in all 8 languages carry
`columns.field.{fxRate,grossAmount,currencyGrossAmount}` and
`errors.{fxRateRequired,invalidFxRate,fxVerificationFailed,currencyMismatch}`.

### Tests that lock the contract

- `packages/shared/src/csv/csv-fx.test.ts` — `ppRateToQvRate`
  reciprocal/edge cases; `verifyGrossRateValue` PP-example fixtures
  (NVIDIA dividend 15 USD × 0.5 = 7.5 EUR; BUY 1606.71 USD × 1.0837 ≈
  1740.99 EUR) + tolerance edge cases.
- `packages/api/src/services/csv/csv-trade-mapper.test.ts` —
  per-type FEE/TAX unit matrix; cross-currency BUY/SELL/TRANSFER FOREX
  emission; gate triggers on missing `fxRate`; same-currency rows emit
  zero FOREX units.
- `packages/api/src/services/csv/csv-import.service.test.ts` — preview
  emits all four FX error codes correctly; execute hard-aborts on
  FX-class errors with no partial write; cached rate auto-fills the row;
  full cross-currency BUY persists xact + FEE + TAX + FOREX units with
  PP-aligned values.

Any regression that drops the `CROSS_CURRENCY_FX_TYPES` gate, drops
`xact_unit` emission, reverts the qv-convention pin, or weakens the
hard-abort posture must make one of these suites go red first.

### New-security currency resolution

When the CSV import wizard creates a new security record (unmatched
name on the security-match step), `security.currency` MUST be derived
from the CSV's `currencyGrossAmount` (CGA) column when present.
Resolution priority:

1. User override from the per-row currency picker on
   `CsvSecurityMatchStep.tsx`.
2. Single distinct CGA value seen across all CSV rows for that csvName.
3. Portfolio reference-deposit currency (silent fallback, surfaced as a
   warning badge inline).

Hardcoding `'EUR'` (or any portfolio-default) at this step is the
upstream cause of a class of cross-currency SELL bypass: a
USD-denominated security born as EUR trivially passes
`enforceCrossCurrencyFxRate` in
`packages/api/src/routes/transactions.ts` (which compares
`cash.currency === security.currency`), and every subsequent BUY/SELL
posts as a same-currency trade with no FOREX `xact_unit` row.

The wire shape carries this context: `UnmatchedSecurity.csvCurrencies`
is a sorted distinct array of the CGA values seen across rows for that
csvName (`packages/shared/src/csv/csv-types.ts`). Empty / absent →
CGA column unmapped or blank everywhere; the client falls back to
portfolio currency and renders a yellow warning badge so the user can
confirm or override.

The pure helper lives at
`packages/web/src/components/domain/csv-import/csv-security-match-step.utils.ts`
(`resolveNewSecurityCurrency`) and is unit-tested next to the
component. Server-side: `previewTradeImport` collects CGA per csvName
during the unmatched-security discovery loop. No execute-path change
is needed — `INSERT INTO security (... currency ...)` already pulls
from `input.newSecurities[i].currency`.

Tests that lock the contract:
- `packages/web/src/components/domain/csv-import/csv-security-match-step.utils.test.ts`
  — priority-chain unit cases (override > single CGA > portfolio).
- `packages/api/src/services/csv/csv-import.service.test.ts >
  csvCurrencies enrichment` — preview emits sorted distinct CGA arrays
  per csvName; omits the field when CGA is unmapped.
- `packages/api/src/services/csv/csv-import.service.test.ts >
  cross-currency BUY of new security creates security with CGA
  currency, not portfolioCurrency` — end-to-end pin: USD security is
  born with `security.currency='USD'` after CSV execute.

### Foreign-currency fees and taxes (BUG-124)

PP CSV cross-currency BUY/SELL rows can carry `Fees Foreign Currency` and
`Taxes Foreign Currency` columns — fee/tax magnitudes denominated in the
security currency rather than the deposit currency. Quovibe mirrors
`transaction.service.ts:247-270` exactly:

- `xact_unit.amount` (FEE/TAX) — combined deposit-ccy hecto:
  `(fees_deposit + feesFx / fxRate) × 100`, rounded.
- `xact_unit.forex_amount` (FEE/TAX) — security-ccy hecto: `feesFx × 100`.
- `xact_unit.forex_currency` — the resolved fee/tax currency (defaults to
  `currencyGrossAmount`, then the security currency).
- `xact_unit.exchangeRate` — qv-convention rate (security-per-deposit),
  same value as the parent FOREX unit's rate.

Same-currency BUY/SELL rows leave `forex_amount` / `forex_currency` /
`exchangeRate` `NULL` on the FEE/TAX rows (FOREX-decoration is opt-in,
gated on `row.fxRate != null`).

`csv-trade-mapper.ts > emitFeeTaxUnits` is the single emission site;
extending it for any future `feesFx` analogue (e.g. `interestFx`) goes
through the same helper.

The wire columns `feesFx`, `taxesFx`, `feesCurrency`, `taxesCurrency` are
defined in `tradeColumnFields` in `csv-types.ts`; HEADER_ALIASES coverage
in `csv-autodetect.ts` is 8-language. End-to-end persistence test:
`csv-import.service.test.ts > executeTradeImport — cross-ccy BUY with
feesFx + taxesFx persists FEE-FOREX + TAX-FOREX units (BUG-124)`.

## Re-import dedupe (BUG-143)

CSV re-import is **silently idempotent**: re-importing the same file
inserts zero new rows, and the user sees the duplicate count in the
preview chip and the success Alert.

### Server — natural-key fingerprint

The natural key is `(date, type, security, account, shares, amount)`.
Enforced by a partial unique index `idx_xact_csv_natural_key` on `xact`
scoped `WHERE source = 'CSV_IMPORT'`. Manual entries and PP-XML imports
(different `source` values) are never matched against the index — they
can legitimately collide on the same natural key.

The index is created at runtime by `apply-bootstrap.ts >
ensureCsvDedupeIndex` rather than declared in `bootstrap.sql §4`.
**Reason**: bootstrap.sql is applied via a single `db.exec(...)` call.
If `CREATE UNIQUE INDEX` raises (a contaminated DB still holds
divergent CSV duplicates that cleanupCsvDuplicates left alone), the
entire exec aborts mid-script and bootstrap leaves the DB in a
half-applied state. Runtime DDL with try/catch keeps the app usable
even when the index can't install. The cleanup helper (also in
`apply-bootstrap.ts`) collapses byte-identical CSV-source duplicate
groups before the index is attempted.

### Server — execute path

`executeTradeImport` uses `INSERT OR IGNORE INTO xact ... RETURNING
uuid` (better-sqlite3 12+ supports RETURNING via `.get()`). When the
returned row is null, the partial index dropped the insert; the helper
records the UUID in a skipped-set and downstream `xact_unit` and
`xact_cross_entry` inserts that reference it are filtered out before
running. Skip count returned as `TradeExecuteResult.skippedDuplicates`
(raw xact-row count). The user-facing `imported` field subtracts
`Math.ceil(skipped / 2)` so it reflects input-row dedupes for the
common BUY/SELL case (two legs per input).

`previewTradeImport` runs the same fingerprint check at preview time
(single SQL query, in-memory Set lookup) and sets
`summary.duplicates` so Step 4 of the wizard can render
"X new · Y duplicate · Z errors" before the user clicks Import.

### Client — surface

`CsvPreviewStep.tsx` renders an amber summary card with
`summary.duplicates` count when > 0 (between the "valid" and "errors"
cards). The result Alert adds a `result.skippedDuplicates` line and
switches to `result.allDuplicates` as the primary message when
`imported === 0 && skippedDuplicates > 0`.

### Cleanup of pre-existing duplicates

`cleanupCsvDuplicates` runs once per `applyBootstrap` call. It scans
for natural-key groups with `count(*) > 1` AND `source='CSV_IMPORT'`,
fingerprints each member's full editable surface (note, currency,
fees, taxes, acctype + xact_unit children + xact_cross_entry rows),
and collapses byte-identical groups to MIN(_id) — deleting victims
and all their `xact_unit` + `xact_cross_entry` dependents inside a
single `db.transaction()`.

Divergent groups (members that differ on any field — e.g. user edited
one of the duplicates manually) are LEFT UNTOUCHED with a logged
warning. CREATE INDEX then fails for those DBs and is silently
deferred (try/catch); the affected portfolio still works, but
re-import dedupe is degraded for it until manual cleanup. This is a
rare edge case (presupposes manual edits to BUG-143-era duplicates)
and acceptable as a follow-up rather than blocking app start.

### Known gap: NULL security

SQLite UNIQUE treats NULL as distinct from NULL. Cash-only types
(DEPOSIT, REMOVAL, INTEREST, FEES, …) have `security IS NULL` and are
NOT deduped at the DB layer. This is acceptable today because PP CSV
trade-import scope is BUY/SELL/DIVIDEND/etc. — every row carries a
security. When cash-only CSV import lands, dedupe for those rows must
use a separate strategy (likely pre-flight Set-based filter, since
partial unique index can't help with NULL).

### Tests that lock the contract

- `packages/api/src/db/__tests__/csv-dedupe-cleanup.test.ts` — pure
  fingerprint helper + `cleanupCsvDuplicates` SQLite cases.
- `packages/api/src/db/__tests__/bootstrap-csv-dedupe.test.ts` —
  index install on fresh DB, partial scope (CSV-source only),
  cleanup on contaminated DB, divergent-group survival.
- `packages/api/src/services/csv/csv-import.service.test.ts >
  previewTradeImport — re-import dedupe (BUG-143)` — summary count,
  fresh-vs-existing, non-CSV-source isolation.
- `packages/api/src/services/csv/csv-import.service.test.ts >
  executeTradeImport — re-import dedupe (BUG-143)` — full re-import,
  mixed batch, no orphan units.

Any regression that drops the partial index, removes the cleanup
helper, replaces INSERT OR IGNORE with plain INSERT, or stops
filtering dependent rows on skipped UUIDs must make one of these
suites go red first.

## Accepted-but-ignored columns (BUG-125)

PP CSV exports include two columns quovibe accepts in column mapping but
does not store:

- `WKN` — German-broker security identifier. Not in §1+§2 vendor schema
  (no `security.wkn` column today). Adding one is blocked by ADR-015 and
  out of scope for this work.
- `Date of Quote` — alternate spelling of `date` for price-import flow;
  ignored on trade flow when the canonical `date` is mapped.

These two columns are wire-accepted (parse-and-discard in
`csv-import.service.ts > parseTradeRow`) and 8-language `HEADER_ALIASES`
entries exist in `csv-autodetect.ts`. Re-importing a PP export that
includes them no longer fails the column-required pre-check.

Note: `Time` (`Ora`, `Uhrzeit`, …) is **persisted** to `xact.date` as an
ISO timestamp tail. See "Same-day intraday ordering (BUG-182)" below.

## Price OHLC + Open (candlestick foundation)

The CSV price wizard (`executePriceImport`) writes Open + OHLCV onto BOTH
`price` (per-bar history) and `latest_price` (max-date snapshot) so a
security without a live ticker — crowdlending, private equity — can drive
a candlestick chart purely from user-imported data. Six columns are wired
end to end:

- `priceColumnFields` (shared): `['date', 'close', 'open', 'high', 'low', 'volume']`.
- `requiredPriceColumns`: `['date', 'close']` (Open + OHLV stay optional).
- `NormalizedPriceRow.{open,high,low,volume}` — parsed in
  `executePriceImport`. `close`/`open`/`high`/`low` use the strict
  `parseNumber`; only `volume` calls `parseNumberWithSuffix` (BUG-161
  isolation, below).
- `PriceInsert.{open,high,low,volume}` — `mapPriceRows` scales price-shaped
  fields × 10^8 via `toPriceDb`; volume is stored as a raw integer (shares
  count, no scaling).
- INSERT SQL: `INSERT OR IGNORE INTO price (security, tstamp, value, open, high, low, volume) VALUES (?, ?, ?, ?, ?, ?, ?)`.
- latest_price sync: SELECT/INSERT on `(value, open, high, low, volume)`
  off the max-date row of the imported batch. `ON CONFLICT(security) DO
  UPDATE` overwrites every OHLC column from `excluded.*`.

### Schema posture

`price.{open,high,low,volume}` and `latest_price.{open,high,low,volume}`
are installed at runtime by `apply-bootstrap.ts > VENDOR_COLUMN_PATCHES`,
NOT declared in `bootstrap.sql`. Drizzle `schema.ts` declares them so the
service layer typechecks against the patched schema; the parity test
(`bootstrap-parity.test.ts > DRIZZLE_MISSING_ALLOWLIST`) allowlists the
divergence. See `.claude/rules/db-schema.md > Vendor column patches` for
the rationale (Gate 1 keeps `bootstrap.sql §1+§2` byte-equal with
ppxml2db; runtime ALTERs are the sanctioned extension surface).

### The class fix the patch closed

Before this work, `executePriceImport` wrote `price.{high,low,volume}` to
the `price` table — but no patch ever added those columns. The
prepared statement failed at prepare-time with
`SqliteError: table price has no column named high` on EVERY price
import, regardless of whether the user mapped OHLV columns or only Close.

The bug was invisible to CI because `createTestDb` in
`csv-import.service.test.ts` hand-rolls a parallel schema with OHLCV
already present. **All future CSV-pipeline tests that probe the schema
boundary MUST go through `applyBootstrap(sqlite)` on a fresh `:memory:`,
not `createTestDb`.** The regression block
`'executePriceImport — applyBootstrap parity'` in
`csv-import.service.test.ts` is the canonical example: it imports the
`applyBootstrap` helper and seeds the bare minimum security row directly,
so any future schema divergence between `apply-bootstrap.ts` and the CSV
writer surfaces immediately.

### Engine isolation invariant

Open + OHLCV are chart-display columns ONLY. Performance, MVE, Statement
of Assets, and rebalancing services key off `price.value` /
`latest_price.value` exclusively. Do NOT branch financial logic on
`open` / `high` / `low` / `volume`. The latest-price injection rule
(`.claude/rules/latest-price.md`) is unchanged — same-date intraday
beats historical snapshot via the `value` column, not OHLC.

### Read path — `GET /api/p/:pid/securities/:id`

The route emits Open + OHLCV alongside `value` on every `prices[]` row
so `PriceChart` can auto-switch to candlestick when the data carries
OHLC. Source of truth for the conversion convention:
`packages/api/src/services/unit-conversion.ts > convertPriceFromDb`
(price-scaled fields `/1e8`, volume passed through as a raw integer).
The handler at `packages/api/src/routes/securities.ts > getSecurity`
maps each drizzle row through this helper and emits
`{ date, value, open, high, low, volume }`, where price-shaped fields
are stringified Decimals matching the existing `value` convention and
volume is a JS number. Null on the wire = absent in the source row.

Web side is already shaped for this — `PriceChart.tsx > PricePoint`
declares the same six fields and `hasOhlc = prices.some(p => p.open != null)`
flips the series-type default to candlestick. The series-type toggle
(`ChartToolbar`) restricts itself to single-value options when
`hasOhlc` is false, so close-only securities (Yahoo-fetched, legacy
PP-XML) keep their line/area render.

### Tests that lock the read path

- `packages/api/src/__tests__/security-detail-ohlc.test.ts` —
  end-to-end supertest pin: portfolio + security created via the real
  API, OHLC seeded into the portfolio DB through `acquirePortfolioDb`,
  `GET /api/p/:pid/securities/:id` returns the six expected fields
  with correctly-scaled string values; close-only rows emit
  `open/high/low/volume = null`.

### Tests that lock the contract

- `packages/api/src/services/csv/csv-import.service.test.ts >
  executePriceImport — applyBootstrap parity` — proves the prod-schema
  path accepts close-only AND Open + OHLCV imports; persists the values
  on both `price` and `latest_price`.
- `packages/api/src/services/csv/csv-import.service.test.ts >
  executePriceImport > accepts volume column with M/B suffix (BUG-161)` —
  unchanged; pins the volume suffix gate.
- `packages/api/src/db/__tests__/bootstrap-parity.test.ts` — Gate 2:
  Drizzle declares the patched columns, allowlist documents the runtime
  install.

Any regression that drops a `VENDOR_COLUMN_PATCHES` entry, removes
columns from the INSERT/SELECT SQL, or stops the latest_price sync from
carrying Open + OHLC must make one of these suites go red first.

## Volume-suffix parsing (BUG-161)

Investing.com price-history CSVs use `K` / `M` / `B` shorthand suffixes in
the `Volume` column (`45.6M`, `1.23B`, `999K`). The price flow accepts them
via `parseNumberWithSuffix` in `packages/shared/src/csv/csv-normalizer.ts`.
The helper is opt-in: only `executePriceImport`'s volume-column reader
calls it; `close` / `high` / `low` still use the strict `parseNumber`.

**The trade flow (`parseTradeRow`) MUST NEVER call `parseNumberWithSuffix`.**
The same suffix in a `shares` or `amount` column would silently 1000× the
cost basis with no separate gate. The regression-guard test in
`csv-normalizer.test.ts > parseNumber regression` and the
`previewTradeImport` test in `csv-import.service.test.ts > BUG-161
regression guard` both pin this invariant; any future code that reaches
for `parseNumberWithSuffix` outside the price-volume path must make those
suites go red first.

## Default-Type inference (BUG-132)

When the user does NOT map the `type` column at column-map time,
`parseTradeRow` infers the transaction type per row using the
`inferTransactionType` helper (`packages/shared/src/csv/infer-type.ts`).
The rules mirror Portfolio Performance's Account-importer §1.2 inference
table:

| sign(amount) | hasSecurity | → inferred type |
|---|---|---|
| > 0 | yes | `DIVIDEND` |
| < 0 | yes | `REMOVAL` |
| > 0 | no  | `DEPOSIT` |
| < 0 | no  | `REMOVAL` |
| = 0 | any | `DEPOSIT` (fallback) |

`hasSecurity` is true when the row provides a non-empty `securityName`,
`isin`, or `ticker`. `sign(amount)` is read from the parsed-but-unsigned
amount (sign is stripped by Math.abs downstream in
`csv-trade-mapper.ts`, but parseTradeRow inspects it before that).

**Trigger condition is column-mapping-level, not cell-level.** When
`columnMapping` does not contain the `type` key, every row is inferred.
When `type` IS mapped but the cell is empty or unrecognized,
`UNKNOWN_TYPE` still fires — the strict path is preserved. This keeps
the user's intent unambiguous: omitting the column = "I want defaults",
mapping it = "I want strict validation".

**Account-mode rules are preferred over Portfolio-mode rules** (which
would infer SELL/BUY) because they are the more permissive shape for
typical broker exports that omit the Type column. PP's Portfolio-mode
rules require the two-mode wizard surface (BUG-127/128, deferred) to
let the user pick which inference set runs.

`type` is therefore NOT in `requiredTradeColumns`. The required set is
`['date', 'security', 'amount']`; the column-map step's "Next" gate
respects this without further work.

Tests that lock the contract:
- `packages/shared/src/csv/infer-type.test.ts` — pure-helper matrix
  coverage for every (sign × hasSecurity) cell.
- `packages/api/src/services/csv/csv-import.service.test.ts >
  Default-Type inference (type column unmapped)` — the four inference
  outcomes plus two strict-path negative cases (empty cell, garbage
  cell — both still UNKNOWN_TYPE when type column is mapped).

Any regression that reverts the column-mapping check, hardcodes a
default that ignores `(amount, hasSecurity)`, or re-adds `type` to
`requiredTradeColumns` must make those suites go red first.

## Same-day intraday ordering (BUG-182)

CSV trade imports persist the optional `time` column onto `xact.date` as
an ISO timestamp tail (`2025-03-14T15:48:00`). The schema column is
`VARCHAR(32)`; PP-XML imports already write this shape. Three load-bearing
invariants:

1. **Parse priority** (`csv-import.service.ts > parseTradeRow`):
   - If `date` column carries a `T`-tail or space-separated time,
     `parseDate({ keepTime: true })` preserves it.
   - Else if a separate `time` column is mapped, `combineDateAndTime`
     concatenates it with the day-granular date.
   - Else the bare `YYYY-MM-DD` is stored — same as pre-fix.
   - When BOTH a T-tail on the date column AND a separate `time` cell
     are present, the date-column tail wins. PP exports use the T-tail;
     the separate `time` column is for broker exports that split the
     two fields. Mixing both is rare and the tail-wins precedence keeps
     the more authoritative source.
2. **SQL ORDER tiebreaker**: every `ORDER BY x.date` read site adds
   `_order ASC, _id ASC` (or DESC equivalents) so same-day rows feed
   the engine in stable insertion order even when the time tail is
   absent. Five sites today: `performance.service.ts:386,1529`,
   `reports.service.ts:321`, `routes/accounts.ts:140`,
   `routes/transactions.ts:410`. Adding a sixth read site for xact
   requires the same tiebreaker.
3. **Dedupe fingerprint**: `idx_xact_csv_natural_key` and
   `cleanupCsvDuplicates` both key on `substr(date,1,10)` so pre-fix
   day-only rows and post-fix timestamped rows produce identical
   fingerprints. Intraday-distinct duplicates within the same day +
   same shape are NOT deduped — acceptable; same-day same-amount
   same-shares same-security duplicates from a single broker are
   already vanishingly rare.

### Engine isolation

`computeAllSecurities` wraps each `computeSecurityPerfInternal` call in
a try/catch and emits `emptySecurityPerf(securityId)` on throw. One bad
security must not blank the whole securities-performance table; the
throw is logged server-side via `console.error`. Future writes to
`computeAllSecurities` must preserve this isolation — extracting the
per-security loop into a separate function is fine, removing the catch
is a regression vector. DB-level errors from
`projectTransactionsToSecurityCurrency` are deliberately OUTSIDE the
try; those are systemic infrastructure failures that must propagate.

### Tests that lock the contract

- `packages/api/src/services/__tests__/performance-same-day-ordering.test.ts`
  — same-day BUY+SELL ordering + per-security throw isolation.
- `packages/shared/src/csv/csv-normalizer.test.ts` — `parseDate`
  `keepTime` matrix + `combineDateAndTime` edge cases.
- `packages/api/src/services/csv/csv-import.service.test.ts` — ISO
  timestamp persistence on `xact.date` when `time` column is mapped.
- `packages/api/src/db/__tests__/bootstrap-csv-dedupe.test.ts` —
  upgrade-path dedupe (day-only existing + timestamped incoming).

Any regression that strips the time tail at the CSV boundary, removes
the SQL tiebreaker from any read site, reverts the dedupe expression to
raw `date`, or removes the per-security try/catch in
`computeAllSecurities` must make one of these suites go red first.

## Per-row account routing (BUG-126)

CSV trade imports accept four optional per-row account columns:
`account`, `securitiesAccount`, `offsetAccount`, `offsetSecuritiesAccount`.
Cell values are NAME strings (case-insensitive trimmed match against
`account.name`); blank cells fall back to the wizard's top-panel
`targetSecuritiesAccountId` (and its `referenceAccountId` for the cash
side). One CSV that interleaves rows for several brokers / portfolios
is now importable in a single pass — the bug class this rule closes is
the user having to pre-split a multi-broker export.

### Server — error codes added

| Code                     | Status | Meaning |
|--------------------------|--------|---------|
| `INVALID_ACCOUNT_NAME`   | 400    | Cell present, 0 matches in target account-type set. |
| `AMBIGUOUS_ACCOUNT_NAME` | 400    | Cell present, ≥2 matches in target type. Carries `count` on the RowError so the locale string can interpolate "matches N accounts". |
| `WRONG_ACCOUNT_TYPE`     | 400    | Resolves uniquely but to wrong type (e.g. `securitiesAccount` cell that resolves to a deposit, or vice versa). |
| `MISSING_ACCOUNT`        | 400    | Required-when cell blank: `TRANSFER_BETWEEN_ACCOUNTS` missing source/dest, `SECURITY_TRANSFER` missing dest. |

### Server — gate locations

- **`csv-import.service.ts > resolveAccountNames`** runs ONE batched
  `SELECT uuid, name, type FROM account WHERE type=? AND LOWER(TRIM(name)) IN (...)`
  per type-class (deposit / portfolio). Returns `{account: Map, portfolio: Map, errors: AccountResolveError[]}`.
- **`csv-import.service.ts > collectAccountResolveErrors`** consumes the
  resolved map, runs the per-cell `WRONG_ACCOUNT_TYPE` cross-check
  (a name that resolves uniquely in the wrong type-scope wins over an
  INVALID/AMBIGUOUS verdict from the expected scope), and emits the
  per-type `MISSING_ACCOUNT` invariants for transfer rows.
- **`csv-import.service.ts > previewTradeImport`** calls the helper and
  surfaces row errors through the standard preview wire shape.
- **`csv-import.service.ts > executeTradeImport`** runs the same resolve
  pass + **hard-aborts** before opening the SQLite transaction if any
  account-class error remains. Same posture as the FX hard-abort —
  **deliberate divergence** from `MISSING_SHARES`/`MISSING_SECURITY`
  soft-skip; partial routing leaves the portfolio silently incomplete
  and the wizard has no mid-flight repair surface for an account
  routing failure.

### Mapper — per-row routing

`csv-trade-mapper.ts` consumes resolved UUIDs via the row's
`accountUuids: { account?, securitiesAccount?, offsetAccount?,
offsetSecuritiesAccount? }` field (mutated onto the row by
`attachAccountUuids` after the resolve pass) and routes `xact.account`
per row. Falls back to the file-level `targetSecuritiesAccountId` (and
its `referenceAccountId` for cash-side) when a slot is blank. Per-type
matrix:

| Type | xact #1 (sec-side) | xact #2 (cash-side) | crossAccount |
|------|--------------------|---------------------|--------------|
| BUY/SELL | `accountUuids.securitiesAccount ?? targetSecuritiesAccountId` | `accountUuids.account ?? referenceAccountId` | — |
| DEPOSIT/REMOVAL/INTEREST/FEES/TAXES (and refunds/charges) | — | `accountUuids.account ?? referenceAccountId` | — |
| DIVIDEND | `accountUuids.securitiesAccount ?? targetSecuritiesAccountId` | `accountUuids.account ?? referenceAccountId` | — |
| DELIVERY_INBOUND/OUTBOUND | `accountUuids.securitiesAccount ?? targetSecuritiesAccountId` | — | — |
| TRANSFER_BETWEEN_ACCOUNTS | — | `accountUuids.account` (required) | `accountUuids.offsetAccount` (required) |
| SECURITY_TRANSFER | `accountUuids.securitiesAccount ?? targetSecuritiesAccountId` | — | `accountUuids.offsetSecuritiesAccount` (required) |

### Legacy `crossAccount` — removed

The pre-BUG-126 `crossAccount` field key (read from a CSV cell expected
to be a raw account UUID — effectively unusable for normal users) is
removed entirely. No deprecation window: the new per-row name-resolved
columns replace it cleanly. Saved `vf_csv_import_config` rows that
referenced it are stripped at bootstrap by
`apply-bootstrap.ts > cleanupCsvConfigsCrossAccount` (idempotent,
warns once per touched row, defensive against malformed JSON). The
`MISSING_CROSS_ACCOUNT` error code is replaced by `MISSING_ACCOUNT`
(broader; the `column` field on the RowError distinguishes which
slot was missing).

### Tests that lock the contract

- `packages/shared/src/csv/csv-autodetect.test.ts > per-row account columns` —
  8-lang × 4-col alias coverage.
- `packages/api/src/services/csv/csv-import.service.test.ts >
  resolveAccountNames` — case-insensitive trim, ambiguity detection,
  single-prepared-statement-per-type assertion.
- `packages/api/src/services/csv/csv-import.service.test.ts >
  previewTradeImport — per-row account routing` — emits all 4 codes
  correctly; blank + top-panel default falls back; per-row wins over
  default.
- `packages/api/src/services/csv/csv-import.service.test.ts >
  executeTradeImport — per-row account hard-abort` — partial bad batch
  aborts pre-transaction; clean batch persists per-row routing.
- `packages/api/src/services/csv/csv-import.service.test.ts >
  executeTradeImport — end-to-end multi-broker` — single CSV, 2
  portfolios + 2 deposits, BUYs route to correct accounts via per-row
  columns.
- `packages/api/src/services/csv/csv-trade-mapper.test.ts > Group A/D/E` —
  BUY/SELL uses per-row UUIDs; fallback to default works; transfers
  use offset slots.
- `packages/api/src/db/__tests__/bootstrap-csv-config-cleanup.test.ts`
  — cleanup helper strips legacy `crossAccount` from saved configs.

Any regression that re-introduces the `crossAccount` field key, drops
the per-type required-when invariants, weakens the hard-abort to
soft-skip, or removes the resolve-pass batching must make one of these
suites go red first.
