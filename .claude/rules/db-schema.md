globs: packages/api/src/db/**
---
# DB Schema Rules

- **DDL source of truth: `packages/api/src/db/bootstrap.sql`** (ADR-015).
  Applied idempotently on every `openDatabase()` call via
  `applyBootstrap(db)` in `packages/api/src/db/apply-bootstrap.ts`. Drizzle's
  `schema.ts` is the ORM view, parity-checked against `bootstrap.sql` by
  Gate 2 (`bootstrap-parity.test.ts`). Never add `CREATE TABLE` / `ALTER`
  outside `bootstrap.sql` or the `VENDOR_COLUMN_PATCHES` table in
  `apply-bootstrap.ts` — runtime DDL elsewhere fails Gate 3.
- `bootstrap.sql` has two halves separated by the `═══ QUOVIBE SECTION BEGIN ═══`
  marker:
  - **§1+§2** — verbatim from `packages/api/vendor/ppxml2db_init.py` (24
    baseline tables + indexes) with `IF NOT EXISTS` added to every `CREATE`.
    Gate 1 (`pnpm check:bootstrap`) compares this half against regenerated
    upstream output — drift fails CI. **NEVER edit ppxml2db tables in this
    section directly.**
  - **§3+§4** — quovibe-owned `vf_*` tables and analytical indexes (see
    below). Free to extend, subject to the parity tests.
- **NEVER modify the original ppxml2db schema without asking first.** The §1+§2
  half mirrors ppxml2db; changes have downstream consequences (PP-XML import,
  ppxml2db.py compatibility, Gate 1 drift).
- Table names are **singular** (ppxml2db convention): `xact`, `security`, `account`, `price`, `latest_price` — not plural.
- `vf_*` tables (quovibe-owned, per-portfolio DB, ADR-014 + ADR-015 §3):
  - `vf_exchange_rate` — live FX cache, PK `(date, from_currency, to_currency)`.
  - `vf_portfolio_meta` — portable per-portfolio metadata (key/value).
    Allowlisted keys: `name`, `createdAt`, `source`, `schemaVersion`.
  - `vf_dashboard` — portfolio-scoped dashboards (`position` is sole order
    truth; smallest = implicit default, no `is_default` flag).
  - `vf_chart_config` — portfolio-scoped chart **content** only (series refs,
    visibility, benchmarks). User-level chart aesthetics live in sidecar
    `preferences.chartStyle`, NOT here.
  - `vf_csv_import_config` — saved CSV import mappings.
- §4 analytical indexes (quovibe-owned, performance-driven): `idx_xact_date`,
  `idx_xact_security`, `idx_xact_cross_entry_from_acc`,
  `idx_xact_cross_entry_to_acc`, `idx_price_date`, `idx_price_security_date`.
- **Runtime-installed indexes** (`apply-bootstrap.ts` helpers, NOT in
  bootstrap.sql §4): `idx_xact_csv_natural_key` — partial unique index on
  `xact (date, type, security, account, shares, amount) WHERE source='CSV_IMPORT'`,
  backs CSV re-import dedupe (BUG-143). Runtime DDL is required because
  the install can fail on a contaminated DB (divergent CSV duplicates) and
  would otherwise abort the bootstrap exec mid-script. The helper wraps
  `CREATE UNIQUE INDEX` in try/catch so app-start never breaks. See
  `.claude/rules/csv-import.md` "Re-import dedupe (BUG-143)" for the full
  contract + cleanup helper.
- **Vendor column patches** (`apply-bootstrap.ts > VENDOR_COLUMN_PATCHES`):
  the only sanctioned route to add columns to a §1+§2 vendor table without
  breaking Gate 1 parity. Today's patch set adds `open BIGINT`,
  `high BIGINT`, `low BIGINT`, `volume BIGINT` to BOTH `price` and
  `latest_price`. `latest_price.{high,low,volume}` is populated by
  `ppxml2db.py > handle_latest` from `<latest>` XML nodes. The full Open +
  OHLCV set on `price` and `latest_price` is populated by the quovibe CSV
  price wizard (`executePriceImport`) so candlestick charts have bar data
  for securities without a live ticker (crowdlending, private equity).
  `handle_price` does not populate OHLCV today — columns stay NULL on
  PP-XML imports until the upstream parser is extended. Drizzle `schema.ts`
  declares the patched columns; `bootstrap-parity.test.ts >
  DRIZZLE_MISSING_ALLOWLIST` lets the Gate 2 parser ignore them because
  they are installed at runtime, not in `bootstrap.sql`. Add new patches
  only when the vendor SQL genuinely under-specifies a column the
  importer writes — never as a shortcut around Gate 1.
- `attribute_type` PK is `_id` rowid; `id` is non-unique TEXT. Natural key is
  `(id, target)` — PP allows the same `id` for multiple targets (e.g. `logo`
  for Security/Account/Portfolio/InvestmentPlan). Drizzle `schema.ts` reflects
  this — do not "fix" it back to `id PRIMARY KEY`.
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
