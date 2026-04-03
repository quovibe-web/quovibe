# Database Schema (ppxml2db-compliant)

The schema faithfully follows the structure created by ppxml2db. Drizzle ORM maps the existing tables without destructive migrations.

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
- **`latest_price`** — last known quote (scalar per security). Columns: `security` (PK, FK), `tstamp`, `value` (INTEGER, ×10^8).

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

> Source for quovibe extensions: `packages/api/src/db/extensions.ts` — adds `vf_exchange_rate` table and secondary indexes.

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
