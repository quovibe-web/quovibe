globs: packages/api/src/db/**
---
# DB Schema Rules

- **NEVER modify the original DB schema without asking first.** The schema mirrors ppxml2db and changes have downstream consequences.
- Table names are **singular** (ppxml2db convention): `xact`, `security`, `account`, `price`, `latest_price` — not plural.
- Unit conventions (ppxml2db encoding):
  - Shares: stored as integer × 10^8 → divide by `1e8` in the service layer
  - Prices: stored as integer × 10^8 → divide by `1e8` in the service layer
  - Amounts (cash): stored as integer × 10^2 (hecto-units) → divide by `100` in the service layer
- All unit conversion belongs in the **service layer**, never in route handlers or the engine.
- See `docs/architecture/database-schema.md` for full table descriptions and field semantics.
- See `.claude/rules/double-entry.md` for BUY/SELL xact row structure and cross-entry mechanics.
