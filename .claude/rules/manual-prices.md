globs: packages/api/src/services/manual-prices.*,packages/api/src/routes/securities.ts,packages/web/src/api/use-manual-prices.*,packages/web/src/components/domain/PriceHistorySection.*,packages/web/src/components/domain/price-history-form.schema.*
---
# Manual Price Entry Rules

Mirrors Portfolio Performance's "Historical Quotes" panel 1:1 (manual
add/edit/delete + "create historical quotes from transactions").

## Invariants

- **One write/sync core.** Every manual op (`upsertPrice`, `editPrice`,
  `deletePrices`, `deleteAllPrices`, `derivePricesFromTransactions` in
  `packages/api/src/services/manual-prices.service.ts`) ends by calling
  `syncLatestPriceFromGlobalMax(sqlite, securityId)` (exported from
  `prices.service.ts`). Never hand-roll a latest_price write — deleting the
  max-date row must move latest_price down; deleting all rows must clear it
  (stale-orphan bug class).
- **No `source` column.** The `price` table stays vendor-shaped; manual, feed,
  and derived rows are indistinguishable and overwrite each other by date —
  this matches PP, which has no source tracking. Feed-wins on refresh; a manual
  row with NULL open on a Yahoo security can be wiped by the OHLC-backfill
  replace path (`prices.service.ts`). Manual entry's safe home is no-feed
  securities. If manual-sacred is ever genuinely needed, the sanctioned
  location is a quovibe-owned `vf_price_source` table consulted only in the
  merge path — NOT a vendor-column patch.
- **Derived price is gross-per-share, NOT amount/shares.** Reconstruct via the
  engine helper `getSecurityCurrencyGross(tx, securityCurrency)`; divide by
  `shares / 1e8`. `xact.amount` is packed cash (gross +/- fees +/- taxes);
  naive division bakes fees into the quote. Cross-currency trades with no
  resolvable rate are skipped and counted, never written with a wrong-currency
  value.
- **Derive overwrites existing same-date quotes** (PP precedence) and writes
  close only (a single trade has no OHLC bar).
- **Read path is unfiltered.** `GET .../securities/:id/prices` returns raw rows
  (no trading-day calendar filter) so off-calendar manual prices always show,
  matching PP. The calendar-filtered `getSecurity` `prices[]` stays the chart's
  source.
- **Edit replaces the whole row.** `editPrice` rewrites all columns; the edit
  form pre-populates OHLCV from the existing row so editing the close value
  never wipes CSV-imported bar data.
- Every write route goes through the service layer (G14); bodies validated with
  `manualPriceSchema` / `deletePricesSchema` from `@quovibe/shared`. The
  client-side form schema is a separate all-strings schema
  (`price-history-form.schema.ts`) with translated (t()) messages — NOT the
  wire schema, which rejects the empty optional inputs an HTML form produces.

## Tests that lock the contract

- `packages/api/src/services/__tests__/manual-prices.service.test.ts` — gross-
  per-share (fees excluded), cross-ccy via FOREX unit, overwrite precedence,
  skip-count, latest_price re-sync on edit/delete/delete-all.
- `packages/api/src/services/__tests__/sync-latest-price.test.ts` — the shared
  sync helper (upsert max / move-down / clear on empty).
- `packages/api/src/__tests__/manual-prices-routes.test.ts` — CRUD + derive +
  unfiltered GET (weekend row survives the calendar filter).
- `packages/shared/src/schemas/manual-price.schema.test.ts` — positive-value +
  date-format + empty-delete-array gates.
- `packages/web/src/components/domain/__tests__/price-history-form.schema.test.ts`
  — form-schema validation matrix + toWirePayload + rowToFormValues round-trip.

Any regression that adds a `source` column, hand-rolls latest_price, derives
`amount/shares`, filters the raw GET by calendar, or stops the edit form
pre-populating OHLCV must make one of these suites go red first.
