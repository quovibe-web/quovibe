-- ═══════════════════════════════════════════════════════════════════════
-- quovibe bootstrap DDL
--
-- Applied on every openDatabase() call. Idempotent.
-- Used as the schema source for tests and demo generation.
-- Applied AFTER ppxml2db.py during import-pp-xml (see ADR-015 §3.4) so
--   the vendor DDL runs on an empty DB without "table already exists" errors.
--
-- ⚠️ LOAD-BEARING ORDERING INVARIANT ⚠️
--   The import-pp-xml pipeline is ORDER-SENSITIVE: ppxml2db.py must run
--   FIRST against an empty file, THEN this script runs against the populated
--   file. Running this script first would pre-create ppxml2db's tables, and
--   ppxml2db.py's own CREATE TABLE statements (which LACK "IF NOT EXISTS")
--   would then fail with "table already exists".
--   If vendored ppxml2db is ever upgraded from a new upstream, re-verify
--   this invariant manually — see the spec §3.4 for the test command.
--
-- Deviations from raw ppxml2db_init.py output:
--   - IF NOT EXISTS added to every CREATE TABLE / CREATE INDEX.
--     Purpose: allow idempotent re-runs on already-populated DBs.
--   - ALTER TABLE ADD COLUMN IF NOT EXISTS is allowed for future column
--     additions (SQLite 3.35+; better-sqlite3 12.8 is well past that).
-- ═══════════════════════════════════════════════════════════════════════

-- §1 ppxml2db tables (24, verbatim from ppxml2db_init.py with IF NOT EXISTS added)
CREATE TABLE IF NOT EXISTS account(
_id INTEGER NOT NULL PRIMARY KEY,
uuid VARCHAR(36) NOT NULL UNIQUE,
type VARCHAR(10) NOT NULL,
name VARCHAR(128),
referenceAccount VARCHAR(36) REFERENCES account(uuid),
currency VARCHAR(16),
note TEXT,
isRetired INT NOT NULL DEFAULT 0,
updatedAt VARCHAR(64) NOT NULL,
_xmlid INT NOT NULL,
_order INT NOT NULL
);
CREATE TABLE IF NOT EXISTS account_attr(
account VARCHAR(36) NOT NULL REFERENCES account(uuid),
attr_uuid VARCHAR(36) NOT NULL,
type VARCHAR(32) NOT NULL,
value TEXT,
seq INT NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS security(
_id INTEGER NOT NULL PRIMARY KEY,
uuid VARCHAR(36) NOT NULL UNIQUE,
onlineId VARCHAR(64),
name VARCHAR(255),
-- Yes, can be absent (dax.xml).
currency VARCHAR(16),
targetCurrency VARCHAR(16),
note TEXT,
isin VARCHAR(16),
tickerSymbol VARCHAR(32),
calendar VARCHAR(32),
wkn VARCHAR(32),
feedTickerSymbol VARCHAR(32),
feed VARCHAR(32),
feedURL VARCHAR(512),
latestFeed VARCHAR(32),
latestFeedURL VARCHAR(512),
isRetired INT NOT NULL DEFAULT 0,
updatedAt VARCHAR(64) NOT NULL
);
CREATE TABLE IF NOT EXISTS security_attr(
security VARCHAR(36) NOT NULL REFERENCES security(uuid),
attr_uuid VARCHAR(36) NOT NULL,
type VARCHAR(32) NOT NULL,
value TEXT,
seq INT NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS security_event(
_id INTEGER NOT NULL PRIMARY KEY,
security VARCHAR(36) NOT NULL REFERENCES security(uuid),
date VARCHAR(36) NOT NULL,
type VARCHAR(32) NOT NULL,
details TEXT
);
CREATE TABLE IF NOT EXISTS security_prop(
security VARCHAR(36) NOT NULL REFERENCES security(uuid),
type VARCHAR(32) NOT NULL,
name VARCHAR(36) NOT NULL,
value TEXT,
seq INT NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS latest_price(
security VARCHAR(36) NOT NULL PRIMARY KEY REFERENCES security(uuid),
tstamp VARCHAR(32) NOT NULL,
value BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS price(
security VARCHAR(36) NOT NULL REFERENCES security(uuid),
tstamp VARCHAR(32) NOT NULL,
value BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS watchlist(
_id INTEGER NOT NULL PRIMARY KEY,
name VARCHAR(64) NOT NULL,
_order INT NOT NULL
);
CREATE TABLE IF NOT EXISTS watchlist_security(
list INT NOT NULL REFERENCES watchlist(_id),
security VARCHAR(36) NOT NULL REFERENCES security(uuid)
);
CREATE TABLE IF NOT EXISTS xact(
_id INTEGER NOT NULL PRIMARY KEY,
uuid VARCHAR(36) NOT NULL UNIQUE,
acctype VARCHAR(10) NOT NULL, -- requires to instantiate AccountTransaction vs PortfolioTransaction, but redundant otherwise
account VARCHAR(36) NOT NULL REFERENCES account(uuid),
date VARCHAR(32) NOT NULL,
currency VARCHAR(16) NOT NULL,
amount BIGINT NOT NULL,
security VARCHAR(36) REFERENCES security(uuid),
shares BIGINT NOT NULL,
note TEXT,
source VARCHAR(255),
updatedAt VARCHAR(64) NOT NULL,
type VARCHAR(20) NOT NULL,
fees BIGINT NOT NULL DEFAULT 0,
taxes BIGINT NOT NULL DEFAULT 0,
_xmlid INT NOT NULL,
_order INT NOT NULL
);
CREATE TABLE IF NOT EXISTS xact_unit(
xact VARCHAR(36) NOT NULL REFERENCES xact(uuid),
type VARCHAR(16) NOT NULL,
amount BIGINT NOT NULL,
currency VARCHAR(16) NOT NULL,
forex_amount BIGINT,
forex_currency VARCHAR(16),
-- The exchangeRate is arbitrary-precision float, so we store it as a
-- string (actually, Sqlite is known to ignore the column type and use
-- "duck typing" for values, i.e. it may convert string looking like float
-- into (limited-precision) float, so if any issues are seen, we may need
-- to add more guards).
exchangeRate VARCHAR(16)
);
CREATE TABLE IF NOT EXISTS xact_cross_entry(
type VARCHAR(32) NOT NULL,
from_acc VARCHAR(36) REFERENCES account(uuid),
from_xact VARCHAR(36) REFERENCES xact(uuid),
to_acc VARCHAR(36) NOT NULL REFERENCES account(uuid),
to_xact VARCHAR(36) NOT NULL REFERENCES xact(uuid)
);
CREATE TABLE IF NOT EXISTS taxonomy(
_id INTEGER NOT NULL PRIMARY KEY,
uuid VARCHAR(36) NOT NULL UNIQUE,
name VARCHAR(100) NOT NULL,
root VARCHAR(36) NOT NULL -- REFERENCES taxonomy_category(uuid), -- commented out to avoid circular dependency
);
CREATE TABLE IF NOT EXISTS taxonomy_category(
_id INTEGER NOT NULL PRIMARY KEY,
uuid VARCHAR(36) NOT NULL UNIQUE,
taxonomy VARCHAR(36) NOT NULL REFERENCES taxonomy(uuid),
parent VARCHAR(36) REFERENCES taxonomy_category(uuid),
name VARCHAR(100) NOT NULL,
color VARCHAR(100) NOT NULL,
weight INT NOT NULL,
rank INT NOT NULL
);
CREATE TABLE IF NOT EXISTS taxonomy_data(
taxonomy VARCHAR(36) NOT NULL REFERENCES taxonomy(uuid),
-- Can be NULL for taxonomy-level data
category VARCHAR(36) REFERENCES taxonomy_category(uuid),
name VARCHAR(64) NOT NULL,
type VARCHAR(64) NOT NULL DEFAULT '',
value VARCHAR(256) NOT NULL
);
CREATE TABLE IF NOT EXISTS taxonomy_assignment(
_id INTEGER NOT NULL PRIMARY KEY,
-- redundant from DB normal form point of view, but helpful for actual
-- operations on particilar item and taxonomy.
taxonomy VARCHAR(36) NOT NULL REFERENCES taxonomy(uuid),
category VARCHAR(36) NOT NULL REFERENCES taxonomy_category(uuid),
item_type VARCHAR(32) NOT NULL,
-- Can refer to different things, e.g. security, account, etc., so we don't
--- use referential integrity at the DB level.
item VARCHAR(36) NOT NULL,
weight INT NOT NULL DEFAULT 10000,
rank INT NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS taxonomy_assignment_data(
assignment INT NOT NULL REFERENCES taxonomy_assignment(_id),
name VARCHAR(64) NOT NULL,
type VARCHAR(64) NOT NULL,
value VARCHAR(256) NOT NULL
);
CREATE TABLE IF NOT EXISTS dashboard(
_id INTEGER NOT NULL PRIMARY KEY,
id VARCHAR(64) NOT NULL,
name VARCHAR(64) NOT NULL,
config_json TEXT NOT NULL,
columns_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS property(
name VARCHAR(64) NOT NULL,
special INT NOT NULL DEFAULT 0,
value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS bookmark(
_id INTEGER NOT NULL PRIMARY KEY,
label VARCHAR(64) NOT NULL,
pattern VARCHAR(256) NOT NULL
);
CREATE TABLE IF NOT EXISTS attribute_type(
_id INTEGER NOT NULL PRIMARY KEY,
id VARCHAR(64) NOT NULL,
name VARCHAR(64) NOT NULL,
columnLabel VARCHAR(64) NOT NULL,
source VARCHAR(128),
target VARCHAR(128) NOT NULL,
type VARCHAR(128) NOT NULL,
converterClass VARCHAR(128) NOT NULL,
props_json TEXT
);
CREATE TABLE IF NOT EXISTS config_set(
_id INTEGER NOT NULL PRIMARY KEY,
name VARCHAR(64) NOT NULL
);
CREATE TABLE IF NOT EXISTS config_entry(
config_set INT NOT NULL REFERENCES config_set(_id),
uuid VARCHAR(255), -- not really a uuid, more like id
name VARCHAR(255),
data TEXT
);

-- §2 ppxml2db indexes (with IF NOT EXISTS added)
CREATE UNIQUE INDEX IF NOT EXISTS account__uuid ON account(uuid);
CREATE UNIQUE INDEX IF NOT EXISTS security__uuid ON security(uuid);
CREATE INDEX IF NOT EXISTS security__tickerSymbol ON security(tickerSymbol);
CREATE INDEX IF NOT EXISTS security_attr__security ON security_attr(security);
CREATE UNIQUE INDEX IF NOT EXISTS security_attr__security_attr_uuid ON security_attr(security, attr_uuid);
CREATE INDEX IF NOT EXISTS security_prop__security ON security_prop(security);
CREATE UNIQUE INDEX IF NOT EXISTS price__security_tstamp ON price(security, tstamp);
CREATE INDEX IF NOT EXISTS watchlist_security__list ON watchlist_security(list);
CREATE UNIQUE INDEX IF NOT EXISTS xact__uuid ON xact(uuid);
CREATE INDEX IF NOT EXISTS xact__account ON xact(account);
CREATE INDEX IF NOT EXISTS xact_unit__xact ON xact_unit(xact);
CREATE INDEX IF NOT EXISTS xact_cross_entry__from_xact ON xact_cross_entry(from_xact);
CREATE INDEX IF NOT EXISTS xact_cross_entry__to_xact ON xact_cross_entry(to_xact);
CREATE UNIQUE INDEX IF NOT EXISTS taxonomy__uuid ON taxonomy(uuid);
CREATE UNIQUE INDEX IF NOT EXISTS taxonomy_category__uuid ON taxonomy_category(uuid);
CREATE INDEX IF NOT EXISTS taxonomy_data__taxonomy ON taxonomy_data(taxonomy);
CREATE INDEX IF NOT EXISTS taxonomy_data__category ON taxonomy_data(category);
CREATE INDEX IF NOT EXISTS taxonomy_assignment__item_type_item ON taxonomy_assignment(item_type, item);
CREATE UNIQUE INDEX IF NOT EXISTS property__name ON property(name);

-- ═══ QUOVIBE SECTION BEGIN ═══
-- Everything above this marker is derived from ppxml2db_init.py (see Gate 1).
-- Everything below is quovibe-owned. Gate 1 strips from this line down before
-- comparing against ppxml2db's output. DO NOT rename this marker.

-- §3 quovibe-owned tables (vf_* prefix per ADR-014 convention)

CREATE TABLE IF NOT EXISTS vf_exchange_rate (
  date TEXT NOT NULL,
  from_currency TEXT NOT NULL,
  to_currency TEXT NOT NULL,
  rate TEXT NOT NULL,
  PRIMARY KEY (date, from_currency, to_currency)
);

-- Portable portfolio metadata — travels with the DB on export/import.
-- Key-value so the shape can evolve without schema churn.
--
-- KNOWN KEYS (the allowlist readers must recognize):
--   'name'          — user-visible display name (non-empty, authoritative)
--   'createdAt'     — ISO-8601 timestamp of portfolio creation
--   'source'        — 'fresh' | 'demo' | 'import-pp-xml' | 'import-quovibe-db'
--   'schemaVersion' — integer (reserved; use if a breaking vf_* change ever arrives)
--
-- Readers MUST validate against this allowlist and ignore unknown keys.
CREATE TABLE IF NOT EXISTS vf_portfolio_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Portfolio-scoped dashboards. `position` is the single source of truth for
-- ordering; the row with the smallest position is the implicit DEFAULT
-- dashboard. There is no separate is_active or is_default flag.
CREATE TABLE IF NOT EXISTS vf_dashboard (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  position INTEGER NOT NULL,
  widgets_json TEXT NOT NULL,
  schema_version INTEGER NOT NULL DEFAULT 1,
  columns INTEGER NOT NULL DEFAULT 3,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

-- Portfolio-scoped chart CONTENT — series references to THIS portfolio's accounts
-- and securities, per-chart visibility toggles, benchmark overlay selections.
-- User-level aesthetic preferences (line thickness, smoothing) live in sidecar.
CREATE TABLE IF NOT EXISTS vf_chart_config (
  chart_id TEXT PRIMARY KEY,
  config_json TEXT NOT NULL,
  schema_version INTEGER NOT NULL DEFAULT 1,
  updatedAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS vf_csv_import_config (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  config TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

-- §4 quovibe analytical indexes (performance-driven)
CREATE INDEX IF NOT EXISTS idx_xact_date                  ON xact(date);
CREATE INDEX IF NOT EXISTS idx_xact_security              ON xact(security);
CREATE INDEX IF NOT EXISTS idx_xact_cross_entry_from_acc  ON xact_cross_entry(from_acc);
CREATE INDEX IF NOT EXISTS idx_xact_cross_entry_to_acc    ON xact_cross_entry(to_acc);
CREATE INDEX IF NOT EXISTS idx_price_date                 ON price(tstamp);
CREATE INDEX IF NOT EXISTS idx_price_security_date        ON price(security, tstamp);
