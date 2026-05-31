# ADR-017: Portfolio-Base Rollup Convention (Multi-Currency Phase 2)

**Status:** accepted
**Date:** 2026-05-17
**Supersedes:** —
**Related:** [ADR-014 — `vf_exchange_rate` cache](./ADR-014-multi-currency.md), [ADR-015 — DB Bootstrap & Portfolio Lifecycle](./ADR-015-db-bootstrap-architecture.md), [ADR-016 — Portfolio-Scoped State Locality](./ADR-016-portfolio-scoped-state-locality.md)

## Context

Phase 1 of multi-currency support (committed on `feature/multi-currency-perf`)
made **per-security** performance math currency-aware: FIFO / moving-average,
market value, TTWROR, and IRR now compute in `security.currency`. The pre-existing
per-security UI surfaces (`/api/securities/:id`, `/api/performance/securities`)
already labelled every per-security number with the security's currency, so making
the math match the label was the smallest blast radius to close the visible bug
class ("Purchase Value 1,173.20 US$ but the BUYs were paid 366.60 € + 806.60 €").

Phase 1 explicitly deferred **portfolio-level aggregation** as a follow-up:

> "Conversion to portfolio base currency is a separate concern handled at
> aggregation sites (Dashboard hero totals, Statement of Assets per-class
> breakdown) and is not part of this work."

That deferral became the next bug. The rollup loop in
`getPortfolioCalc` (`performance.service.ts:1564-1578`) summed
per-security `mvb / mve / unrealizedGain / realizedGain / dividends / fees / taxes`
**raw** into `totalMVB` / `totalMVE`, then added cash balances (in deposit
currency). For a USD security in an EUR-base portfolio with €188.53 cash +
$965.40 sec MV, the dashboard hero displayed **€1153.93** — a mixed-unit sum
(EUR cash + USD security MV labelled as EUR). The downstream `computeTTWROR` /
`computeIRR` consumed the same mixed-unit `totalMVB / totalMVE` and produced
visible nonsense: TTWROR 401%, IRR 4.96 × 10²⁴%.

Diagnostically, the root cause is a missing **base-currency projection** at the
aggregation site. Mathematically, the entire portfolio rollup pipeline must run
in a single currency for TTWROR / IRR / MV totals to be meaningful.

Reference audit (upstream Java implementation, 2026-05-17): the upstream tool
addresses this by converting every per-security value to the term (base)
currency BEFORE accumulating. The upstream's `MoneyCollectors.sum(termCurrency)`
literally refuses to aggregate mixed-currency values — it is a compile-time-loud
constraint. Cost basis is per-tx trade-date FX weighted in term currency from
the calculation layer onwards; there is no per-security-native intermediate
state in upstream math.

## Decision

Phase 2 establishes the following invariants:

### 1. Portfolio base currency is a first-class concept

Every portfolio carries a **base currency** stored in
`vf_portfolio_meta.baseCurrency` (allowlisted key, ISO-4217 validated). The
value is auto-seeded at bootstrap (`apply-bootstrap.ts > seedPortfolioBaseCurrency`)
from the primary deposit account's currency (fallback chain: primary deposit →
first security currency → `EUR` literal). The single source of truth for
read / write access is `packages/api/src/services/portfolio-base.service.ts`
(`getPortfolioBaseCurrency` + `setPortfolioBaseCurrency`).

Three previously-duplicated local copies of `getBaseCurrency` in
`performance.service.ts`, `benchmark.service.ts`, and `fx-fetcher.service.ts`
are collapsed to imports from the single source.

### 2. Per-security base projection at the aggregation site

The rollup loop in `getPortfolioCalc` converts each `sr.{mvb, mve,
unrealizedGain, realizedGain, dividends, fees, taxes}` to base currency BEFORE
accumulating, using period-start FX for `mvb` and period-end FX for everything
else (statement-date snapshot). Per-security values that cannot be converted
(missing rate at period boundary) are excluded from the rollup and tagged in
`unresolvedSecurityIds`.

Cash balances per deposit account are converted to base currency BEFORE
summing into `totalMVE` / `totalMVB` (multi-deposit-currency support).

### 3. Cost basis: per-tx trade-date FX (strict reference convention)

Cost-in-base is computed via a new `computeSecurityCostInBase` helper that
walks each BUY's cash-side row and applies trade-date FX:
`unit.amount × FX(depositCcy → base, tx.date)`. For
single-deposit-currency portfolios where `depositCcy === baseCcy`, this
collapses to `unit.amount` directly (the deposit-side amount IS the base-ccy
cost). For multi-deposit portfolios it walks via `rateMaps.get(depositCcy)`.
This matches the upstream's per-tx weighted cost-in-term-ccy from
the calculation layer.

### 4. Cashflows: pre-projected to base via `projectTransactionsToBaseCurrency`

A new service helper (mirror of Phase 1's `projectTransactionsToSecurityCurrency`)
rewrites raw `xact.amount` to base currency before
`resolvePortfolioCashflows` + `appendTransferCashflows` consume it. Per-tx
resolution priority:

1. Same currency (`xact.currency === baseCurrency`) → passthrough.
2. `GROSS_VALUE` unit with `forex_currency === baseCurrency` AND `forex_amount`
   set → use `forex_amount` directly.
3. `getRateFromMap(rateMaps.get(xact.currency), tx.date)` → multiply.
4. Unresolvable: if `securityId` is set → drop tx + tag in
   `unresolvedSecurityIds`. Else (cash) → keep with warning.

Engine source (`resolvePortfolioCashflows`, `computeTTWROR`, `computeIRR`)
remains unchanged. It already consumes single-currency inputs correctly;
the only required change is feeding it consistent base-ccy txs from the
service layer.

### 5. Engine purity preserved (ADR-003)

The engine package remains I/O-free. All currency conversion lives in the
service layer; the engine consumes pre-projected single-currency inputs.
No new engine signatures, no `RateMap` injection into engine functions.

### 6. Wire contract: additive `*Base` fields

`SecurityPerfResponse` rows gain `marketValueBase`, `costBase`,
`unrealizedBase`, `realizedBase`, `dividendsBase`, `baseCurrency` alongside
existing per-security native fields. Portfolio + statement totals gain
`unresolvedSecurityIds` + `unresolvedCount`. Zero breaking changes for
existing consumers.

### 7. UI display axis: base ccy primary in aggregated contexts

| Surface | Primary | Secondary |
|---|---|---|
| Dashboard hero, Detail metric widgets | base | — |
| Statement of Assets totals | base | — |
| Investments table per-row MV / Cost / Unrealized / Realized / Dividends | base | — |
| Investments table per-row Quote price | native | — |
| Investments totals row | base | — |
| SecurityDrawer Cost / MV / Unrealized / Realized / Dividends | **base** | muted native |
| SecurityDrawer Quote price | native | — |
| Security Detail page top values | native (Phase 1 invariant) | — |

This **inverts** the initial Phase 1 default of "native primary everywhere on
per-security drilldown surfaces". The new default matches the upstream reference
convention: aggregated / total contexts show the term currency primary; native
ccy surfaces only on quote prices and a per-security drill-down view where
the security's market is the relevant frame. A user-toggleable Forex view
(swap primary base ↔ native per surface) is the Phase 2-B follow-up; this
ADR commits the default.

### 8. Unresolved-FX policy (three layers)

- **New writes**: already blocked by `enforceCrossCurrencyFxRate` route
  middleware + CSV `FX_RATE_REQUIRED` preview gate. Unchanged.
- **Legacy read path**: affected securities filtered out of rollup totals.
  `unresolvedSecurityIds + unresolvedCount` surfaced on wire. Web renders
  a warning badge on Investments + Statement headers. Per-security
  drilldown still shows the security with native-ccy values for visibility.
- **Manual FX rate entry UI** (Portfolio Settings): Phase 2-B follow-up.

## Consequences

### Positive

- **Closes the visible bug class.** Dashboard hero, TTWROR, IRR, Statement of
  Assets totals all consistent base-currency arithmetic. Reference fixture
  (BRK-B USD in EUR portfolio) verified to produce the expected single-digit
  TTWROR + finite IRR, not 401% / 1e24%.
- **Reference-convention alignment.** Mathematics matches the upstream Java
  implementation (per-tx cost basis trade-date FX, period-end MV FX, per-tx
  cashflow FX). Audit findings cited in `docs/architecture/multi-currency.md`.
- **Zero re-import friction.** Bootstrap auto-seeds `vf_portfolio_meta.baseCurrency`
  from primary deposit; idempotent. Existing portfolios get the correct
  default without any user action.
- **Multi-deposit-currency support.** Per-account FX conversion before
  cash-balance accumulation. EUR + USD + GBP deposits in one portfolio
  now roll up correctly.
- **Engine stays pure.** All FX conversion in the service layer; engine
  consumes single-currency inputs. ADR-003 preserved.
- **Additive wire contract.** `*Base` fields layered on existing
  per-security native fields. No breaking changes for existing consumers.

### Negative / trade-off

- **Architectural divergence from upstream calculation-layer pattern.**
  The upstream tool projects every per-security value to term ccy at the
  calculation layer; QuoVibe keeps Phase 1's per-security native invariant
  and projects at the aggregation site. Mathematically equivalent but
  duplicates one conversion step (per-security perf calculation runs once
  in native, then converted in aggregation; upstream runs only once in
  term ccy). Acceptable: Phase 1's per-security native surface is
  load-bearing for the Security Detail page and the future Forex view
  toggle (Phase 2-B), so the intermediate state has independent UX value.
- **Cost-base computation duplicates BUY iteration.** Phase 1's
  per-security FIFO / MA already walks BUYs in security ccy;
  `computeSecurityCostInBase` walks the same BUYs again in base ccy.
  Acceptable: small N per security, single request scope, both passes
  benefit from the same `rateMaps` cache.
- **UI convention shift requires test churn.** Phase 1 column tests pinned
  native-ccy renders for Investments table rows. These tests must update
  to base-ccy values (with a deterministic FX rate seeded in the fixture).
  Documented as a deliberate convention shift in the CHANGELOG, not a
  regression.

### Accepted technical debt

- **Forex-view toggle deferred to Phase 2-B.** Users cannot currently
  swap base ↔ native default per surface. The upstream-aligned defaults
  in this ADR are the right call for portfolio comparison, but power users
  may want a per-session native view; this is a follow-up.
- **Manual FX-rate entry UI deferred to Phase 2-B.** Legacy portfolios
  with unresolvable FX pairs see the warning badge but cannot manually
  enter a rate without a DB-level edit. Acceptable: the badge surfaces
  the issue loudly; users can re-import a more recent ECB cache as the
  primary workaround.
- **Cost-base helper does not re-attribute cost on partial sells.** When a
  security is partially sold under FIFO, the remaining cost-in-base for
  the held shares should ideally come from the surviving BUYs' trade-date
  rates (which the FIFO engine already tracks per share). Current helper
  sums all BUY cash-side rows without lot tracking. For portfolios without
  partial sells (the common single-BUY case), this is correct. For
  portfolios with partial sells, cost-base will overstate by the
  realized portion's trade-date weighted cost; acceptable interim because
  the realized-base figure is independently emitted and the unrealized
  delta is dominated by the latest-rate component. Refinement is a
  Phase 2-B item.

## References

- Spec: `docs/superpowers/specs/2026-05-17-multi-currency-phase2-design.md`
  (local working doc, not published)
- Plan: `docs/superpowers/plans/2026-05-17-multi-currency-phase2.md`
  (local working doc, not published)
- Architecture: `docs/architecture/multi-currency.md` (extended with Phase 2 section)
- Related ADRs: ADR-003 (engine I/O-free), ADR-014 (`vf_exchange_rate`),
  ADR-015 (bootstrap), ADR-016 (portfolio-scoped state)
- Reference fixture: `data/portfolio-0a6a979b-84c7-424d-866f-3f6c57137552.db`
  (BRK-B USD security in EUR-base portfolio with three out-of-order
  transactions reproducing the mixed-unit bug class)
