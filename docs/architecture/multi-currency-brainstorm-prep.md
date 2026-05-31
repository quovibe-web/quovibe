# Multi-Currency — Phase 2 Brainstorm Prep

Pre-session handoff for the next brainstorm. Entry instruction:
**Read this doc + `multi-currency.md` first. Then run `/superpowers:brainstorming` and walk every open question below before designing.**

## Status (2026-05-17)

### Phase 1 shipped on `feature/multi-currency-perf` (7 commits)

- Engine: `getSecurityCurrencyGross` — security-native cost-basis resolver
  - Priority chain: same-ccy → FX-decorated unit (`GROSS_VALUE` or `FOREX`) → `vf_exchange_rate` fallback → null
  - Dual-writer acceptance (ppxml2db emits `GROSS_VALUE` from PP XML; quovibe-native `transaction.service.ts > buildUnits` emits `FOREX`)
- API: `projectTransactionsToSecurityCurrency` in `performance.service.ts` rewrites per-security txs to native ccy before FIFO/cashflow/TTWROR
- API: `backfillCrossCurrencyGrossUnits` synthesises missing GROSS_VALUE FOREX units on every `applyBootstrap`, idempotent
- Web: `SecurityDrawer.tsx` + `Investments.tsx` totals row — per-cell `currency={perf.currency}` props matching `useInvestmentsColumns.tsx` pattern

Coverage: engine 291/291, api 1149/1149, web 978/978, governance + arch + bootstrap parity all green.

### What's verified end-to-end (Playwright)

- `data/portfolio-0a6a979b-84c7-424d-866f-3f6c57137552.db` (renamed copy of `Test-2026-05-16.db`)
- Single security BRK-B (USD, 2 shares), single deposit Valores (EUR), 2 BUYs settled EUR
- Security detail page: cost **948.95 US$**, MV **965.40 US$**, unrealized **16.45 US$** ✓
- Drawer: MV €830.24, Cost US$948.95, Unrealized US$16.45 (per-cell labelled correctly)
- Dashboard: all monetary cells labelled €

## What's broken — Phase 2 scope

### Visible symptoms

1. **Drawer mixed-currency display** — MV in € but Cost/Unrealized/Realized/Dividends in US$. PP convention is all-base.
2. **Dashboard Hero MV = €1,153.93** — expected ~€1,018.77 (off by ~€135, suspect FX-treated DEPOSIT or duplicated cashflow)
3. **Hero TTWROR = 401.18 %** — per-security TTWROR is 1.96 %; portfolio rollup diverging
4. **Hero IRR = 4.96 × 10²⁴ %** — Newton-Raphson divergence (likely same root as #2/#3)
5. **Investments table** — currently mixes per-row native ccy with portfolio-base totals row (we hide total if mixed-ccy; PP would show all-base)
6. **Statement of Assets** — server emits `pricePerShare` in native, `marketValue` in base. Drawer multiplier line was inconsistent; we labelled the multiplier with US$ as palliative. PP would emit both in base.

### Root cause hypothesis (single)

Per-security path now consumes projected (security-native) values. Portfolio-level path (`getPortfolioCalc`, `getCalculationBreakdown`) consumes **unprojected** (deposit-ccy) values. Two paths diverged. Cashflows used for TTWROR/IRR are in deposit-ccy raw `xact.amount`, MV is in security-ccy. Mixed-unit arithmetic at portfolio scope. Same bug class as the original symptom — different layer.

## Open design questions

### Q1 — Math axis for portfolio-level computation
- **A**: All values converted to portfolio base before any computation (PP convention)
- **B**: Engine returns security-native + base both; service layer aggregates base
- **C**: Two-pass FIFO (current `projectTransactionsToSecurityCurrency` + analogous `projectTransactionsToBaseCurrency`)
- Tradeoff: A is cleanest but biggest blast radius; C reuses existing projection helper

### Q2 — Where does base-conversion happen
- Engine (`packages/engine`) is I/O-free per ADR-003. Conversion needs FX data.
- Options:
  - Engine takes `baseCurrency: string` + injected `RateMap` parameter (stays pure)
  - Service does base-projection on input transactions before engine
  - Hybrid: engine returns security-native, service post-projects results

### Q3 — Historical FX policy for cost basis
- PP convention: **transaction-date FX from the GROSS_VALUE FOREX unit**, NOT latest FX
- For cost basis: each BUY's FX is fixed at trade time
- For MV: each security's MV uses **today's FX** (or statement-date FX)
- Unrealized = MV_today_fx − Cost_trade_date_fx — captures BOTH price effect and FX effect together
- Quovibe today has the FX unit data; need to wire it through the base-projection path

### Q4 — Wire contract change
- Option a: Add `*Base` fields to `SecurityPerfResponse` alongside existing security-native fields
- Option b: Replace existing fields (semantic break; need to update every consumer)
- Option c: Split into two endpoints: `/securities-native` + `/securities-base`
- Option d: Single endpoint returns both, client picks per-surface
- Investments columns config / table layouts: which axis is the default user view? Both selectable?

### Q5 — Multi-deposit-currency portfolio
- PP: portfolio has ONE base currency; every deposit account converts to it
- Quovibe today: base currency derived from a deposit account (single-deposit assumption)
- Need: first-class `portfolio.baseCurrency` field? Or compute from primary deposit? User-configurable?
- Multi-deposit scope: in Phase 2 or follow-up? User said strict PP alignment — probably in.

### Q6 — Missing FX rates (rate cache miss)
- Backfill helper logs unresolved pairs but leaves them in deposit-ccy
- PP convention: blocks at trade entry with "rate required" — never persists mixed-unit values
- Options for quovibe:
  - Hard-abort import (PP-aligned, breaks ergonomics for users without rate data)
  - Soft-degrade: render in deposit-ccy with warning badge (current behavior, NOT PP)
  - Manual rate-entry UI (deferred follow-up in current multi-currency.md)
- Which fires first: bootstrap-time validation, or per-display fallback?

### Q7 — Dashboard MV €1,153.93 vs €1,018.77 discrepancy
- Need to trace before designing. Likely either:
  - DEPOSIT 1000 EUR being converted as if it were USD (1000 × ~1.16 = 1,160 — close to €1,153.93 minus the unrealized)
  - Cashflow sign error on cross-currency BUYs (cash-side row inflated)
  - Cost basis double-counted (cash-side + securities-side both contributing)
- Diagnose first, then design fix in light of Q1-Q5.

### Q8 — IRR 4.96e24 % blow-up
- Newton-Raphson on tiny cashflow basis (sub-euro NPV roots near zero)
- Could be the bisection-fallback firing on a degenerate case
- Or could be downstream of Q2/Q7 (bad cashflow inputs producing degenerate cost basis)
- Diagnose AFTER Q7 because shared root cause likely

## Constraints (user directives this session)

- **Strict PP alignment. No drift from PP specification.**
- Audit-grade (Bloomberg/IBKR-style is NOT acceptable; PP is the spec)
- User comes from PP — quovibe must be the same
- No re-import friction: existing data must migrate, not require user action

## References

- `docs/architecture/multi-currency.md` — Phase 1 design doc (read first)
- `docs/pp-reference/` — gitignored locally; surgical-read by keyword (account/transaction/performance/currency/exchange/cost-methodology). Never bulk-load.
- `.claude/rules/double-entry.md` — type matrix, FX gate, transfer invariants
- `.claude/rules/latest-price.md` — MV injection rule (same-date intraday wins)
- `.claude/rules/db-schema.md` — bootstrap.sql + vendor patches
- Branch: `feature/multi-currency-perf` — keep as baseline
- Test DB: `data/Test-2026-05-16.db` (original) and `data/portfolio-0a6a979b-84c7-424d-866f-3f6c57137552.db` (registered)
- Dev server log: `/tmp/quovibe-dev.log`
- Verify script: `scripts/verify-test-db-multi-currency.ts`

## Artifacts that would help (ask user)

1. **Multi-deposit-currency test DB** — fixture covering portfolios with EUR + USD + GBP deposits. Without it, multi-deposit design is theoretical.
2. **PP screenshots of equivalent data** — pixel-exact convention lock for Statement, Dashboard, Security Detail, Performance widget. Eliminates "I think PP shows X" hedging.

User has both available (real PP user). Decide before designing.

## Entry instruction for next session

```
Read docs/architecture/multi-currency-brainstorm-prep.md.
Read docs/architecture/multi-currency.md.
Run /superpowers:brainstorming.
Walk Q1-Q8 in order. Pick artifacts (#1, #2) — request from user or proceed without.
Output design doc before writing any code.
```
