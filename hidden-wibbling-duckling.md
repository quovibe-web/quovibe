# DB Schema Drift Audit — quovibe

**Scope:** Strict read-only audit of DB schema, ORM, TS types, routes, and bootstrap against the authoritative baseline databases in `zz_SOT_DB/` (virgin.db, fresh_import.db).

**Status:** AUDIT ONLY — no fixes proposed. Do NOT act on any finding without explicit approval.

**Date:** 2026-04-11 — branch `feature/pnl`

---

## TL;DR

The schema is **not** 100% intact. Drift exists on three axes:

1. **One extra runtime table: `vf_exchange_rate`** — legit quovibe FX cache, but created unconditionally at every boot in `db/extensions.ts:80` *and* `db/verify.ts:81` (duplicated DDL). Not in baseline.
2. **One ghost table declared in Drizzle but never created at boot: `csv_import_config`** (`db/schema.ts:242`). Prod DBs that don't come from `seed-demo.ts` will throw `no such table: csv_import_config` the first time `csv-config.service.ts` runs.
3. **Destructive one-shot rewrite of `latest_price`** (`db/verify.ts:131-146`) that silently **drops the baseline `high, low, volume` columns** on first open, rebuilding the table with only `security, tstamp, value`. Same under-declaration exists in `db/schema.ts:90-102` for both `price` and `latest_price`. This is the most dangerous finding — it is lossy.

Plus: 6 secondary indexes created at every boot, WAL mode, 2 guarded `ALTER TABLE security ADD COLUMN`, and 3 governance gaps that would have caught this early if they existed.

---

## Baseline (source of truth)

`zz_SOT_DB/virgin.db` and `zz_SOT_DB/fresh_import.db` — both **24 tables**, byte-identical structures. File sizes:

| File | Bytes | Pages (×4096) | Tables |
|---|---:|---:|---:|
| `zz_SOT_DB/virgin.db` | 217,088 | 53 | 24 |
| `zz_SOT_DB/fresh_import.db` | 3,305,472 | 807 | 24 |
| `data/schema.db` | 217,088 | 53 | 24 (matches virgin) |
| `data/portfolio.db` | **4,870,144** | **1,189** | **25** (extra `vf_exchange_rate`) |

Baseline tables (24): `account, account_attr, attribute_type, bookmark, config_entry, config_set, dashboard, latest_price, price, property, security, security_attr, security_event, security_prop, taxonomy, taxonomy_assignment, taxonomy_assignment_data, taxonomy_category, taxonomy_data, watchlist, watchlist_security, xact, xact_cross_entry, xact_unit`.

Baseline has **zero** triggers, **zero** views, and 20 indexes. Relevant column facts:
- `price` / `latest_price` = `security, tstamp, value, high, low, volume` (6 columns each).
- `xact` has no OHLC, no market_value, no cost_basis, no fxRate.
- `security` has no `pathToDate/pathToClose/pathToHigh/pathToLow/pathToVolume/dateFormat/dateTimezone/factor`.

---

## Check 1 — Schema files (Drizzle / SQL) vs baseline

### 1.A — Extra tables declared

| Table | Declared in | Created at boot? | Verdict |
|---|---|---|---|
| `vf_exchange_rate` | `packages/api/src/db/extensions.ts:5` (Drizzle) **AND** `packages/api/src/db/verify.ts:81` (raw DDL, duplicate) | ✅ every `openDatabase()` call | **Extra table.** Intentional quovibe FX cache, but outside the 24-table SoT. Duplicated DDL. |
| `csv_import_config` | `packages/api/src/db/schema.ts:242` (Drizzle only) | ❌ never — only created by `scripts/seed-demo.ts:259` | **Extra table — ghost in prod.** Consumed by `packages/api/src/services/csv/csv-config.service.ts`. Prod DBs that were bootstrapped from `data/schema.db` will throw `no such table: csv_import_config` on first use. |

### 1.B — Missing columns in Drizzle `schema.ts` (baseline has them, Drizzle doesn't)

| Baseline table | Baseline columns | Drizzle columns | Missing |
|---|---|---|---|
| `price` | `security, tstamp, value, high, low, volume` | `security, tstamp, value` (`schema.ts:90-94`) | **`high, low, volume`** |
| `latest_price` | `security, tstamp, value, high, low, volume` | `security, tstamp, value` (`schema.ts:96-102`) | **`high, low, volume`** |

This under-declaration is **load-bearing** because `verify.ts:131-146` uses Drizzle's narrow shape when rebuilding `latest_price` — see Check 4.

### 1.C — Extra columns on baseline tables

None detected in `schema.ts` itself. Drizzle faithfully reflects the baseline column set on all 22 tables it declares (minus the OHLC fields above).

### 1.D — Type / nullability mismatches

- `schema.ts:93, 101, 112, 137` — `integer()` used for columns baseline declares as `BIGINT` (`price.value`, `latest_price.value`, `xact.amount`, `xact_unit.amount`). Affinity-wise identical, but `verify.ts:57-62 verifyColumnTypes()` specifically warns when the declared type is not literally `BIGINT`. Latent warning source.
- `schema.ts:17-18, 122-123` — `_xmlid`, `_order` declared `.notNull()` without defaults. Any new insert path must remember to supply them; otherwise runtime constraint error.

### 1.E — Migration files

- **No Drizzle migrations**, no `drizzle/` or `migrations/` folder, no hand-written `.sql` migration files.
- `packages/api/vendor/*.sql` = 24 reference files copied from upstream ppxml2db. Not executed at runtime. **Stale vs baseline:**
  - `vendor/price.sql` and `vendor/latest_price.sql` each declare only 3 columns (`security, tstamp, value`), **disagreeing with `virgin.db`'s 6-column reality.**
  - `vendor/xact_cross_entry.sql` declares indexes `xact_cross_entry__from_xact`, `xact_cross_entry__to_xact` — neither exists in `virgin.db`, and quovibe boot creates different ones (`idx_xact_cross_entry_from_acc`, `idx_xact_cross_entry_to_acc`).
- `scripts/seed-demo.ts:60-267` — 25 `CREATE TABLE` statements for demo-only DB. Drifts further:
  - Adds `open` column to `price` / `latest_price` (neither baseline nor Drizzle has it).
  - Creates `csv_import_config` (the 25th table).

---

## Check 2 — TypeScript interfaces / DTOs / Zod schemas

Audit covered `packages/api/src/**` and `packages/shared/src/**` for any field implying DB-backed state that doesn't exist in baseline columns.

### 2.A — Phantom OHLC column on `price` (HIGH CONFIDENCE DRIFT)

`packages/api/src/services/unit-conversion.ts`
- `:22` `DbPriceRow` — declares `open: number | null`.
- `:26` `ConvertedPrice`, `:34` `DbPriceWrite` — same field.
- `:54-60` `convertPriceFromDb()` — reads `row.open`.
- `:70-108` `convertPriceToDb()` — **writes** an `open` field.

Baseline `price` table has **no `open` column**. This is a phantom column in both directions of the conversion function. It is currently harmless because:
- Drizzle `prices` schema doesn't include `open` either, so `db.insert(prices).values(...)` never sends it.
- Raw SQL writes in services/routes don't reference `open`.
- But any consumer using `convertPriceFromDb` against a real row will read `undefined` as `open`, and any writer that round-trips through `convertPriceToDb` and then tries to `INSERT INTO price (..., open) VALUES (..., ?)` will throw `no such column: open`.

Likely a half-landed OHLC feature.

### 2.B — `packages/shared/src/types/security.ts:1` `Security` — fields not on `security` table

Non-existent columns asserted on the row type:
- `pathToDate`, `pathToClose`, `pathToHigh`, `pathToLow`, `pathToVolume`
- `dateFormat`, `dateTimezone`, `factor`

These are legacy PP feed-configuration fields that **actually belong in `security_prop`** (a valid baseline table), but the TS type surfaces them as if they were columns on `security`. This is a public shared type exported from `@quovibe/shared`, so any consumer that tries to read `security.pathToClose` from a DB-fetched row will get `undefined`.

Also: `name` and `currency` declared non-nullable here; baseline allows NULL on both.

### 2.C — `fxRate` surface

- `packages/shared/src/schemas/transaction.schema.ts:29` — `createTransactionSchema.fxRate` (input DTO) → maps to `xact_unit.exchangeRate`. **OK** (DTO-level rename).
- `packages/shared/src/types/transaction.ts:24` — `TransactionUnit.fxRate: number | null` — domain rename of the baseline `xact_unit.exchangeRate` column. **OK** (rename).
- `packages/api/src/services/performance.service.ts:113` — hardcodes `fxRate: null` in `parseRawRow()`. The field is never populated from a DB row. Latent overclaiming in the shared type.

### 2.D — OHLC on xact / marketValue / costBasis / persisted PnL

Clean at the row level:
- **No** OHLC fields on any `xact` / `XactRow` / `TransactionRow` type.
- **No** `marketValue` persisted on `security`. All `marketValue` usages are in response DTOs and service result types (`StatementSecurityEntry`, `HoldingsItem`, `OpenPositionPnLBreakdown`, etc.) — computed at read time.
- **No** persisted `costBasis` / `averageCost`. All compute paths in `packages/engine/src/cost/moving-average.ts` and `packages/api/src/services/accounts.service.ts:121-131`.

### 2.E — `createdAt` / `deletedAt` / `tombstone` / `version` on baseline tables

None found. Only `csvImportConfigs.createdAt` at `schema.ts:247`, but that's on the non-baseline `csv_import_config` table (already flagged in Check 1).

### 2.F — `$inferSelect` / `$inferInsert` hot spots

**Zero matches** across the repo. Drizzle type inference is not used. All row-type interfaces are hand-written `interface XactRow { … }` shapes duplicated across tests/services, plus ad-hoc `as { … }` casts on `sqlite.prepare(...)` calls. This means drizzle-level widening is NOT the risk — hand-rolled interfaces and raw-SQL casts are.

---

## Check 3 — Routes / services writing to non-baseline tables or fields

### 3.A — Writes to `vf_exchange_rate` (the 25th table)

| File | Line | Operation |
|---|---|---|
| `packages/api/src/services/fx-fetcher.service.ts` | 100 | `INSERT OR REPLACE INTO vf_exchange_rate (date, from_currency, to_currency, rate)` — only on explicit "fetch FX" user action |
| `packages/api/src/services/fx.service.ts` | 28-32, 37-41, 110-115 | Reads only |

No route handler writes to `vf_exchange_rate` directly.

### 3.B — Route handlers with direct DB writes (governance-rule violations)

Governance rule **G14** (`scripts/check-governance.ts:352-376`) requires `// db-route-ok` on any route-level direct DB write. Violations found:

| File | Line | Statement | Tagged? |
|---|---|---|---|
| `packages/api/src/routes/portfolio.ts` | 87-91 | `INSERT INTO property (name, special, value) VALUES (?,0,?) ON CONFLICT(name) DO UPDATE SET value = excluded.value` | ❌ no `// db-route-ok` |
| `packages/api/src/routes/taxonomies.ts` | 156-158 | `UPDATE taxonomy_category SET weight = ? WHERE uuid = ?` | ❌ no `// db-route-ok` |

Both write only to **baseline** tables (`property`, `taxonomy_category`), so they don't introduce schema drift — but they indicate `pnpm check:governance` is not being run in CI (or they were introduced after the last clean run).

### 3.C — Direct DB writes outside the service layer — non-baseline columns

None detected. No SELECT/INSERT/UPDATE touches `open`, `pathToClose`, `pathToDate`, `marketValue`, `costBasis`, or any non-baseline column. The phantom `open` in `unit-conversion.ts` is wired through helper functions but never executed against the DB.

### 3.D — Tests that `CREATE TABLE vf_exchange_rate` in fixtures

`vf_exchange_rate` is created in ~18 test files:
`packages/api/src/__tests__/{accounting-equation,benchmark,calculation-items,fee-double-entry-guard,movers,security-series,retired-securities,resolve-series,open-position-pnl}.test.ts`, `packages/api/src/routes/__tests__/multi-currency.test.ts`, `packages/api/src/services/__tests__/{fx-service,open-position-pnl}.test.ts`, `packages/api/src/tests/read-audit/{securities-prices-read-parity,performance-taxonomy-read-parity,integration-regression}.test.ts`.

Expected given that the feature exists. Flagged only for completeness.

---

## Check 4 — Bootstrap / init process and size inflation

### 4.A — Boot sequence (first run against a missing `portfolio.db`)

1. **`packages/api/src/index.ts:1`** imports `./bootstrap` at module load.
2. **`bootstrap.ts` `needsBootstrap()`** — checks existence of `DB_PATH` and counts rows in `sqlite_master` for `account`. If empty/missing → needs bootstrap.
3. **Copy** — resolves `schema.db` (candidates: `data/schema.db`, `/app/bootstrap/schema.db`, `$SCHEMA_PATH`) and `fs.copyFileSync(schema.db → portfolio.db)`, deletes stale `-wal`/`-shm`. After this: **217,088 bytes, 53 pages, 24 tables, zero indexes beyond baseline.**
4. **`openDatabase(DB_PATH)`** (`db/open-db.ts:20`) opens the handle and runs:
   - `pragma('journal_mode = WAL')` — rewrites page 1, spawns `-wal`/`-shm` sidecars.
   - `pragma('synchronous = FULL')`
   - `pragma('foreign_keys = ON')`
5. **`verifySchema(db)`** (read-only, 11 REQUIRED + 13 OPTIONAL tables).
6. **`verifyColumnTypes(db)`** (read-only, console.warn).
7. **`applyExtensions(db)`** (`db/extensions.ts:79` → runs DDL listed in 4.B).
8. **`createApp(db, sqlite)` → `loadSettings()` → `migrateLastImportFromDb(sqlite)` → `PriceScheduler.start()`.**

### 4.B — DDL that `applyExtensions` executes on every `openDatabase()` (not just first boot)

| Operation | File:line | Idempotent? | Structural effect |
|---|---|---|---|
| `CREATE TABLE IF NOT EXISTS vf_exchange_rate (...)` | `verify.ts:81` (and duplicated at `extensions.ts:80`) | yes | **Adds the 25th table** on any DB that doesn't have it |
| `CREATE TABLE IF NOT EXISTS property (...)` | `verify.ts:93` | yes | no-op on baseline (already present) |
| `CREATE TABLE IF NOT EXISTS account_attr (...)` | `verify.ts:101` | yes | no-op on baseline (already present) |
| 6 × `CREATE INDEX IF NOT EXISTS` on `xact(date)`, `xact(security)`, `xact_cross_entry(from_acc)`, `xact_cross_entry(to_acc)`, `price(tstamp)`, `price(security, tstamp)` | `verify.ts:111-119` | yes | **Adds 6 non-baseline indexes.** On populated data, these are the dominant source of file growth. |
| `ALTER TABLE security ADD COLUMN calendar TEXT` (try/catch) | `verify.ts:125` | yes (swallowed) | no-op on baseline |
| `ALTER TABLE security ADD COLUMN updatedAt TEXT` (try/catch) | `verify.ts:126` | yes (swallowed) | no-op on baseline |
| **`latest_price` destructive rebuild** | `verify.ts:131-146` | yes (after first run) | **DROPS baseline `high, low, volume` columns.** Reads `PRAGMA table_info(latest_price)`; if `security` is not a PK column (which is true in `virgin.db`), creates `latest_price_new` with **only** `security PK, tstamp, value`, copies data, drops old table, renames new. Irreversible column loss. |
| 3 × `UPDATE xact_cross_entry SET type = ...` migrations | `verify.ts:152-159` | yes | normalizes legacy enum values; data-level only |

### 4.C — Why `portfolio.db` inflates on first boot

File-size math (`page_size = 4096`, `freelist_count = 0` for both):
- `fresh_import.db` = 807 pages × 4096 = 3,305,472 bytes
- `portfolio.db` = 1,189 pages × 4096 = 4,870,144 bytes
- **Delta = 382 pages ≈ 1.56 MB**

Objects in `portfolio.db` but NOT in `fresh_import.db`:
- Table: `vf_exchange_rate` + its autoindex (2 root pages, ~8 KB, empty — row count 0)
- 6 secondary indexes: `idx_xact_date`, `idx_xact_security`, `idx_xact_cross_entry_from_acc`, `idx_xact_cross_entry_to_acc`, `idx_price_date`, `idx_price_security_date`

Objects in `fresh_import.db` NOT in `portfolio.db`:
- Index `latest_price__security` — **destroyed** by the one-shot rebuild in `verify.ts:131-146`

**Conclusion:** the ~1.56 MB delta is almost entirely the **6 secondary b-tree indexes over the populated `xact` / `price` / `xact_cross_entry` tables**. `price` alone typically holds years of daily rows for every security — two full indexes on it (`idx_price_date`, `idx_price_security_date`) easily account for hundreds of KB each. The `vf_exchange_rate` table is empty and contributes ~8 KB. WAL mode does not materially grow the main file.

**The user's observation ("inflates on first boot even when no new data is written") is correct and fully explained:** the app doesn't import new rows, but `applyExtensions` structurally mutates the DB on every boot — it adds a table, creates 6 indexes over existing data, rebuilds `latest_price` lossily, adds two columns to `security`, and switches journal mode. No `VACUUM` is ever run.

### 4.D — Meta tables

No `__drizzle_migrations`, `_litestream_seq`, `_litestream_lock`, FTS, or any other meta table in `portfolio.db`. The 25th table is strictly `vf_exchange_rate` and it is empty.

---

## Cross-cutting findings

1. **Duplicated `vf_exchange_rate` DDL** — defined once in `extensions.ts:80-88` and **again** in `verify.ts:81-89` with the exact same body. Dead duplication, one of the two should be the single source.
2. **`applyExtensions` runs on every `openDatabase()` call**, not just first boot. The `IF NOT EXISTS` guards and one-shot PK-check make it idempotent, but this means any fresh DB opened by the API is immediately diverged from SoT — including baseline DBs opened read-only for debugging. (The `verify.ts:131-146` `latest_price` rebuild in particular will always run against a virgin copy.)
3. **`verifySchema` has no allow/deny list for extra tables.** It only checks that required tables exist; it will never warn about a 25th, 26th, or 27th table appearing.
4. **No bootstrap-path reference to `schema.db` inside `open-db.ts` / `verify.ts`.** The copy is done in `bootstrap.ts`, and after that the handle is open against a plain file — nothing inside `openDatabase()` knows where the file came from. Any future "oops I opened the SoT" will mutate it.

## Governance gaps

| Check | Script | Gap |
|---|---|---|
| G12 (schema↔test DDL) | `scripts/check-governance.ts:477-564` | Only diffs **test-file** `CREATE TABLE` against `schema.ts`. Ignores raw DDL in `extensions.ts` / `verify.ts`. |
| G14 (no direct writes in routes) | `scripts/check-governance.ts:352-376` | Only scans `routes/**`. Would not have caught `vf_exchange_rate` because the write lives in `services/fx-fetcher.service.ts`. Currently **failing open** on `routes/portfolio.ts:89` and `routes/taxonomies.ts:157` (unannotated direct writes). Suggests `pnpm check:governance` is not wired into CI. |
| A10 (schema↔vendor SQL parity) | `scripts/check-architecture.ts:310-417` | Only iterates over `packages/api/vendor/*.sql`. `extensions.ts` tables and tables defined outside `vendor/` are invisible to it. `vf_exchange_rate` is invisible. |
| (none) | — | **No check compares the runtime DB's `sqlite_master` against `zz_SOT_DB/virgin.db`.** Nothing enforces "portfolio.db shape = 24-table SoT + documented extensions". |

---

## Evidence appendix — commands used

```bash
# From packages/api dir (where better-sqlite3 is installed):
cd packages/api && node -e "
const D=require('better-sqlite3');
const d=new D('../../zz_SOT_DB/virgin.db',{readonly:true});
console.log(d.prepare(\"SELECT name,sql FROM sqlite_master WHERE type='table' ORDER BY name\").all());
"
# Same for fresh_import.db and data/portfolio.db
# Used PRAGMA page_count, PRAGMA freelist_count, PRAGMA table_info(...) for size math.
```

---

## What this audit deliberately does NOT include

- ❌ No code fixes.
- ❌ No proposed schema changes.
- ❌ No recommendations on whether to keep `vf_exchange_rate` / `csv_import_config` or remove them.
- ❌ No decision on whether to restore `high/low/volume` on `price` / `latest_price`.

Per the user's instructions, this report is strictly diagnostic. Await explicit direction before any remediation.
