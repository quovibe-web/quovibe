globs: packages/api/src/db/**
---
# DB Schema Rules

- **NEVER modify the original DB schema without asking first.** The schema mirrors ppxml2db and changes have downstream consequences.
- Table names are **singular** (ppxml2db convention): `xact`, `security`, `account`, `price`, `latest_price` — not plural.
- Unit conventions (ppxml2db encoding):
  - Shares: stored as integer × 10^8 → divide by `1e8` in the service layer
  - Prices: stored as integer × 10^8 → divide by `1e8` in the service layer
  - Amounts (cash): stored as integer × 10^2 (hecto-units) → divide by `100` in the service layer
- `xact.amount` is always a **non-negative magnitude**; sign is carried by
  `xact.type`. The OUTFLOW/INFLOW sets and the `gross ± fees ± taxes`
  packing live in `transaction.service.ts` (see `OUTFLOW_TX_TYPES` /
  `INFLOW_TX_TYPES`). Negative amounts double-negate through
  `getDepositBalance` (which applies `CASE … THEN -amount` to OUTFLOWs) and
  silently inflate cash (BUG-80). Seed scripts and fixtures follow the same
  rule; `scripts/seed-demo.ts` pins it with an `amount < 0` SQL invariant.
- `xact.type` stores the **ppxml2db form**, not the quovibe enum form. The
  enum→DB map (`TYPE_MAP_TO_PPXML2DB` in `transaction.service.ts`) has one
  divergent name today — `DIVIDEND` → `'DIVIDENDS'`. Queries that key on the
  DB form silently skip rows stored under the enum form; extend the seed's
  enum-leak invariant when the map grows.
- All unit conversion belongs in the **service layer**, never in route handlers or the engine.
- See `docs/architecture/database-schema.md` for full table descriptions and field semantics.
- See `.claude/rules/double-entry.md` for BUY/SELL xact row structure and cross-entry mechanics.
