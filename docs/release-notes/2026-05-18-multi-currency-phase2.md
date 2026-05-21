# Multi-Currency Phase 2 — Portfolio-Base Rollup

**Released:** 2026-05-18

## Summary

Dashboard / Statement of Assets / IRR / TTWROR now compute in portfolio
base currency. Per-security values stay in security currency (Phase 1).
Closes the BRK-B-class bug where the hero MV showed €1153.93 (mixed EUR
cash + USD security sum), TTWROR 401 %, IRR 4.96e24 %. Same fixture now
shows €1018.77, TTWROR ≈ 1.96 %, IRR finite.

## Changes

### Server

- New `services/portfolio-base.service.ts` — `getPortfolioBaseCurrency` +
  `setPortfolioBaseCurrency` + ISO-4217 validator. Priority chain:
  `vf_portfolio_meta.baseCurrency` → primary deposit ccy → first security
  ccy → `'EUR'` literal.
- `vf_portfolio_meta.baseCurrency` auto-seeded at bootstrap from primary
  deposit currency. Idempotent — never overwrites a user-set value. Zero
  re-import friction.
- `services/performance.service.ts`:
  - `projectTransactionsToBaseCurrency` — per-tx trade-date FX projection.
    Priority: same-ccy → `GROSS_VALUE` FOREX leg → `vf_exchange_rate` →
    unresolved (security tx dropped + tagged, cash tx kept).
  - `computeSecurityCostInBase` — strict-upstream per-BUY trade-date FX
    cost basis. MV uses period-end FX.
  - Aggregation loop now FX-converts each per-security total to base
    before summing into `totalMVB` / `totalMVE`. Unresolved securities
    excluded from rollup.
  - All three cashflow sites (`getPortfolioCalc`, `getChartData`,
    `getReturnsHeatmap`) project txs to base before
    `resolvePortfolioCashflows`.
  - Per-account deposit-balance conversion to base ccy before summing —
    multi-deposit-currency portfolios no longer silently mix units.
  - `getStatementOfAssets` excludes unresolved-FX securities from
    `totalSecValue`, surfaces them via `totals.unresolvedCount` +
    `totals.unresolvedSecurityIds`.
- Consolidated three legacy `getBaseCurrency` copies
  (`performance.service`, `benchmark.service`, `fx-fetcher.service`) onto
  the canonical `portfolio-base.service`. `fx-fetcher.service` re-exports
  under the legacy name for callers.

### Wire contract (additive)

- `SecurityPerfResponse` rows gain `baseCurrency`, `marketValueBase`,
  `costBase`, `unrealizedBase`, `realizedBase`, `dividendsBase`.
- `CalculationBreakdownResponse` (portfolio totals) gains
  `unresolvedCount` + `unresolvedSecurityIds`.
- `StatementOfAssetsResponse.totals` gains the same two unresolved
  fields. Zero breaking changes.

### Web

- Dashboard hero + Detail widgets read base-correct totals (no widget
  code changes needed — API now emits base-correct `finalValue`).
- Holdings list filters out unresolved-FX securities for unit consistency.
- Investments table: MV / Cost / Unrealized / Realized / Dividends
  render in base ccy via `*Base` fields; Quote price stays native.
  Percentage denominator switched to `marketValueBase`.
- Investments header renders amber Alert when `unresolvedCount > 0`.
  8-language i18n via `unresolvedFx_one`/`_other` (PL adds `_few`/
  `_many`).
- SecurityDrawer: base ccy primary on Cost / MV / Unrealized / Realized /
  Dividends with native muted secondary line when ccy differs. Inverts
  Phase 1 default to align with upstream convention.

### Engine

- No source changes. Phase 2 fixes all live in `packages/api`.
- New regression suite
  `engine/__tests__/regression/multi-currency-portfolio-regression.test.ts`
  pins engine consumption of pre-projected base-ccy txs.

## Deferred (Branch B follow-up)

- Portfolio Settings UI for editing `baseCurrency`.
- Manual FX-rate entry UI for resolving unresolved pairs.
- Forex-view toggle to swap base ↔ native default per surface.
- Investments base-aggregation column toggle.

## Cross-references

- ADR-017 — Multi-currency portfolio-base rollup decision.
- `docs/architecture/multi-currency.md` § Phase 2.
- `docs/superpowers/plans/2026-05-17-multi-currency-phase2.md`.
