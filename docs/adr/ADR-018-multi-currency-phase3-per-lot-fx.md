# ADR-018: Multi-Currency Phase 3 — Per-Lot FX, Decomposition, Forex View

**Status:** accepted
**Date:** 2026-05-20
**Supersedes:** ADR-017 §5 (engine RateMap boundary) in part
**Related:** [ADR-003 — Engine I/O-free](./ADR-003-pure-engine-no-io.md), [ADR-014 — vf_exchange_rate cache](./ADR-014-multi-currency.md), [ADR-017 — Portfolio-Base Rollup](./ADR-017-multi-currency-portfolio-base-rollup.md)

## Context

ADR-017 (Phase 2) closed the mixed-unit aggregation bug class but
accepted three pieces of debt in §6:

- Cost-base helper summed every BUY cash-side row without lot tracking
  → overstated cost on partial sells.
- No user-toggleable forex view (base ↔ native per surface).
- No manual FX-rate entry UI for unresolved pairs.

ADR-017 §5 stated "no `RateMap` injection into engine functions". This
prevented the cleanest implementation of per-lot FX (FIFO needs the rate
at acquisition-time of every lot it builds).

The user's GitHub issue (Zegona GBP raw-unit hero, Tesla USD cost-basis
without FX) was closed at the aggregation site by Phase 2 but the
partial-sell + non-EUR-base portfolios remained exposed.

Reference audit (PP, 2026-05-20): per-lot cost tracking with
acquisition-rate stored per lot is the upstream convention. Decomposition
into capital + FX components is emitted on both realized and unrealized
gains.

## Decision

### 1. Engine accepts pre-built RateMap (supersedes ADR-017 §5)

`computeFIFO` and `computeMovingAverage` now accept an optional
`rateMap: RateMap` parameter. When provided, lots gain
`acquisitionRate: Decimal` (security-per-base, multiply convention)
and `costInBase: Decimal` (= `totalCost × acquisitionRate`). Multiply convention: native_amount × rate = base_amount.

`RateMap` is `Map<string, Decimal>` (treated as immutable value-data by engine functions) — pure data, no I/O.
ADR-003's I/O-free engine invariant is preserved; ADR-017's literal
wording is amended. The contract is: "engine functions accept
pre-computed `RateMap`s as ordinary value-data inputs; they MUST NOT
perform DB lookups, network calls, or filesystem access."

### 2. Per-lot FIFO cost basis at the service layer

`packages/api/src/services/performance.service.ts > computeSecurityFifoInBase`
runs the engine's `computeFIFO` over the security's BUY/SELL/DELIVERY
rows with the sec→base `rateMap`, then sums the surviving lots'
`costInBase`. This replaces the Phase 2 "sum all BUY cash-side rows"
helper uniformly (same-ccy + cross-ccy).

Closes ADR-017 §6 partial-sell debt.

### 3. Decomposition: capital + FX split

Two new engine helpers emit the realized + unrealized × capital + FX
split per security:

- `decomposeRealized(consumedSlices, periodEndRate) → { capitalBase, fxBase }`
- `decomposeUnrealized(remainingLots, periodEndRate) → { capitalBase, fxBase }`

Identity: `realizedBase + unrealizedBase ≡ realizedCapitalBase +
realizedFxBase + unrealizedCapitalBase + unrealizedFxBase`. Engine
tests pin this.

Wire fields added to `SecurityPerfResponse`:
`realizedCapitalBase`, `realizedFxBase`,
`unrealizedCapitalBase`, `unrealizedFxBase`,
`dividendFxBase`.

`CalculationBreakdownResponse` (portfolio totals) accumulates the same
fields.

### 4. Dual TTWROR / IRR

`SecurityPerfResponse` gains `ttwrorBase`, `ttwrorPaBase`, `irrBase`,
`irrBaseConverged` alongside the existing native fields. The native
values use the security-ccy cashflows; the base values use
base-ccy-projected cashflows.

### 5. Forex view toggle

Per-surface base ↔ native swap via `ForexViewChip` +
`ForexViewProvider`. State persisted in
`quovibe.settings.json > forexView` (sidecar). Default per surface:

| Surface | Default |
|---|---|
| dashboard | base |
| investments | base |
| securityDrawer | base |
| securityDetail | native (Phase 1 invariant) |
| statement | base |

`CurrencyDisplayWithToggle` is the consumer primitive — accepts
`value` (base) + `nativeValue` + `forexSurface` and reads from
the provider.

### 6. G15 governance — Phase 3 wire field parity check

`scripts/check-governance.ts` rule G15: every Phase 3 wire field
(`*Base`, `unresolved*`, `forexView`) MUST have a matching emit site
in the service layer + consumer surface in the web package + test
covering both. Drift fails CI.

### 7. `getRate` EUR-triangulation port

`packages/api/src/services/fx.service.ts > getRate` is the single-date
companion to `buildRateMap`. Both now share the same EUR-triangulation
path: `from→to = (EUR→to) / (EUR→from)` when no direct or inverse pair
exists. Closes a silent-projection-fail class for non-EUR-base
portfolios with non-EUR security purchased via non-EUR deposit. Unit
tests in `fx-service.test.ts` cover the triangulation + direct-priority
+ null-when-nothing cases.

## Consequences

### Positive

- Closes the user's GitHub bug class for the common cases
  (single-BUY hold, multi-BUY hold, partial sell).
- Per-lot FIFO + decomposition match PP's term-currency aggregation
  convention.
- User can toggle base ↔ native per surface; defaults match PP convention.
- Engine I/O-free invariant preserved; only the wording of ADR-017 §5
  amended.
- Non-EUR-base portfolios no longer silently mis-project at the
  single-date `getRate` boundary.

### Negative / trade-off

- Engine signatures widen (optional `rateMap` arg on FIFO/MA). Existing
  callers unchanged because the param is optional.

### Accepted technical debt (NOT closed in Phase 3)

The closure-design spec called for a PP-parity regression fixture
suite covering 5 scenarios spanning EUR/USD/GBP. The suite was
dropped on 2026-05-20 mid-execution because the user — sole source
of PP-XML fixtures and PP-captured expected values — had no PP files
to capture from. The following audit-class gaps therefore remain
outstanding:

- **PP rate-direction parity** (gap 4 from
  `docs/superpowers/specs/2026-05-20-multi-currency-phase3-shipping-closure-design.md`).
  PP convention is deposit-per-security; qv convention is
  security-per-deposit. The CSV-import boundary inverts via
  `ppRateToQvRate`. End-to-end audit across Phase 1 + 2 + 3 cost
  paths against PP's emitted numbers has NOT been performed.
  Mitigation: unit tests pin every conversion site against
  hand-computed expected values; visual verification via QA Pass 8
  + 9 confirms the user-reported bug class (Zegona GBP, Tesla USD)
  no longer reproduces. Risk: a silent inverse drift somewhere in
  the chain would still pass internal-consistency tests.

- **ppxml2db FOREX-unit population audit** (gap 5). When PP-XML import
  produces a cross-currency BUY, ppxml2db should write the FOREX
  `xact_unit` row with `forex_amount` + `forex_currency` carrying
  the security-ccy gross. Whether this happens for every type of
  PP-XML shape across PP versions is unverified for the user's
  actual XML. Phase 1's `projectTransactionsToSecurityCurrency`
  falls back to `getRate(deposit_ccy, sec_ccy, tx.date)` when the
  FOREX unit is absent, so a working ECB cache covers the
  fallback path. The audit was deferred.

Both gaps are closed-by-deferral via the user's own re-import of
their actual PP-XML on Phase 2+3 + visual confirmation of the
Zegona/Tesla scenarios. Re-opening either requires the user to
supply PP-XML + PP-captured baseline values.

### Other accepted debt

- OBS-01 (`/settings/currencies` pair-switch UX) filed, not fixed in
  this work. Needs design call: auto-invert vs hint vs gray-out.
- i18n + cross-browser verification deferred (Playwright Pass 9 was
  English + Chromium only).
- Alphavantage provider test fixture date-drift (test asserts
  `startDate = '2026-03-01'` is "recent" but absolute date now
  exceeds the 80-day compact threshold). Unrelated to Phase 3;
  pre-existing rot inherited from the initial public release.
- Future Phase 4 consolidation: ADR-014 + ADR-017 + ADR-018 → single
  canonical multi-currency ADR.

## References

- Spec: `docs/superpowers/specs/2026-05-20-multi-currency-phase3-shipping-closure-design.md`
  (local working doc, not published)
- Plan: `docs/superpowers/plans/2026-05-20-multi-currency-phase3-shipping-closure.md`
  (local working doc, not published)
- Architecture: `docs/architecture/multi-currency.md` (extend with §Phase 3 after merge)
- Phase 3 commits: `worktree-feature+multi-currency-phase3-pp-parity` 5562c93 → final
- QA Pass 8 report: `.playwright-mcp/QA-PASS-8-MULTI-CURRENCY-PHASE3-REPORT.md`
- QA Pass 9 report (planned, post-Phase-C): `.playwright-mcp/QA-PASS-9-MULTI-CURRENCY-CLOSURE-REPORT.md`
