# Database Schema (ppxml2db-compliant)

The schema faithfully follows the structure created by ppxml2db. Drizzle ORM maps the existing tables without destructive migrations.

> **Schema source of truth (ADR-015).** `packages/api/src/db/bootstrap.sql` is the canonical DDL for every quovibe DB file. It is applied on every `openDatabase()` call (idempotent, `IF NOT EXISTS` everywhere) and contains two sections: §1+§2 are verbatim from `packages/api/vendor/ppxml2db_init.py` (baseline 24 tables + indexes) and §3+§4 are the quovibe-owned `vf_*` tables (`vf_exchange_rate`, `vf_portfolio_meta`, `vf_dashboard`, `vf_chart_config`, `vf_csv_import_config`) plus 6 analytical indexes. Drizzle's `schema.ts` is the ORM view, parity-checked against `bootstrap.sql` by CI gates (see `packages/api/scripts/check-bootstrap-fresh.sh` and `packages/api/src/db/__tests__/bootstrap-parity.test.ts`).

> Source: `packages/api/src/db/schema.ts`

## Tables

### Accounts (`account`)

| Column | Type | Notes |
|--------|------|-------|
| uuid | TEXT PK | Logical primary key |
| name | TEXT | Account name |
| type | TEXT | `'account'` (deposit) or `'portfolio'` (securities) |
| currency | TEXT | Default `'EUR'` |
| isRetired | INTEGER | Boolean, soft delete |
| referenceAccount | TEXT | FK to deposit account (for securities accounts) |

### Securities (`security`)

| Column | Type | Notes |
|--------|------|-------|
| uuid | TEXT PK | |
| name | TEXT | |
| isin, tickerSymbol, wkn | TEXT | Identifiers |
| currency | TEXT | Default `'EUR'` |
| feed, feedURL, latestFeedURL | TEXT | Price feed configuration |
| isRetired | INTEGER | Boolean |

Related tables: `security_event`, `security_attr`, `security_prop`, `attribute_type`.

### Prices

- **`price`** — daily historical timeseries. Columns: `security` (FK), `tstamp` (date), `value` (INTEGER, ×10^8).
- **`latest_price`** — last known quote (scalar per security). Columns: `security` (PK, FK), `tstamp`, `value` (INTEGER, ×10^8), plus nullable `high`, `low`, `volume` (BIGINT, ×10^8 for high/low; raw integer count for volume).

OHLC columns (`high`, `low`, `volume`) are **not** part of vendor `ppxml2db_init.py`. They are added at runtime by `VENDOR_COLUMN_PATCHES` in `packages/api/src/db/apply-bootstrap.ts` (idempotent `PRAGMA table_info` + `ALTER TABLE ADD COLUMN`), which keeps the vendored SQL pristine for Gate 1 drift-checking while still satisfying the `<latest>` XML-node columns that `ppxml2db.py` actually writes. They are consumed only by chart display; performance / MVE / TTWROR calculations use `value` exclusively.

These are **two separate pipelines**. Never INSERT into `price` from `latest_price`. See `.claude/rules/api.md` for the injection rule.

### Transactions (`xact`)

| Column | Type | Notes |
|--------|------|-------|
| uuid | TEXT PK | |
| type | TEXT | TransactionType enum |
| date | TEXT | `YYYY-MM-DD` |
| amount | INTEGER | Gross amount in hecto-units (×10^2) |
| shares | INTEGER | In ×10^8 units |
| security | TEXT FK | NULL for cash-only types |
| account | TEXT FK | |
| fees, taxes | INTEGER | Hecto-units |

Related tables:
- **`xact_cross_entry`** — links sender/recipient accounts (from_xact, from_acc, to_xact, to_acc)
- **`xact_unit`** — transaction components (type: `'FEE'`, `'TAX'`, `'GROSS_VALUE'`, `'FOREX'`)

### Taxonomies

- **`taxonomy`** — root taxonomy (e.g. "Asset Classes", "Regions")
- **`taxonomy_category`** — hierarchical categories (self-referential via `parent`)
- **`taxonomy_assignment`** — assigns securities/accounts to categories (with `weight` 0-10000)
- **`taxonomy_data`**, **`taxonomy_assignment_data`** — metadata

### Other tables

`watchlist`, `watchlist_security`, `config_entry`, `config_set`, `dashboard`, `property`, `bookmark`.

### Quovibe-owned tables (`vf_*`, ADR-014 + ADR-015)

These live in every portfolio DB alongside the ppxml2db tables. They are created idempotently by `bootstrap.sql` §3, never by runtime DDL.

- **`vf_exchange_rate`** (ADR-014) — composite PK `(date, from_currency, to_currency)` → `rate TEXT`. Live FX data cache, decoupled from PP import. See ADR-014 for triangulation and forward-fill semantics.

- **`vf_portfolio_meta`** — portable portfolio metadata as key/value (`key TEXT PRIMARY KEY`, `value TEXT NOT NULL`). Known keys (readers validate against this allowlist; unknown keys are ignored): `'name'` (user-visible display name, authoritative), `'createdAt'` (ISO-8601), `'source'` (`'fresh' | 'demo' | 'import-pp-xml' | 'import-quovibe-db'`), `'schemaVersion'` (integer, reserved). The sidecar `portfolios[i].name` is an index copy of `vf_portfolio_meta.name`; on pool acquire, drift is self-healed from this table.

- **`vf_dashboard`** — portfolio-scoped dashboards (`id TEXT PK, name, position INTEGER, widgets_json TEXT, schema_version INTEGER DEFAULT 1, columns INTEGER DEFAULT 3, createdAt, updatedAt`). `position` is the single source of truth for tab order; the row with the smallest `position` is the **implicit default** dashboard (what `/p/:portfolioId/dashboard` redirects to). No separate `is_default` / `is_active` flag — "active" is a URL concept (per-tab), "default" is derived from position (per-portfolio). `schema_version` supports migration-on-read via `packages/api/src/services/widget-migrations.ts`; unknown widget `type` strings render as `<UnsupportedWidget>` without truncating the blob.

- **`vf_chart_config`** — portfolio-scoped chart **content** (`chart_id TEXT PK, config_json TEXT, schema_version INTEGER DEFAULT 1, updatedAt`). Scope split is load-bearing: this table holds **only** series references to this portfolio's accounts/securities, per-chart visibility toggles, and benchmark overlay selections. User-level chart **aesthetics** (line thickness, smoothing, palette overrides) are reserved for sidecar `preferences.chartStyle` (empty namespace in v1) so they don't reset when the user switches portfolios. Contributors adding chart fields consult the boundary: references *this portfolio's data* → `vf_chart_config`; about *how the user prefers charts to look* → `preferences.chartStyle`.

- **`vf_csv_import_config`** (renamed from `csv_import_config` in ADR-015) — saved CSV import mappings (`id TEXT PK, name, type, config TEXT, createdAt, updatedAt`).

> Source for all `vf_*` tables: `packages/api/src/db/bootstrap.sql` §3. Drizzle mappings: `packages/api/src/db/schema.ts` (`vfExchangeRates`, `vfPortfolioMeta`, `vfDashboards`, `vfChartConfigs`, `vfCsvImportConfigs`).

### Analytical indexes (`bootstrap.sql` §4)

Six performance-driven indexes layered on top of the ppxml2db baseline (none touch vendor tables structurally, all `IF NOT EXISTS`):

- `idx_xact_date` on `xact(date)`
- `idx_xact_security` on `xact(security)`
- `idx_xact_cross_entry_from_acc` on `xact_cross_entry(from_acc)`
- `idx_xact_cross_entry_to_acc` on `xact_cross_entry(to_acc)`
- `idx_price_date` on `price(tstamp)`
- `idx_price_security_date` on `price(security, tstamp)`

These are quovibe-owned and may be extended subject to the parity tests; new indexes go into §4 of `bootstrap.sql` (never inline in service code).

## Unit conventions (ppxml2db)

| Field | Storage | Conversion |
|-------|---------|------------|
| shares | ×10^8 | `new Decimal(row.shares).div(1e8)` |
| prices | ×10^8 | `new Decimal(row.value).div(1e8)` |
| amounts | ×10^2 (hecto) | `new Decimal(row.amount).div(100)` |

Conversion happens **ONLY ONCE** in the service layer (`packages/api/src/services/unit-conversion.ts`). Never in the router, engine, or frontend.

## Amount source of truth

- `xact.amount` = **net settlement value** (not gross). For inflow types (DIVIDEND, SELL, INTEREST, etc.): `amount = gross − fees − taxes`. For outflow types (BUY, etc.): `amount = gross + fees + taxes`. See `docs/architecture/implementation-verified.md` for authoritative proof.
- Gross must be **reconstructed** via `getGrossAmount(tx)` from `packages/engine/src/helpers/transaction-amounts.ts`.
- `xact_unit` type `GROSS_VALUE` = gross amount with optional forex data.

**Rule**: for financial calculations ALWAYS use `xact_unit` or `getGrossAmount()`. Never assume `xact.amount` is gross.

> Source for helpers: `packages/engine/src/helpers/transaction-amounts.ts` — `getGrossAmount()`, `getFees()`, `getTaxes()`, `getNetAmount()`

## Account types in ppxml2db

The `account.type` field contains lowercase strings:
- `'account'` → deposit account (cash account) → `AccountType.DEPOSIT`
- `'portfolio'` → securities account (brokerage account) → `AccountType.SECURITIES`

## Schema verification

At startup, `packages/api/src/db/verify.ts` checks that all required ppxml2db tables exist and that column types match expectations.
