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

PP CSV exports include three columns quovibe accepts in column mapping but
does not store:

- `WKN` — German-broker security identifier. Not in §1+§2 vendor schema
  (no `security.wkn` column today). Adding one is blocked by ADR-015 and
  out of scope for this work.
- `Time` — HH:MM intraday timestamp. The canonical `date` column wins.
- `Date of Quote` — alternate spelling of `date` for price-import flow;
  ignored on trade flow when the canonical `date` is mapped.

These columns are wire-accepted (parse-and-discard in
`csv-import.service.ts > parseTradeRow`) and 8-language `HEADER_ALIASES`
entries exist in `csv-autodetect.ts`. Re-importing a PP export that
includes them no longer fails the column-required pre-check.
