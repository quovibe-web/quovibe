# Multi-Currency Valuation — Engine Invariants

## Scope

This document pins the contract for cross-currency cost basis, market value,
unrealized gain, and TTWROR/IRR at the **per-security** level (Phase 1) AND
the **portfolio-level** aggregation (Phase 2: Dashboard hero, Statement of
Assets totals, Investments table base totals). See "Phase 2 — Portfolio-Base
Rollup" at the bottom of this doc.

## Upstream source-verified

All conventions below were verified against the upstream Java reference
implementation (audit 2026-05-17). Local audit notes are kept in a
gitignored working folder (see `ADR-017-multi-currency-portfolio-base-rollup.md`
for the conceptual summary; the line-level upstream citations are not
published).

Key upstream contracts (paraphrased; reproduced as observed semantics, not
verbatim source):

- The currency converter is a per-date multiplicative operation:
  `termAmount = rate(date) × foreignAmount` with HALF_DOWN rounding.
  Same-currency lookup returns rate = 1.0.
- Portfolio-level aggregation refuses mixed-currency summation: every
  per-security value is converted to the term (base) currency BEFORE
  it is added to the running total.
- Cost basis (FIFO / moving-average) is per-tx trade-date FX weighted in
  the term currency: each BUY is converted to term ccy at its own date
  before being added to the running total. There is no
  "per-security native" intermediate state at the calculation layer.
- Market value is converted at the period-end (reporting-date) rate.
- Cashflows (dividends, transfers, earnings) are converted at each
  transaction's own date before flowing into the portfolio TTWROR / IRR
  calculation.

QuoVibe's Phase 1 + Phase 2 implement mathematically equivalent semantics with
one architectural divergence: the upstream tool computes everything in term
ccy from the calculation layer onwards; QuoVibe keeps per-security in
security ccy and projects to base at the aggregation site (Phase 2 fix) +
wire layer.

## Background

Until 2026-05-16 the perf engine had **zero currency awareness**. Every
`xact.amount` value was consumed as a unitless scalar regardless of native
currency. Five drop points existed:

1. `performance.service.ts > fetchAllTransactions` (`GROUP_CONCAT` of
   `xact_unit` rows) emitted only `(type, amount)` pairs — `forex_amount`,
   `forex_currency`, `exchangeRate` were silently discarded.
2. `parseRawRow` hard-coded `fxAmount: null, fxCurrencyCode: null,
   fxRate: null` on every `TransactionUnit`.
3. `engine/helpers/transaction-amounts.ts > getGrossAmount` read
   `tx.amount` (deposit currency) and added/subtracted FEE/TAX `amount`
   (also deposit currency). No branch on FOREX.
4. `cost/fifo.ts` and `cost/moving-average.ts` produced
   `pricePerShare = (grossAmount + fees) / shares` in deposit currency
   and then computed
   `unrealizedGain = totalShares × currentPrice − purchaseValue`
   where `currentPrice` came from `price.value` in **security** currency.
   Result: EUR − USD mixed arithmetic.
5. `computeDailyMarketValues` produced `shares × price.value` in
   **security** currency; `resolveSecurityCashflows` produced cashflows
   from `xact.amount` in **deposit** currency. TTWROR's `Eq 3`
   `(MVE + CFout) / (MVB + CFin)` mixed the two.

The user-visible symptom — *"Purchase Value 1,173.20 US$ but the BUYs were
paid 366.60 € + 806.60 € = 1,173.20 €"* — is the FIFO output emitted from
EUR-summed `grossAmount` and then labelled with `security.currency` by the
UI.

The "Update Prices corrupts" symptom (Zegona GBP, BUG-127 family) is the
**same** root cause from the other side: a refreshed native-currency MV
grows correctly while cost stays raw-EUR-mislabelled, so the unrealized
delta inflates. There is no separate write-path bug.

## Architectural axis: security-native

Per-security FIFO/MA, MV, TTWROR, and IRR all compute in
`security.currency`. The pre-existing UI emits `security.currency` as the
label for every per-security number (`/api/securities/:id`,
`/api/performance/securities`); making the math match the label is the
smallest blast radius that closes the bug.

Conversion to portfolio base currency is a separate concern handled at
aggregation sites (Dashboard hero totals, Statement of Assets per-class
breakdown) and is **not part of this work**.

This matches the upstream reference tool's "Forex view" projection. the upstream tool's default
internal computation uses `the upstream currency converter` with the portfolio's term
currency, but the Forex view re-projects to security currency. Quovibe's
current UI label convention is already security-native; aligning the math
gives a upstream-equivalent per-security surface.

## Wire convention

The `xact_unit` table carries cross-currency information on three columns
already present in ppxml2db's vendor schema:

```sql
CREATE TABLE xact_unit(
  xact         VARCHAR(36) NOT NULL REFERENCES xact(uuid),
  type         VARCHAR(16) NOT NULL,   -- 'GROSS_VALUE' | 'FEE' | 'TAX'
  amount       BIGINT NOT NULL,         -- deposit-currency hecto-units
  currency     VARCHAR(16) NOT NULL,    -- deposit currency code
  forex_amount BIGINT,                  -- security-currency hecto-units (NULL when same-ccy)
  forex_currency VARCHAR(16),           -- security currency code
  exchangeRate VARCHAR(16)              -- 'deposit per security' multiplicative
);
```

the upstream tool's `<unit type="GROSS_VALUE">` element carries the deposit-currency
gross in `<amount>` and the security-currency gross in `<forex>`. the upstream tool's
`exchangeRate` convention is **deposit-per-security multiplicative**:
`amount_deposit × exchangeRate = forex_amount_security` (matches
`packages/api/src/services/transaction.service.ts:271-281` which emits
the same shape on JSON ingest).

For same-currency BUY/SELL, the upstream tool omits the `GROSS_VALUE` unit entirely.
ppxml2db copies the unit verbatim, so:

- **Cross-currency BUY** from upstream XML → has `xact_unit` row with
  `type='GROSS_VALUE'`, `forex_amount != NULL`, `forex_currency` set.
- **Same-currency BUY** from upstream XML → has no `GROSS_VALUE` row;
  `xact.amount` already lives in `security.currency`.
- **Cross-currency BUY** from quovibe JSON form → emits `GROSS_VALUE`
  row identically.
- **Cross-currency BUY** from CSV (BUG-121) → emits `GROSS_VALUE` row
  identically via `csv-trade-mapper.ts`.

The single source of truth for the rate direction is
`packages/shared/src/csv/csv-fx.ts > ppRateToQvRate`. CSV stores in the
qv-convention; both JSON and ppxml2db paths store in the
deposit-per-security upstream-native convention. **A `GROSS_VALUE` unit's
`exchangeRate` is therefore upstream-native, and `amount × rate = forex_amount`
holds for every emission path.**

## Security-currency gross resolution

For per-security math the engine needs the **security-currency** gross
for every BUY / SELL / DELIVERY_INBOUND / DELIVERY_OUTBOUND / DIVIDEND.
Resolution priority (single source of truth:
`packages/engine/src/helpers/transaction-amounts.ts > getSecurityCurrencyGross`):

1. **GROSS_VALUE unit with `forex_amount` set** — use `forex_amount`
   directly. This is the upstream-native path for cross-currency trades.
2. **Same-currency trade** (deposit ccy = security ccy) — use `xact.amount`
   (with the usual `± fees ± taxes` reconstruction for ppxml2db's
   amount-is-net convention).
3. **Backfill from `vf_exchange_rate`** — for trades imported BEFORE this
   work that are cross-currency but lack a `GROSS_VALUE` FOREX row, the
   service layer pre-computes the security-currency gross by looking up
   `getRate(sqlite, deposit_ccy, security_ccy, trade_date)` from
   `vf_exchange_rate` and multiplying. The rate is forward-filled across
   business-day gaps (per `getRate`'s existing semantics) and the
   triangulated cross-rate fallback applies for non-EUR pairs.
4. **Unresolvable** — no FOREX unit AND no `vf_exchange_rate` entry for
   the pair on the trade date. The engine emits the transaction with
   `securityCurrencyGross = null` and the consumer (performance service)
   filters the security out of per-security perf with a warning logged.
   The UI surface for the unresolved set is a follow-up (yellow badge +
   manual rate entry) tracked under the multi-currency milestone.

## Engine contract changes

### `getGrossAmount` family

`packages/engine/src/helpers/transaction-amounts.ts` gains a parallel
helper:

```ts
export function getSecurityCurrencyGross(
  tx: TransactionWithUnits,
  securityCurrency: string | null,
): Decimal | null;
```

Returns the security-currency gross (priority 1 → 2 → 3 above) or `null`
when unresolvable. `getGrossAmount` is retained unchanged for the
deposit-currency path (used by `getDepositBalance`, `cashImpact`, daily
cash map — all of which MUST stay in deposit currency).

### FIFO / Moving-Average input

`CostTransaction.grossAmount` continues to be a `Decimal` but its **unit
is now `security.currency`** when the caller is per-security perf. The
type is unchanged; only the call site convention shifts. The single call
site that needs to switch is
`packages/api/src/services/performance.service.ts > toCostTransactions`.

### TTWROR / IRR cashflows

`resolveSecurityCashflows` produces per-security cashflows. Its outputs
must be in `security.currency`. The cashflow rules in
`packages/engine/src/cashflow/security-level.ts` resolve BUY/SELL/DIVIDEND/
DELIVERY_IN/OUT amounts from `tx.amount` today; they switch to
`getSecurityCurrencyGross(...)`. Daily MV already emits security-currency
values, so `Eq 3` is unit-consistent post-fix.

### Daily MV (unchanged)

`computeDailyMarketValues` continues to emit `shares × price.value` where
`price.value` is in `security.currency`. No change required.

### Currency-gains module (existing)

`packages/engine/src/fx/currency-gains.ts` already computes the split of
total return into native return + FX return. This module is unaffected
by the per-security-native shift; if anything, it becomes more useful
once the upstream cost basis is unit-consistent.

## Migration

`packages/api/src/db/apply-bootstrap.ts` gains a helper
`backfillCrossCurrencyGrossUnits(db)` that runs once per `applyBootstrap`
call:

```
1. SELECT every BUY/SELL/DIVIDEND/DELIVERY_INBOUND/DELIVERY_OUTBOUND
   where security IS NOT NULL AND xact.source = 'PPXML2DB_IMPORT'
   AND (security.currency, xact.currency) differ
   AND no xact_unit row of type 'GROSS_VALUE' exists.
2. For each such xact:
   - rate = getRate(db, xact.currency, security.currency, trade_date)
   - if rate is null → log warning, skip
   - forex_amount_hecto = round(xact.amount × rate)
   - INSERT INTO xact_unit (xact, type, amount, currency,
       forex_amount, forex_currency, exchangeRate)
     VALUES (xact.uuid, 'GROSS_VALUE',
       xact.amount, xact.currency,
       forex_amount_hecto, security.currency,
       rate.toString())
3. Wrap in db.transaction(); log summary
   '[multi-currency-backfill] inserted N rows, skipped M (unresolved)'.
4. Idempotent — the type='GROSS_VALUE' check ensures re-runs are no-ops.
```

The migration runs on every boot but the SELECT is fast (indexed on
`xact.security` + `xact.source`) and the inner loop only fires when a
cross-currency upstream XML trade exists without a FOREX unit. Steady-state
cost is O(0).

### Out-of-scope migration cases

- **Pre-2024 vf_exchange_rate gap** — if the user's portfolio contains
  trades older than the earliest cached ECB rate, the backfill logs and
  skips. The UI surface for resolving these is the follow-up "manual
  rate entry" feature.
- **CSV imports without `Exchange Rate` column** — BUG-121 already
  enforces `FX_RATE_REQUIRED` at preview time, so cross-currency CSV
  trades already carry a `GROSS_VALUE` unit. No backfill needed.
- **Manual JSON-form cross-currency trade with cleared FOREX unit** —
  the JSON path's `enforceCrossCurrencyFxRate` middleware blocks
  cross-currency writes without `fxRate`. Cleared FOREX units would
  only result from a SQL-level manual edit; out of scope.

## Tests that lock the contract

The regression suite at
`packages/engine/src/__tests__/regression/multi-currency-perf-regression.test.ts`
pins three scenarios:

1. **USD security in EUR portfolio (with historical EUR buy transactions)** —
   the user's reported case. 1 share for 366.60 EUR at rate 1.10, 2 shares
   for 806.60 EUR at rate 1.05, current price 482.70 USD. Expected:
   - cost_USD = 366.60 × 1.10 + 806.60 × 1.05 = 1,250.19 USD
   - MV_USD = 3 × 482.70 = 1,448.10 USD
   - unrealized_USD = 197.91 USD
2. **GBP security in EUR portfolio (Zegona-shaped)** — 100 shares for
   1,200 EUR at rate 0.86, current price 12.50 GBP. Expected:
   - cost_GBP = 1,200 × 0.86 = 1,032 GBP
   - MV_GBP = 100 × 12.50 = 1,250 GBP
   - unrealized_GBP = 218 GBP
3. **GBp minor-unit regression** — proves the previous GBp/GBP fix is
   not regressed: GBP security with `price.currency = 'GBp'` source
   normalized to GBP × 100 in storage; cost/MV/unrealized all in GBP
   units, never 100× inflated.

Any regression that drops FOREX-unit awareness from `getSecurityCurrencyGross`,
reverts `toCostTransactions` to deposit-currency, drops the
`backfillCrossCurrencyGrossUnits` helper, or stops `resolveSecurityCashflows`
from consuming security-currency cashflows must make one of these suites
go red first.

## Follow-up: per-request rate caching

`projectTransactionsToSecurityCurrency` calls `fx.service.getRate` once per
unresolved cross-currency transaction. For a portfolio with N such trades
on a single perf request, that is N prepared-statement executions against
`vf_exchange_rate`. Acceptable today (vf_exchange_rate is small + indexed,
and per-portfolio perf requests are not in a hot loop), but the follow-up
optimisation is to pre-load a `RateMap` per (depositCurrency, securityCurrency)
pair using the existing `fx.service.buildRateMap` once per
`computeAllSecurities` invocation, then have the projection look up by
date from the map.

## Follow-up: portfolio-base aggregation

Out of scope for this work — tracked as a separate milestone:

- `getStatementOfAssets` per-security MVs aggregated to portfolio base
  via daily FX from `buildRateMap`.
- Dashboard hero totals: same.
- Taxonomy aggregation: per-class totals in portfolio base.
- Benchmark + rebalancing services: portfolio-base normalisation.
- UI "Forex / Base view" toggle: mirrors the upstream tool's panel.

The wire shape from `/api/securities/:id` and `/api/performance/securities`
is unchanged by the follow-up — per-security values remain in
`security.currency`. The aggregation pass adds new fields in
`security.currency` (the today's view) AND `portfolio.baseCurrency` (the
roll-up view), keeping the per-security contract documented here stable.

---

## Phase 2 — Portfolio-Base Rollup (in progress, 2026-05-17)

Phase 1 left `sr.mvb/mve/unrealized/realized/dividends/fees/taxes` in
**security currency**. The rollup loop in `getPortfolioCalc:1564-1578` summed
them raw into `totalMVB/totalMVE`, then added cash in deposit ccy. For a
USD security in an EUR portfolio with €188.53 cash + $965.40 sec MV, the
hero showed €1153.93 — mixed-unit sum. TTWROR blew up to 401% (BUY-day
factor degenerate with sec-side MV jumping in USD-treated-as-EUR while
cash dropped in EUR); IRR diverged to 1e24%.

### Fix architecture (upstream-aligned)

| Layer | Phase 2 change |
|---|---|
| DB | `vf_portfolio_meta.baseCurrency` allowlisted key. Auto-seeded from primary deposit at bootstrap. ISO-4217 validated. |
| Service: portfolio-base | New `portfolio-base.service.ts` — single source of `getPortfolioBaseCurrency` + `setPortfolioBaseCurrency`. Three local copies in `performance.service.ts`, `benchmark.service.ts`, `fx-fetcher.service.ts` collapsed to imports. |
| Service: per-tx projection | New `projectTransactionsToBaseCurrency` helper (mirror of Phase 1's `projectTransactionsToSecurityCurrency`). Priority: same-ccy → `GROSS_VALUE` FOREX leg → `vf_exchange_rate` lookup → unresolved (security tx dropped + tagged, cash tx kept + logged). |
| Service: cost-base | New `computeSecurityCostInBase` helper. Per-BUY: `unit.amount × FX(depositCcy → base, tx.date)` summed over cash-side BUYs of the security. Strict upstream per-tx trade-date FX (matches `the upstream cost calculation source`). |
| Service: aggregation loop | `getPortfolioCalc` loop at line ~1564 converts `sr.mvb/mve/unrealized/realized/dividends/fees/taxes` to base via `toBaseAtDate(amount, secCcy, base, rateMaps, period.start_or_end)` BEFORE accumulating. Unresolved (no rate) excluded from rollup, tagged in `unresolvedSecurityIds`. **Load-bearing fix.** |
| Service: cashflow paths | `getPortfolioCalc`, `getCalculationBreakdown`, `getReturnsHeatmap` consume `projectTransactionsToBaseCurrency`-rewritten txs before `resolvePortfolioCashflows` + `appendTransferCashflows`. |
| Service: deposit balances | Per-account FX conversion before sum (multi-deposit-ccy support). Period-boundary FX. |
| Service: Statement of Assets | Already FX-aware per security MV; adds `unresolvedSecurityIds + unresolvedCount` to totals; per-account cash balance conversion. |
| Engine | No source changes. Pre-existing `resolvePortfolioCashflows` + `computeIRR` + `computeTTWROR` correctly consume single-ccy inputs. New regression test only. |
| Wire | Additive `*Base` fields per `SecurityPerfResponse` row + `baseCurrency` + `unresolvedSecurityIds + unresolvedCount` on portfolio + statement totals. Per-security native fields unchanged. |

### Resolution priority for trade-date FX (`projectTransactionsToBaseCurrency`)

1. Same currency (`xact.currency === baseCurrency`) → passthrough.
2. `GROSS_VALUE` unit with `forex_currency === baseCurrency` AND `forex_amount`
   set → use `forex_amount` directly (upstream-native cross-currency wiring).
3. `getRateFromMap(rateMaps.get(xact.currency), tx.date)` → multiply.
4. Unresolvable: if `securityId` is set → tag in `unresolvedSecurityIds`,
   drop tx. Else (cash) → keep tx with warning.

### UI display convention (upstream-aligned, user-confirmed 2026-05-17)

| Surface | Primary | Secondary |
|---|---|---|
| Dashboard hero, Detail metric widgets | base | — |
| Statement of Assets totals | base | — |
| Investments table per-row MV / Cost / Unrealized / Realized / Dividends | base | — |
| Investments table per-row Quote price | native | — |
| Investments totals row | base | — |
| SecurityDrawer Cost / MV / Unrealized / Realized / Dividends | base | muted native |
| SecurityDrawer Quote price | native | — |
| Security Detail page top values | native (Phase 1 invariant) | — |

Forex-view toggle (swap primary base ↔ native per surface) is the
Branch B follow-up.

### Unresolved-FX policy (Q6 three-layer)

1. **New writes** — already blocked by `enforceCrossCurrencyFxRate`
   route middleware + CSV `FX_RATE_REQUIRED`. Unchanged in Phase 2.
2. **Legacy read path** — affected securities filtered out of rollup
   totals. `unresolvedSecurityIds + unresolvedCount` surfaced on wire.
   Web renders yellow Alert badge on Investments + Statement headers.
   Per-security drilldown still shows the security with native-ccy
   values for visibility.
3. **Manual FX rate entry UI** in Portfolio Settings — Branch B
   follow-up.

### Migration

`seedPortfolioBaseCurrency(db)` runs once per portfolio on first
`applyBootstrap` after deploy. Idempotent. Picks primary-deposit ccy
(fallback: first security ccy → 'EUR'). Zero re-import friction; user
can later override via Portfolio Settings UI (Branch B).

### Out of scope (Branch B follow-up)

- Portfolio Settings UI to edit `baseCurrency`.
- Manual FX rate entry UI for resolving unresolved pairs.
- Forex-view toggle to swap base ↔ native default per surface.
- Multi-deposit-currency UI polish (currency picker on portfolio
  creation, native-ccy badges per deposit account row).
