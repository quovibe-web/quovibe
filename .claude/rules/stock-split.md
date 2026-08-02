globs: packages/api/src/services/stock-split.*,packages/api/src/routes/stock-split.*,packages/shared/src/split/**,packages/web/src/components/domain/stock-split/**,packages/web/src/pages/StockSplitWizard.*,packages/web/src/components/domain/SecurityEventsSection.*
---
# Stock Split Rules

Mirrors Portfolio Performance's Stock Split wizard 1:1 (three pages: ratio →
transaction preview → quote preview, then a destructive retroactive rewrite).

## Invariants

- **Destructive at write time.** The split rewrites `xact.shares` and
  `price.{value,open,high,low}` for rows strictly before the ex-date. There is
  no compute-time adjustment anywhere in the engine, and adding one back is a
  regression — see ADR-019.
- **Stored events are markers only. Never retro-apply one.** `ppxml2db.py >
  handle_event` imports PP `<event>` nodes describing splits PP already applied
  destructively before export. A compute-time model reading `security_event`
  would double-apply every one of them on any imported portfolio.
- **Undo is a client navigation, not an endpoint.** `SecurityEventsSection`'s
  row action opens the wizard pre-filled with the inverted ratio and the same
  ex-date. There is deliberately no `revertStockSplit` service and no revert
  route: applied, PP-imported, and legacy-dialog events are indistinguishable in
  `security_event` (no `source` column, and ADR-015 forbids adding one), so a
  server-side "undo this event" would un-split data that was never split here.
  Undo therefore leaves its own marker rather than deleting the first — PP
  behaves the same way.
- **Row predicate is `substr(date, 1, 10) < :exDate`** — day-granular and
  strict. Both `xact.date` and `price.tstamp` are `VARCHAR(32)` and may carry an
  ISO time tail. Rows *on* the ex-date are untouched.
- **No transaction-type filter.** Every `xact` row referencing the security is
  eligible, dividends included. Cash-side BUY/SELL rows carry `shares = 0`,
  scale to `0`, and fall out of the affected counts with no special case.
- **Rounding is half-even on the raw scaled integer**, after a division carried
  out at 10 significant digits half-up. `packages/shared/src/split/pp-split.ts`
  is the single implementation — never re-derive it. The multiply happens under
  a wide-precision context because the reference implementation multiplies
  exactly and applies its rounding context only to the division.
- **`volume` is never rescaled** — it is a share count, not a price. `open` /
  `high` / `low` take the same divisor as `value`; NULLs pass through.
- **`xact.amount`, `fees`, `taxes` and every `xact_unit` row are untouched.**
  Only `shares` moves, so implied per-share price and every FX decomposition
  stay consistent.
- **`latest_price` is re-synced** via `syncLatestPriceFromGlobalMax` when quotes
  were actually rewritten. This is a deliberate divergence from PP, which leaves
  the latest quote alone: for a recent split every historical bar predates the
  ex-date, so without the resync the adjusted max-date row disagrees with the
  untouched latest quote and the displayed position value stays wrong.
- **A unique-constraint failure during the rewrite is a rollback, not a
  workaround.** Restating share counts can make two previously-distinct
  CSV-imported rows collide on `idx_xact_csv_natural_key`. Catch it, let the
  transaction roll back so nothing is half-applied, return 409
  `SPLIT_DEDUPE_CONFLICT`. Never drop and recreate the index around the update —
  that silently merges two real transactions.
- **Ratio orientation is `new:old`** everywhere: wire, storage, helper. A
  20-for-1 forward split is `20:1`; a 1-for-25 reverse split is `1:25`. The
  wizard collects it as two labelled fields (Old shares → New shares) plus a
  live direction sentence, because a single free-text `a:b` box silently
  inverts a reverse split for anyone who types it the way their broker states
  it.
- **`1:1` is well-formed but rejected one layer up.** `parseSplitRatio` accepts
  it; `stockSplitSchema.superRefine` rejects it, so the wizard's Next gate and
  the server route reject from the same source of truth.
- **`createSecurityEventSchema` accepts both detail shapes** — a
  `parseSplitRatio`-valid `"new:old"` string or legacy JSON. Readers go through
  `readSplitDetails`, which tries the ratio first and falls back; unparseable
  details render raw rather than throwing.
- **No DDL.** `security_event` already exists in `bootstrap.sql §1` and already
  stores the ratio in `details`. Gate 1 and Gate 2 are untouched by this
  feature.

## Error codes

| Code | Status |
|---|---|
| `INVALID_INPUT` | 400 (Zod) |
| `INVALID_SPLIT_RATIO` | 400 |
| `SECURITY_NOT_FOUND` | 404 |
| `DUPLICATE_SPLIT` | 409 |
| `SPLIT_DEDUPE_CONFLICT` | 409 |

The route's Zod branch checks `err.name === 'ZodError'` alongside `instanceof`,
matching `middleware/error-handler.ts` — a duplicated zod copy in the workspace
makes `instanceof` unreliable across package boundaries.

## Tests that lock the contract

- `packages/shared/src/split/pp-split.test.ts`
- `packages/shared/src/schemas/stock-split.schema.test.ts`
- `packages/shared/src/schemas/security-event.schema.test.ts`
- `packages/api/src/services/__tests__/stock-split.service.test.ts`
- `packages/api/src/__tests__/stock-split-routes.test.ts`
- `packages/web/src/components/domain/stock-split/__tests__/stock-split-form.schema.test.ts`

Any regression that re-introduces a compute-time split model, retro-applies a
stored event, weakens the strictly-before predicate, adds a type filter,
rescales `volume`, or converts the dedupe conflict into an index drop must make
one of these suites go red first.
