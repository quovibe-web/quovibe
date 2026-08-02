# ADR-019: Stock Splits Are Applied Destructively at Write Time

**Status:** accepted
**Date:** 2026-08-02
**Supersedes:** —

## Context

A user reported registering a 25:1 reverse split and seeing no change anywhere
in the app. Investigation found the feature was never implemented: the Stock
Split dialog wrote a `security_event` row and **nothing in quovibe ever read
it**. The dialog was a write-only dead end.

The codebase also carried a second, unreachable split implementation in the
engine: `applySplitAdjustment` in `packages/engine/src/cost/split.ts`, plus
optional `splitEvents` parameters on `computeFIFO` and `computeMovingAverage`.
All three call sites in `performance.service.ts` passed nothing. The two dead
implementations were mutually inconsistent — one gated on `lot.date <
event.date`, the other on `date <= tx.date` — which is itself evidence neither
was ever exercised.

The obvious repair (wire `security_event` into the engine's compute-time
adjustment) is **unsafe**. `packages/api/vendor/ppxml2db.py > handle_event`
imports Portfolio Performance `<event>` nodes into `security_event` during
PP-XML import. Those rows describe splits PP had **already applied
destructively before export**. A compute-time model reading them would
double-apply every historical split on every PP-XML-imported portfolio.

Portfolio Performance's own model is destructive and retroactive:
`StockSplitModel.applyChanges()` rewrites stored share counts and stored
historical quotes for everything strictly before the ex-date, so the portfolio
reads as if the shares had always been split. Its manual states plainly that
the change "is destructive. It is not easily undone", and documents applying
the inverse ratio as the correction path. This is also what every financial
data provider does, which is why PP's adjusted price chart agrees with public
price history and a compute-time model's would not.

## Decision

1. **Splits are applied destructively and retroactively at write time.**
   `applyStockSplit` rewrites `xact.shares` and `price.{value,open,high,low}`
   for rows strictly before the ex-date, inside one transaction, and records a
   `security_event` marker.
2. **Stored events are markers only and are never retro-applied.** No
   calculation reads `security_event`. quovibe cannot distinguish an
   applied event from an unapplied one — and neither can PP, because in PP
   every stored split event is applied by construction.
3. **The engine's compute-time split model is deleted**, along with the
   `splitEvents` parameters. Leaving a second, rival split model reachable in
   the engine is the bug class this decision closes.
4. **Undo is an inverse-ratio re-apply through the wizard, not a server
   endpoint.** The events-section row action navigates to the wizard pre-filled
   with the inverted ratio; the user walks the normal preview and confirm.
5. **`latest_price` is re-synced** from the post-rewrite global max whenever
   quotes were rewritten — a deliberate divergence from PP, recorded in
   `.claude/rules/stock-split.md`.

## Consequences

- Historical share counts no longer match the paper record. PP has the same
  property and accepts it for the same reason: it is what makes cost basis,
  valuations and charts internally consistent and comparable with public price
  history.
- Cost basis needs no special handling. FIFO and moving-average read `shares`
  directly from `xact`, so they follow the rewrite for free. That is precisely
  why the destructive model is the correct one.
- Undo is approximate, not byte-exact. Whether it drifts at all depends on the
  ratio: a round trip through a ratio that divides the stored count evenly
  (e.g. 1:25 on 250 shares) returns the original integer exactly, while one
  that does not (1:3 on 100 shares) lands one 10⁻⁸ unit away. Measured over
  five consecutive apply/undo loops, the drift appears **once and then holds
  steady** — the rounding reaches a fixed point rather than accumulating, and
  quotes showed no drift at all. The portfolio `.db` export remains the exact
  recovery path, and the wizard's destructive warning says so.
- Undo leaves its own marker rather than deleting the original. PP behaves the
  same way; deleting a marker is documented as removing the chart mark only.
- Rewriting share counts can make two previously-distinct CSV-imported rows
  collide on `idx_xact_csv_natural_key`. That is caught, rolled back, and
  surfaced as 409 `SPLIT_DEDUPE_CONFLICT` rather than worked around by
  dropping the index — which would silently merge two real transactions.

## Alternatives rejected

- **Compute-time adjustment reading `security_event`.** Double-applies every
  historical split on PP-XML-imported portfolios. This is the decisive
  argument, not a matter of taste.
- **A `vf_split_backup` snapshot table for byte-exact undo.** Over-engineering
  for a rare corporate action, and it would need its own lifecycle, retention
  and UI. The inverse-ratio re-apply plus the `.db` export cover the need.
- **A `source` column on `security_event` to tell applied events apart from
  imported ones.** `security_event` is a §1 vendor table; ADR-015 forbids
  editing that half of `bootstrap.sql`. Making undo a client navigation removes
  the need entirely.
