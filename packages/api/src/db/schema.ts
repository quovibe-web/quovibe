// Drizzle ORM view of the schema. Hand-maintained.
//
// DDL source of truth is `packages/api/src/db/bootstrap.sql` (ADR-015) — this
// file mirrors it for the ORM/typing layer only. Parity is enforced at
// merge-time by `bootstrap-parity.test.ts` (Gate 2): any column added/removed
// here without the matching change in `bootstrap.sql` (or the
// `VENDOR_COLUMN_PATCHES` map in `apply-bootstrap.ts` for vendor tables) will
// fail CI. Never add table-creation or alter-table DDL outside those two
// locations (governance gate G12 enforces this at the file-content level).
import {
  sqliteTable, text, integer, primaryKey,
} from 'drizzle-orm/sqlite-core';

// ─── ACCOUNTS ─────────────────────────────────────

export const accounts = sqliteTable('account', {
  _id: integer('_id').primaryKey({ autoIncrement: true }),
  id: text('uuid').notNull().unique(),
  name: text('name'),            // nullable in ppxml2db
  type: text('type').notNull(),  // 'portfolio' | 'account'
  currency: text('currency'),    // NULL for portfolio (inherited from referenceAccount)
  isRetired: integer('isRetired', { mode: 'boolean' }).default(false),
  referenceAccountId: text('referenceAccount'),
  updatedAt: text('updatedAt').notNull(),
  note: text('note'),
  _xmlid: integer('_xmlid').notNull(),
  _order: integer('_order').notNull(),
});

export const accountAttributes = sqliteTable('account_attr', {
  accountId: text('account').references(() => accounts.id).notNull(),
  typeId: text('attr_uuid').notNull(),
  type: text('type').notNull(),
  value: text('value'),
  seq: integer('seq').notNull().default(0),
}, (t) => ({ pk: primaryKey({ columns: [t.accountId, t.typeId] }) }));

// ─── SECURITIES ───────────────────────────────────

export const securities = sqliteTable('security', {
  _id: integer('_id').primaryKey({ autoIncrement: true }),
  id: text('uuid').notNull().unique(),
  name: text('name'),            // nullable in ppxml2db
  isin: text('isin'),
  ticker: text('tickerSymbol'),
  wkn: text('wkn'),
  currency: text('currency'),
  note: text('note'),
  isRetired: integer('isRetired', { mode: 'boolean' }).default(false),
  feedUrl: text('feedURL'),
  feed: text('feed'),
  latestFeed: text('latestFeed'),
  latestFeedUrl: text('latestFeedURL'),
  feedTickerSymbol: text('feedTickerSymbol'),
  calendar: text('calendar'),
  updatedAt: text('updatedAt').notNull(),
  onlineId: text('onlineId'),
  targetCurrency: text('targetCurrency'),
});

// P1.1: security_event PK — ppxml2db has _id INTEGER PK, no uuid column
export const securityEvents = sqliteTable('security_event', {
  _id: integer('_id').primaryKey({ autoIncrement: true }),
  securityId: text('security').references(() => securities.id).notNull(),
  type: text('type').notNull(),
  date: text('date').notNull(),
  details: text('details'),
});

export const securityAttributes = sqliteTable('security_attr', {
  securityId: text('security').references(() => securities.id).notNull(),
  typeId: text('attr_uuid').references(() => attributeTypes.id).notNull(),
  value: text('value'),
  type: text('type').notNull(),
  seq: integer('seq').notNull().default(0),
}, (t) => ({ pk: primaryKey({ columns: [t.securityId, t.typeId] }) }));

export const securityProperties = sqliteTable('security_prop', {
  securityId: text('security').references(() => securities.id).notNull(),
  type: text('type').notNull(),
  name: text('name').notNull(),
  value: text('value'),
  seq: integer('seq').notNull().default(0),
});

export const attributeTypes = sqliteTable('attribute_type', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  type: text('type').notNull(),
  columnLabel: text('columnLabel').notNull(),
  source: text('source'),
  target: text('target').notNull(),
  converterClass: text('converterClass').notNull(),
  propsJson: text('props_json'),
});

// ─── PRICES ───────────────────────────────────────

export const prices = sqliteTable('price', {
  securityId: text('security').references(() => securities.id).notNull(),
  date: text('tstamp').notNull(),
  close: integer('value').notNull(),
}, (t) => ({ pk: primaryKey({ columns: [t.securityId, t.date] }) }));

export const latestPrices = sqliteTable('latest_price', {
  securityId: text('security')
    .references(() => securities.id)
    .primaryKey(),
  date: text('tstamp').notNull(),
  value: integer('value').notNull(),
  // OHLC columns populated by ppxml2db.py from the PP-XML `<latest>` elements.
  // Nullable — older exports and non-equity tickers (ETFs, indices) commonly
  // omit them.
  high: integer('high'),
  low: integer('low'),
  volume: integer('volume'),
});

// ─── TRANSACTIONS (sistema a doppia entrata) ──────

export const transactions = sqliteTable('xact', {
  _id: integer('_id').primaryKey({ autoIncrement: true }),
  id: text('uuid').notNull().unique(),
  type: text('type').notNull(),
  date: text('date').notNull(),
  currency: text('currency').notNull(),
  amount: integer('amount').notNull(),
  shares: integer('shares').notNull(),
  note: text('note'),
  securityId: text('security').references(() => securities.id),
  accountId: text('account').references(() => accounts.id).notNull(),
  source: text('source'),
  updatedAt: text('updatedAt').notNull(),
  fees: integer('fees').notNull().default(0),
  taxes: integer('taxes').notNull().default(0),
  acctype: text('acctype').notNull(),
  _xmlid: integer('_xmlid').notNull(),
  _order: integer('_order').notNull(),
});

export const transactionCrossEntries = sqliteTable('xact_cross_entry', {
  fromXact: text('from_xact').references(() => transactions.id),
  fromAcc: text('from_acc').references(() => accounts.id),
  toXact: text('to_xact').references(() => transactions.id).notNull(),
  toAcc: text('to_acc').references(() => accounts.id).notNull(),
  type: text('type').notNull(),
});

export const transactionUnits = sqliteTable('xact_unit', {
  xactId: text('xact').references(() => transactions.id).notNull(),
  type: text('type').notNull(),
  amount: integer('amount').notNull(),
  currency: text('currency').notNull(),
  forexAmount: integer('forex_amount'),
  forexCurrency: text('forex_currency'),
  exchangeRate: text('exchangeRate'),   // P1.3: TEXT not REAL (ppxml2db stores as string)
});

// ─── TAXONOMIES ───────────────────────────────────

export const taxonomies = sqliteTable('taxonomy', {
  id: integer('_id').primaryKey({ autoIncrement: true }),
  uuid: text('uuid').notNull().unique(),
  name: text('name').notNull(),
  root: text('root').notNull(), // FK to taxonomy_category.uuid
});

export const taxonomyCategories = sqliteTable('taxonomy_category', {
  _id: integer('_id').primaryKey({ autoIncrement: true }),
  id: text('uuid').notNull().unique(),   // logical ID, referenced by FKs
  name: text('name').notNull(),
  parentId: text('parent'),
  taxonomyId: text('taxonomy').notNull(),
  color: text('color').notNull(),
  weight: integer('weight').notNull(),
  rank: integer('rank').notNull(),
});

export const taxonomyData = sqliteTable('taxonomy_data', {
  categoryId: text('category')
    .references(() => taxonomyCategories.id),
  key: text('name').notNull(),
  value: text('value').notNull(),
  taxonomy: text('taxonomy').notNull(),
  type: text('type').notNull().default(''),
});

export const taxonomyAssignments = sqliteTable('taxonomy_assignment', {
  id: integer('_id').primaryKey({ autoIncrement: true }),
  itemId: text('item').notNull(),  // UUID of security or account, determined by itemType
  categoryId: text('category').references(() => taxonomyCategories.id).notNull(),
  taxonomy: text('taxonomy').notNull(),
  itemType: text('item_type').notNull(),
  weight: integer('weight').notNull().default(10000),
  rank: integer('rank').notNull().default(0),
});

// ─── WATCHLISTS ───────────────────────────────────

export const watchlists = sqliteTable('watchlist', {
  id: integer('_id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  _order: integer('_order').notNull(),
});

export const watchlistSecurities = sqliteTable('watchlist_security', {
  watchlistId: integer('list').references(() => watchlists.id).notNull(),
  securityId: text('security').references(() => securities.id).notNull(),
}, (t) => ({ pk: primaryKey({ columns: [t.watchlistId, t.securityId] }) }));

// ─── CONFIG & DASHBOARD ──────────────────────────

export const configEntries = sqliteTable('config_entry', {
  uuid: text('uuid'),
  configSet: integer('config_set').notNull(),
  name: text('name'),
  data: text('data'),
});

// P1.2: ppxml2db creates 'dashboard' (not 'dashboard_set')
export const dashboards = sqliteTable('dashboard', {
  _id: integer('_id').primaryKey({ autoIncrement: true }),
  dashboardId: text('id').notNull(),
  name: text('name').notNull(),
  configJson: text('config_json').notNull(),
  columnsJson: text('columns_json').notNull(),
});

export const properties = sqliteTable('property', {
  name: text('name').primaryKey(),
  value: text('value').notNull(),
  special: integer('special').notNull().default(0),
});

// ─── P3: TABELLE PPXML2DB MANCANTI ──────────────

export const configSets = sqliteTable('config_set', {
  _id: integer('_id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
});

export const bookmarks = sqliteTable('bookmark', {
  _id: integer('_id').primaryKey({ autoIncrement: true }),
  label: text('label').notNull(),
  pattern: text('pattern').notNull(),
});

export const taxonomyAssignmentData = sqliteTable('taxonomy_assignment_data', {
  assignment: integer('assignment').references(() => taxonomyAssignments.id).notNull(),
  name: text('name').notNull(),
  type: text('type').notNull(),
  value: text('value').notNull(),
});

// ─── QUOVIBE-OWNED TABLES (vf_*) ─────────────────

export const vfCsvImportConfigs = sqliteTable('vf_csv_import_config', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  type: text('type').notNull(),
  config: text('config').notNull(),
  createdAt: text('createdAt').notNull(),
  updatedAt: text('updatedAt').notNull(),
});

export const vfExchangeRates = sqliteTable('vf_exchange_rate', {
  date: text('date').notNull(),
  fromCurrency: text('from_currency').notNull(),
  toCurrency: text('to_currency').notNull(),
  rate: text('rate').notNull(),
}, (t) => ({ pk: primaryKey({ columns: [t.date, t.fromCurrency, t.toCurrency] }) }));

export const vfPortfolioMeta = sqliteTable('vf_portfolio_meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

export const vfDashboards = sqliteTable('vf_dashboard', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  position: integer('position').notNull(),
  widgetsJson: text('widgets_json').notNull(),
  schemaVersion: integer('schema_version').notNull().default(1),
  columns: integer('columns').notNull().default(3),
  createdAt: text('createdAt').notNull(),
  updatedAt: text('updatedAt').notNull(),
});

export const vfChartConfigs = sqliteTable('vf_chart_config', {
  chartId: text('chart_id').primaryKey(),
  configJson: text('config_json').notNull(),
  schemaVersion: integer('schema_version').notNull().default(1),
  updatedAt: text('updatedAt').notNull(),
});
