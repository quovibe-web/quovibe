/**
 * seed-demo.ts — Generate a screenshot-ready demo database.
 * Usage: npx tsx scripts/seed-demo.ts
 * Output: data/demo.db + data/demo.settings.json (also copied to portfolio.db + quovibe.settings.json)
 */
import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import { format, isWeekend, eachDayOfInterval } from 'date-fns';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '..');
const DB_OUT = path.join(ROOT, 'data/demo.db');
const SETTINGS_OUT = path.join(ROOT, 'data/demo.settings.json');

// Remove existing
if (fs.existsSync(DB_OUT)) fs.unlinkSync(DB_OUT);
if (fs.existsSync(DB_OUT + '-shm')) fs.unlinkSync(DB_OUT + '-shm');
if (fs.existsSync(DB_OUT + '-wal')) fs.unlinkSync(DB_OUT + '-wal');

const db = new Database(DB_OUT);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function hecto(eur: number): number { return Math.round(eur * 100); }
function shares8(n: number): number { return Math.round(n * 1e8); }
function price8(p: number): number { return Math.round(p * 1e8); }
function ts(): string { return new Date().toISOString(); }
function fmtDate(d: Date): string { return format(d, 'yyyy-MM-dd'); }

// Seeded PRNG (mulberry32) for reproducible price generation
let _seed = 0xDE4D4A7A;
function seededRandom(): number {
  _seed |= 0; _seed = _seed + 0x6D2B79F5 | 0;
  let t = Math.imul(_seed ^ (_seed >>> 15), 1 | _seed);
  t = t + Math.imul(t ^ (t >>> 7), 61 | t) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
function gaussRandom(mean = 0, stddev = 1): number {
  const u1 = seededRandom();
  const u2 = seededRandom();
  return mean + stddev * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}
function tradingDays(start: Date, end: Date): Date[] {
  return eachDayOfInterval({ start, end }).filter(d => !isWeekend(d));
}
let xmlIdCounter = 1;
let orderCounter = 1;
function nextXmlId(): number { return xmlIdCounter++; }
function nextOrder(): number { return orderCounter++; }
const now = ts();

// ---------------------------------------------------------------------------
// 1. DDL
// ---------------------------------------------------------------------------
db.exec(`
CREATE TABLE account(
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
CREATE TABLE account_attr(
  account VARCHAR(36) NOT NULL REFERENCES account(uuid),
  attr_uuid VARCHAR(36) NOT NULL,
  type VARCHAR(32) NOT NULL,
  value TEXT,
  seq INT NOT NULL DEFAULT 0
);
CREATE TABLE attribute_type(
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
CREATE TABLE bookmark(
  _id INTEGER NOT NULL PRIMARY KEY,
  label VARCHAR(64) NOT NULL,
  pattern VARCHAR(256) NOT NULL
);
CREATE TABLE config_entry(
  config_set INT NOT NULL REFERENCES config_set(_id),
  uuid VARCHAR(255),
  name VARCHAR(255),
  data TEXT
);
CREATE TABLE config_set(
  _id INTEGER NOT NULL PRIMARY KEY,
  name VARCHAR(64) NOT NULL
);
CREATE TABLE dashboard(
  _id INTEGER NOT NULL PRIMARY KEY,
  id VARCHAR(64) NOT NULL,
  name VARCHAR(64) NOT NULL,
  config_json TEXT NOT NULL,
  columns_json TEXT NOT NULL
);
CREATE TABLE latest_price(
  security VARCHAR(36) NOT NULL REFERENCES security(uuid),
  tstamp VARCHAR(32) NOT NULL,
  value BIGINT NOT NULL,
  open BIGINT,
  high BIGINT,
  low BIGINT,
  volume BIGINT
);
CREATE TABLE price(
  security VARCHAR(36) NOT NULL REFERENCES security(uuid),
  tstamp VARCHAR(32) NOT NULL,
  value BIGINT NOT NULL,
  open BIGINT,
  high BIGINT,
  low BIGINT,
  volume BIGINT
);
CREATE TABLE property(
  name VARCHAR(64) NOT NULL,
  special INT NOT NULL DEFAULT 0,
  value TEXT NOT NULL
);
CREATE TABLE security(
  _id INTEGER NOT NULL PRIMARY KEY,
  uuid VARCHAR(36) NOT NULL UNIQUE,
  onlineId VARCHAR(64),
  name VARCHAR(255),
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
CREATE TABLE security_attr(
  security VARCHAR(36) NOT NULL REFERENCES security(uuid),
  attr_uuid VARCHAR(36) NOT NULL,
  type VARCHAR(32) NOT NULL,
  value TEXT,
  seq INT NOT NULL DEFAULT 0
);
CREATE TABLE security_event(
  _id INTEGER NOT NULL PRIMARY KEY,
  security VARCHAR(36) NOT NULL REFERENCES security(uuid),
  date VARCHAR(36) NOT NULL,
  type VARCHAR(32) NOT NULL,
  details TEXT
);
CREATE TABLE security_prop(
  security VARCHAR(36) NOT NULL REFERENCES security(uuid),
  type VARCHAR(32) NOT NULL,
  name VARCHAR(36) NOT NULL,
  value TEXT,
  seq INT NOT NULL DEFAULT 0
);
CREATE TABLE taxonomy(
  _id INTEGER NOT NULL PRIMARY KEY,
  uuid VARCHAR(36) NOT NULL UNIQUE,
  name VARCHAR(100) NOT NULL,
  root VARCHAR(36) NOT NULL
);
CREATE TABLE taxonomy_assignment(
  _id INTEGER NOT NULL PRIMARY KEY,
  taxonomy VARCHAR(36) NOT NULL REFERENCES taxonomy(uuid),
  category VARCHAR(36) NOT NULL REFERENCES taxonomy_category(uuid),
  item_type VARCHAR(32) NOT NULL,
  item VARCHAR(36) NOT NULL,
  weight INT NOT NULL DEFAULT 10000,
  rank INT NOT NULL DEFAULT 0
);
CREATE TABLE taxonomy_assignment_data(
  assignment INT NOT NULL REFERENCES taxonomy_assignment(_id),
  name VARCHAR(64) NOT NULL,
  type VARCHAR(64) NOT NULL,
  value VARCHAR(256) NOT NULL
);
CREATE TABLE taxonomy_category(
  _id INTEGER NOT NULL PRIMARY KEY,
  uuid VARCHAR(36) NOT NULL UNIQUE,
  taxonomy VARCHAR(36) NOT NULL REFERENCES taxonomy(uuid),
  parent VARCHAR(36) REFERENCES taxonomy_category(uuid),
  name VARCHAR(100) NOT NULL,
  color VARCHAR(100) NOT NULL,
  weight INT NOT NULL,
  rank INT NOT NULL
);
CREATE TABLE taxonomy_data(
  taxonomy VARCHAR(36) NOT NULL REFERENCES taxonomy(uuid),
  category VARCHAR(36) REFERENCES taxonomy_category(uuid),
  name VARCHAR(64) NOT NULL,
  type VARCHAR(64) NOT NULL DEFAULT '',
  value VARCHAR(256) NOT NULL
);
CREATE TABLE watchlist(
  _id INTEGER NOT NULL PRIMARY KEY,
  name VARCHAR(64) NOT NULL,
  _order INT NOT NULL
);
CREATE TABLE watchlist_security(
  list INT NOT NULL REFERENCES watchlist(_id),
  security VARCHAR(36) NOT NULL REFERENCES security(uuid)
);
CREATE TABLE xact(
  _id INTEGER NOT NULL PRIMARY KEY,
  uuid VARCHAR(36) NOT NULL UNIQUE,
  acctype VARCHAR(10) NOT NULL,
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
CREATE TABLE xact_cross_entry(
  type VARCHAR(32) NOT NULL,
  from_acc VARCHAR(36) REFERENCES account(uuid),
  from_xact VARCHAR(36) REFERENCES xact(uuid),
  to_acc VARCHAR(36) NOT NULL REFERENCES account(uuid),
  to_xact VARCHAR(36) NOT NULL REFERENCES xact(uuid)
);
CREATE TABLE xact_unit(
  xact VARCHAR(36) NOT NULL REFERENCES xact(uuid),
  type VARCHAR(16) NOT NULL,
  amount BIGINT NOT NULL,
  currency VARCHAR(16) NOT NULL,
  forex_amount BIGINT,
  forex_currency VARCHAR(16),
  exchangeRate VARCHAR(16)
);
CREATE TABLE csv_import_config(
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  name VARCHAR(128) NOT NULL,
  type VARCHAR(16) NOT NULL,
  config TEXT NOT NULL,
  createdAt VARCHAR(64) NOT NULL,
  updatedAt VARCHAR(64) NOT NULL
);
`);

console.log('[DDL] Tables created');

// ---------------------------------------------------------------------------
// 2. Accounts
// ---------------------------------------------------------------------------
const IB_CASH_ID = randomUUID();
const IB_SEC_ID = randomUUID();
const SC_CASH_ID = randomUUID();
const SC_SEC_ID = randomUUID();
const CASH_RESERVE_ID = randomUUID();

const insertAccount = db.prepare(`
  INSERT INTO account(uuid, type, name, referenceAccount, currency, note, isRetired, updatedAt, _xmlid, _order)
  VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
`);

db.transaction(() => {
  insertAccount.run(IB_CASH_ID, 'account', 'Interactive Brokers (Cash)', null, 'EUR', null, now, nextXmlId(), nextOrder());
  insertAccount.run(IB_SEC_ID, 'portfolio', 'Interactive Brokers (Securities)', IB_CASH_ID, null, null, now, nextXmlId(), nextOrder());
  insertAccount.run(SC_CASH_ID, 'account', 'Scalable Capital (Cash)', null, 'EUR', null, now, nextXmlId(), nextOrder());
  insertAccount.run(SC_SEC_ID, 'portfolio', 'Scalable Capital (Securities)', SC_CASH_ID, null, null, now, nextXmlId(), nextOrder());
  insertAccount.run(CASH_RESERVE_ID, 'account', 'Cash Reserve', null, 'EUR', 'Emergency fund & savings', now, nextXmlId(), nextOrder());
})();

console.log('[Accounts] 5 accounts inserted');

// ---------------------------------------------------------------------------
// 3. Properties
// ---------------------------------------------------------------------------
const insertProperty = db.prepare(`INSERT INTO property(name, special, value) VALUES (?, ?, ?)`);

db.transaction(() => {
  insertProperty.run('baseCurrency', 1, 'EUR');
  insertProperty.run('version', 1, '69');
  insertProperty.run('security-name-config', 0, 'NONE');
  insertProperty.run('security-chart-details', 0, 'SCALING_LINEAR,INVESTMENT,DIVIDENDS,EVENTS,MARKER_LINES,SHOW_DATA_LABELS');
  insertProperty.run('portfolio-chart-details', 0, 'ABSOLUTE_INVESTED_CAPITAL,ABSOLUTE_DELTA');
  insertProperty.run('portfolio.calendar', 0, 'default');
})();

console.log('[Properties] 6 properties inserted');

// ---------------------------------------------------------------------------
// 4. Securities
// ---------------------------------------------------------------------------
interface SecurityDef {
  uuid: string;
  name: string;
  ticker: string;
  isin: string;
  feedTicker: string;
  basePrice: number;
  targetReturn: number;
  dailyVol: number;
  portfolioId: string | null;
  depositId: string | null;
}

function sec(
  name: string, ticker: string, isin: string, feedTicker: string,
  basePrice: number, targetReturn: number, dailyVol: number,
  portfolioId: string | null, depositId: string | null
): SecurityDef {
  return { uuid: randomUUID(), name, ticker, isin, feedTicker, basePrice, targetReturn, dailyVol, portfolioId, depositId };
}

// IB portfolio (8)
const VWCE = sec('Vanguard FTSE All-World', 'VWCE.DE', 'IE00BK5BQT80', 'VWCE.DE', 105, 0.22, 0.011, IB_SEC_ID, IB_CASH_ID);
const IWDA = sec('iShares Core MSCI World', 'IWDA.AS', 'IE00B4L5Y983', 'IWDA.AS', 82, 0.20, 0.010, IB_SEC_ID, IB_CASH_ID);
const SXR8 = sec('iShares Core S&P 500', 'SXR8.DE', 'IE00B5BMR087', 'SXR8.DE', 480, 0.18, 0.012, IB_SEC_ID, IB_CASH_ID);
const EIMI = sec('iShares MSCI EM', 'EIMI.AS', 'IE00BKM4GZ66', 'EIMI.AS', 28, -0.08, 0.014, IB_SEC_ID, IB_CASH_ID);
const XBLC = sec('Xtrackers EUR Corp Bond', 'XBLC.DE', 'LU0478205379', 'XBLC.DE', 120, 0.04, 0.004, IB_SEC_ID, IB_CASH_ID);
const AAPL = sec('Apple Inc', 'AAPL.DE', 'US0378331005', 'AAPL.DE', 170, 0.15, 0.016, IB_SEC_ID, IB_CASH_ID);
const ASML = sec('ASML Holding', 'ASML.AS', 'NL0010273215', 'ASML.AS', 680, 0.10, 0.018, IB_SEC_ID, IB_CASH_ID);
const SAP_SEC = sec('SAP SE', 'SAP.DE', 'DE0007164600', 'SAP.DE', 155, 0.35, 0.014, IB_SEC_ID, IB_CASH_ID);

// SC portfolio (7)
const MSFT = sec('Microsoft Corp', 'MSFT.DE', 'US5949181045', 'MSFT.DE', 340, 0.18, 0.015, SC_SEC_ID, SC_CASH_ID);
const NVDA = sec('NVIDIA Corp', 'NVDA.DE', 'US67066G1040', 'NVDA.DE', 55, 0.40, 0.025, SC_SEC_ID, SC_CASH_ID);
const MC = sec('LVMH', 'MC.PA', 'FR0000121014', 'MC.PA', 780, 0.06, 0.013, SC_SEC_ID, SC_CASH_ID);
const ALV = sec('Allianz SE', 'ALV.DE', 'DE0008404005', 'ALV.DE', 245, 0.12, 0.011, SC_SEC_ID, SC_CASH_ID);
const IQQH = sec('iShares Global Clean Energy', 'IQQH.DE', 'IE00B1XNHC34', 'IQQH.DE', 9.50, -0.15, 0.020, SC_SEC_ID, SC_CASH_ID);
const CJ1 = sec('Amundi MSCI Japan', 'CJ1.PA', 'LU1781541179', 'CJ1.PA', 245, -0.05, 0.012, SC_SEC_ID, SC_CASH_ID);
const DTE = sec('Deutsche Telekom', 'DTE.DE', 'DE0005557508', 'DTE.DE', 22, 0.08, 0.010, SC_SEC_ID, SC_CASH_ID);

// Watchlist-only (6)
const NOVO = sec('Novo Nordisk', 'NOVO-B.CO', 'DK0062498333', 'NOVO-B.CO', 780, 0.10, 0.018, null, null);
const TSM = sec('Taiwan Semiconductor', 'TSM.DE', 'US8740391003', 'TSM.DE', 140, 0.25, 0.020, null, null);
const GOOGL = sec('Alphabet Inc', 'GOOGL.DE', 'US02079K3059', 'GOOGL.DE', 135, 0.15, 0.016, null, null);
const AMZN = sec('Amazon.com', 'AMZN.DE', 'US0231351067', 'AMZN.DE', 150, 0.20, 0.017, null, null);
const BTCE = sec('BTCetc Bitcoin ETP', 'BTCE.DE', 'DE000A27Z304', 'BTCE.DE', 55, 0.30, 0.035, null, null);
const ZETH = sec('CoinShares Ether ETP', 'ZETH.DE', 'GB00BLD4ZL17', 'ZETH.DE', 12, 0.15, 0.040, null, null);

const ALL_SECURITIES: SecurityDef[] = [
  VWCE, IWDA, SXR8, EIMI, XBLC, AAPL, ASML, SAP_SEC,
  MSFT, NVDA, MC, ALV, IQQH, CJ1, DTE,
  NOVO, TSM, GOOGL, AMZN, BTCE, ZETH
];

const HELD_SECURITIES = ALL_SECURITIES.filter(s => s.portfolioId !== null);

const insertSecurity = db.prepare(`
  INSERT INTO security(uuid, onlineId, name, currency, targetCurrency, note, isin, tickerSymbol, calendar, wkn,
    feedTickerSymbol, feed, feedURL, latestFeed, latestFeedURL, isRetired, updatedAt)
  VALUES (?, ?, ?, 'EUR', NULL, NULL, ?, ?, NULL, NULL, ?, 'YAHOO', NULL, 'YAHOO', NULL, 0, ?)
`);

db.transaction(() => {
  for (const s of ALL_SECURITIES) {
    insertSecurity.run(s.uuid, s.feedTicker, s.name, s.isin, s.ticker, s.feedTicker, now);
  }
})();

console.log(`[Securities] ${ALL_SECURITIES.length} securities inserted`);

// ---------------------------------------------------------------------------
// 5. Price Generation
// ---------------------------------------------------------------------------
const PRICE_START = new Date('2024-01-02');
// Use yesterday as the price end so the DB always covers up to the most recent completed trading day
const PRICE_END = (() => {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  while (isWeekend(d)) d.setDate(d.getDate() - 1);
  return d;
})();
const allTradingDays = tradingDays(PRICE_START, PRICE_END);
const numDays = allTradingDays.length;

// Map<secUUID, Map<dateStr, priceEUR>>
const priceHistory = new Map<string, Map<string, number>>();

const insertPrice = db.prepare(`
  INSERT INTO price(security, tstamp, value, open, high, low, volume)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);
const insertLatestPrice = db.prepare(`
  INSERT INTO latest_price(security, tstamp, value, open, high, low, volume)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

db.transaction(() => {
  for (const sec of ALL_SECURITIES) {
    const secPrices = new Map<string, number>();
    let price = sec.basePrice;
    const dailyDrift = sec.targetReturn / numDays;

    for (const day of allTradingDays) {
      const change = 1 + dailyDrift + gaussRandom(0, sec.dailyVol);
      price = price * change;
      // Clamp
      price = Math.max(sec.basePrice * 0.2, Math.min(sec.basePrice * 5, price));
      // Round to 2 decimals
      price = Math.round(price * 100) / 100;

      const dateStr = fmtDate(day);
      secPrices.set(dateStr, price);

      // open: ±0.5% from close; high/low: +/- 1-2% from close
      const open = Math.round((price * (1 + (seededRandom() - 0.5) * 0.01)) * 100) / 100;
      const high = Math.round((price * (1 + seededRandom() * 0.02)) * 100) / 100;
      const low = Math.round((price * (1 - seededRandom() * 0.02)) * 100) / 100;
      const volume = Math.round(100000 + seededRandom() * 5000000);

      insertPrice.run(sec.uuid, dateStr, price8(price), price8(open), price8(high), price8(low), volume);
    }

    priceHistory.set(sec.uuid, secPrices);

    // Latest price = last trading day
    const lastDay = fmtDate(allTradingDays[allTradingDays.length - 1]);
    const lastPrice = secPrices.get(lastDay)!;
    const lastOpen = Math.round((lastPrice * 0.995) * 100) / 100;
    const lastHigh = Math.round((lastPrice * 1.01) * 100) / 100;
    const lastLow = Math.round((lastPrice * 0.99) * 100) / 100;
    insertLatestPrice.run(sec.uuid, lastDay, price8(lastPrice), price8(lastOpen), price8(lastHigh), price8(lastLow),
      Math.round(200000 + seededRandom() * 3000000));
  }
})();

console.log(`[Prices] ${ALL_SECURITIES.length * numDays} price rows + ${ALL_SECURITIES.length} latest_price rows`);

// ---------------------------------------------------------------------------
// Helper: look up price from priceHistory, walking back up to 5 days for weekends
// ---------------------------------------------------------------------------
function lookupPrice(secUUID: string, dateStr: string): number {
  const secPrices = priceHistory.get(secUUID)!;
  let d = new Date(dateStr + 'T00:00:00');
  for (let i = 0; i < 7; i++) {
    const ds = fmtDate(d);
    const p = secPrices.get(ds);
    if (p !== undefined) return p;
    d = new Date(d.getTime() - 86400000); // go back 1 day
  }
  // Fallback: first available price
  const first = secPrices.values().next().value;
  return first ?? 100;
}

// ---------------------------------------------------------------------------
// Prepared statements for transactions
// ---------------------------------------------------------------------------
const insertXact = db.prepare(`
  INSERT INTO xact(uuid, acctype, account, date, currency, amount, security, shares, note, source, updatedAt, type, fees, taxes, _xmlid, _order)
  VALUES (?, ?, ?, ?, 'EUR', ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)
`);
const insertCrossEntry = db.prepare(`
  INSERT INTO xact_cross_entry(type, from_acc, from_xact, to_acc, to_xact)
  VALUES (?, ?, ?, ?, ?)
`);
const insertXactUnit = db.prepare(`
  INSERT INTO xact_unit(xact, type, amount, currency, forex_amount, forex_currency, exchangeRate)
  VALUES (?, ?, ?, 'EUR', NULL, NULL, NULL)
`);
// insertXactUnit takes 3 params: xact uuid, type, amount

// ---------------------------------------------------------------------------
// 6. Transactions — Deposits
// ---------------------------------------------------------------------------
function insertDeposit(accountId: string, dateStr: string, amountEur: number, note: string | null): void {
  const uuid = randomUUID();
  insertXact.run(uuid, 'account', accountId, dateStr, hecto(amountEur), null, 0, note, now, 'DEPOSIT', 0, 0, nextXmlId(), nextOrder());
}

db.transaction(() => {
  // Initial deposits — Jan 2024
  insertDeposit(IB_CASH_ID, '2024-01-03', 50000, 'Initial funding');
  insertDeposit(SC_CASH_ID, '2024-01-03', 30000, 'Initial funding');
  insertDeposit(CASH_RESERVE_ID, '2024-01-05', 10000, 'Emergency fund setup');

  // Quarterly top-ups IB
  insertDeposit(IB_CASH_ID, '2024-04-02', 2500, 'Quarterly top-up');
  insertDeposit(IB_CASH_ID, '2024-07-01', 3000, 'Quarterly top-up');
  insertDeposit(IB_CASH_ID, '2024-10-01', 2500, 'Quarterly top-up');
  insertDeposit(IB_CASH_ID, '2025-01-02', 2500, 'Quarterly top-up');
  insertDeposit(IB_CASH_ID, '2025-04-01', 3000, 'Quarterly top-up');
  insertDeposit(IB_CASH_ID, '2025-07-01', 2500, 'Quarterly top-up');
  insertDeposit(IB_CASH_ID, '2025-10-01', 2500, 'Quarterly top-up');
  insertDeposit(IB_CASH_ID, '2026-01-02', 3000, 'Quarterly top-up');

  // Quarterly top-ups SC
  insertDeposit(SC_CASH_ID, '2024-04-02', 2000, 'Quarterly top-up');
  insertDeposit(SC_CASH_ID, '2024-07-01', 2500, 'Quarterly top-up');
  insertDeposit(SC_CASH_ID, '2024-10-01', 2000, 'Quarterly top-up');
  insertDeposit(SC_CASH_ID, '2025-01-02', 2500, 'Quarterly top-up');
  insertDeposit(SC_CASH_ID, '2025-04-01', 2000, 'Quarterly top-up');
  insertDeposit(SC_CASH_ID, '2025-07-01', 2500, 'Quarterly top-up');
  insertDeposit(SC_CASH_ID, '2025-10-01', 2000, 'Quarterly top-up');
  insertDeposit(SC_CASH_ID, '2026-01-02', 2500, 'Quarterly top-up');

  // Cash Reserve top-ups
  insertDeposit(CASH_RESERVE_ID, '2024-06-03', 2000, 'Savings top-up');
  insertDeposit(CASH_RESERVE_ID, '2025-01-06', 1500, 'Savings top-up');
})();

console.log('[Deposits] 21 deposit transactions inserted');

// ---------------------------------------------------------------------------
// 7. Transactions — BUY (Double-Entry)
// ---------------------------------------------------------------------------
function insertBuy(
  portfolioId: string, depositId: string, secDef: SecurityDef,
  dateStr: string, sharesCount: number, note: string | null
): void {
  const priceAtDate = lookupPrice(secDef.uuid, dateStr);
  const totalAmount = sharesCount * priceAtDate;
  // Realistic brokerage fee: 0.15% of trade value, min €2.95, rounded to 2dp
  const feeEur = Math.round(Math.max(2.95, totalAmount * 0.0015) * 100) / 100;
  const feeHecto = hecto(feeEur);

  // Securities-side xact
  const secSideUuid = randomUUID();
  insertXact.run(
    secSideUuid, 'portfolio', portfolioId, dateStr,
    hecto(totalAmount), secDef.uuid, shares8(sharesCount),
    note, now, 'BUY', feeHecto, 0, nextXmlId(), nextOrder()
  );
  // FEE unit so getFees(tx) picks it up in Cost & Tax Drag
  insertXactUnit.run(secSideUuid, 'FEE', feeHecto);

  // Cash-side xact (same security, shares=0, fees=0, taxes=0)
  const cashSideUuid = randomUUID();
  insertXact.run(
    cashSideUuid, 'account', depositId, dateStr,
    -hecto(totalAmount + feeEur), secDef.uuid, 0,
    null, now, 'BUY', 0, 0, nextXmlId(), nextOrder()
  );

  // Cross-entry
  insertCrossEntry.run('buysell', portfolioId, secSideUuid, depositId, cashSideUuid);
}

db.transaction(() => {
  // Monthly DCA: VWCE (5 shares) and IWDA (8 shares) on ~15th, Jan 2024 to Mar 2026
  for (let year = 2024; year <= 2026; year++) {
    const maxMonth = year === 2026 ? 3 : 12;
    for (let month = 1; month <= maxMonth; month++) {
      // Find nearest trading day to the 15th
      let day = new Date(year, month - 1, 15);
      while (isWeekend(day)) {
        day = new Date(day.getTime() + 86400000);
      }
      const dateStr = fmtDate(day);

      insertBuy(IB_SEC_ID, IB_CASH_ID, VWCE, dateStr, 5, 'Monthly DCA');
      insertBuy(IB_SEC_ID, IB_CASH_ID, IWDA, dateStr, 8, 'Monthly DCA');
    }
  }

  // Lump-sum buys — IB portfolio
  insertBuy(IB_SEC_ID, IB_CASH_ID, SXR8, '2024-01-08', 15, 'Initial position');
  insertBuy(IB_SEC_ID, IB_CASH_ID, EIMI, '2024-01-10', 200, 'EM allocation');
  insertBuy(IB_SEC_ID, IB_CASH_ID, EIMI, '2024-07-15', 100, 'EM top-up');
  insertBuy(IB_SEC_ID, IB_CASH_ID, XBLC, '2024-02-05', 50, 'Bond allocation');
  insertBuy(IB_SEC_ID, IB_CASH_ID, XBLC, '2025-03-10', 30, 'Bond top-up');
  insertBuy(IB_SEC_ID, IB_CASH_ID, AAPL, '2024-01-15', 20, 'Tech position');
  insertBuy(IB_SEC_ID, IB_CASH_ID, AAPL, '2024-09-16', 10, 'AAPL top-up');
  insertBuy(IB_SEC_ID, IB_CASH_ID, ASML, '2024-03-11', 5, 'EU semiconductors');
  insertBuy(IB_SEC_ID, IB_CASH_ID, ASML, '2025-06-09', 3, 'ASML top-up');
  insertBuy(IB_SEC_ID, IB_CASH_ID, SAP_SEC, '2024-02-12', 30, 'EU tech');
  insertBuy(IB_SEC_ID, IB_CASH_ID, SAP_SEC, '2024-11-04', 15, 'SAP top-up');

  // Lump-sum buys — SC portfolio
  insertBuy(SC_SEC_ID, SC_CASH_ID, MSFT, '2024-01-08', 10, 'Initial position');
  insertBuy(SC_SEC_ID, SC_CASH_ID, MSFT, '2025-02-10', 5, 'MSFT top-up');
  insertBuy(SC_SEC_ID, SC_CASH_ID, NVDA, '2024-01-10', 100, 'AI bet');
  insertBuy(SC_SEC_ID, SC_CASH_ID, NVDA, '2024-06-17', 50, 'NVDA top-up');
  insertBuy(SC_SEC_ID, SC_CASH_ID, NVDA, '2025-01-13', 30, 'NVDA top-up');
  insertBuy(SC_SEC_ID, SC_CASH_ID, MC, '2024-02-05', 3, 'Luxury sector');
  insertBuy(SC_SEC_ID, SC_CASH_ID, ALV, '2024-03-04', 20, 'Insurance allocation');
  insertBuy(SC_SEC_ID, SC_CASH_ID, ALV, '2025-05-12', 10, 'ALV top-up');
  insertBuy(SC_SEC_ID, SC_CASH_ID, IQQH, '2024-01-15', 300, 'Clean energy');
  insertBuy(SC_SEC_ID, SC_CASH_ID, CJ1, '2024-04-08', 15, 'Japan exposure');
  insertBuy(SC_SEC_ID, SC_CASH_ID, DTE, '2024-05-06', 200, 'Telecom dividend');
  insertBuy(SC_SEC_ID, SC_CASH_ID, DTE, '2025-04-07', 100, 'DTE top-up');
})();

// Count BUY transactions: 27 months * 2 DCA + 22 lump-sum = 54 + 22 = 76 buys
// Each BUY = 2 xact rows + 1 cross entry
console.log('[BUYs] 76 buy orders (152 xact rows + 76 cross entries)');

// ---------------------------------------------------------------------------
// 8. Transactions — SELL (Double-Entry)
// ---------------------------------------------------------------------------
function insertSell(
  portfolioId: string, depositId: string, secDef: SecurityDef,
  dateStr: string, sharesCount: number, feeEur: number, taxEur: number, note: string | null
): void {
  const priceAtDate = lookupPrice(secDef.uuid, dateStr);
  const totalAmount = sharesCount * priceAtDate;

  // Securities-side xact
  const secSideUuid = randomUUID();
  insertXact.run(
    secSideUuid, 'portfolio', portfolioId, dateStr,
    hecto(totalAmount), secDef.uuid, shares8(sharesCount),
    note, now, 'SELL', hecto(feeEur), hecto(taxEur), nextXmlId(), nextOrder()
  );
  // FEE and TAX units so getFees/getTaxes pick them up in Cost & Tax Drag
  insertXactUnit.run(secSideUuid, 'FEE', hecto(feeEur));
  if (taxEur > 0) insertXactUnit.run(secSideUuid, 'TAX', hecto(taxEur));

  // Cash-side xact (same security, shares=0, fees=0, taxes=0)
  const cashSideUuid = randomUUID();
  insertXact.run(
    cashSideUuid, 'account', depositId, dateStr,
    hecto(totalAmount - feeEur - taxEur), secDef.uuid, 0,
    null, now, 'SELL', 0, 0, nextXmlId(), nextOrder()
  );

  // Cross-entry
  insertCrossEntry.run('buysell', portfolioId, secSideUuid, depositId, cashSideUuid);
}

db.transaction(() => {
  // Partial sell IQQH: 100 shares on 2025-06-16 (loss position — no capital gains tax, small fee)
  insertSell(SC_SEC_ID, SC_CASH_ID, IQQH, '2025-06-16', 100, 1.50, 0, 'Partial exit — clean energy underperforming');

  // Full sell SXR8: 15 shares on 2025-11-03 (profit, capital gains tax ~26%)
  insertSell(IB_SEC_ID, IB_CASH_ID, SXR8, '2025-11-03', 15, 5.50, 215, 'Full exit S&P 500');

  // Rebuy SXR8: 12 shares on 2025-11-04
  insertBuy(IB_SEC_ID, IB_CASH_ID, SXR8, '2025-11-04', 12, 'Re-entry S&P 500');

  // Partial sell NVDA: 20 shares on 2025-07-14 (strong profit, ~40% gain on AI position)
  insertSell(SC_SEC_ID, SC_CASH_ID, NVDA, '2025-07-14', 20, 4.95, 192, 'Trim AI position — book partial gains');

  // Partial sell SAP: 10 shares on 2025-09-10 (profit, ~35% gain)
  insertSell(IB_SEC_ID, IB_CASH_ID, SAP_SEC, '2025-09-10', 10, 5.25, 138, 'Rebalance — SAP outperformed');

  // Partial sell AAPL: 5 shares on 2026-02-17 (modest profit, ~15% gain)
  insertSell(IB_SEC_ID, IB_CASH_ID, AAPL, '2026-02-17', 5, 3.95, 41, 'Portfolio rebalance');
})();

console.log('[SELLs] 5 sell orders + 1 rebuy (12 xact rows + 6 cross entries)');

// ---------------------------------------------------------------------------
// 9. Transactions — Dividends
// ---------------------------------------------------------------------------
function insertDividend(
  depositId: string, secDef: SecurityDef,
  dateStr: string, grossEur: number, taxEur: number, note: string | null
): void {
  const uuid = randomUUID();
  const netAmount = grossEur - taxEur;
  insertXact.run(
    uuid, 'account', depositId, dateStr,
    hecto(netAmount), secDef.uuid, 0,
    note, now, 'DIVIDEND', 0, hecto(taxEur), nextXmlId(), nextOrder()
  );

  // Tax unit if tax > 0
  if (taxEur > 0) {
    insertXactUnit.run(uuid, 'TAX', hecto(taxEur));
  }
}

db.transaction(() => {
  // VWCE semi-annual (Jun, Dec)
  insertDividend(IB_CASH_ID, VWCE, '2024-06-25', 18, 4.68, 'VWCE dividend H1 2024');
  insertDividend(IB_CASH_ID, VWCE, '2024-12-17', 22, 5.72, 'VWCE dividend H2 2024');
  insertDividend(IB_CASH_ID, VWCE, '2025-06-24', 26, 6.76, 'VWCE dividend H1 2025');
  insertDividend(IB_CASH_ID, VWCE, '2025-12-16', 31, 8.06, 'VWCE dividend H2 2025');

  // IWDA semi-annual (Mar, Sep)
  insertDividend(IB_CASH_ID, IWDA, '2024-03-19', 12, 3.12, 'IWDA dividend Q1 2024');
  insertDividend(IB_CASH_ID, IWDA, '2024-09-17', 15, 3.90, 'IWDA dividend Q3 2024');
  insertDividend(IB_CASH_ID, IWDA, '2025-03-18', 18, 4.68, 'IWDA dividend Q1 2025');
  insertDividend(IB_CASH_ID, IWDA, '2025-09-16', 22, 5.72, 'IWDA dividend Q3 2025');

  // AAPL quarterly
  insertDividend(IB_CASH_ID, AAPL, '2024-02-09', 3.45, 0.90, 'AAPL dividend');
  insertDividend(IB_CASH_ID, AAPL, '2024-05-10', 3.45, 0.90, 'AAPL dividend');
  insertDividend(IB_CASH_ID, AAPL, '2024-08-09', 3.45, 0.90, 'AAPL dividend');
  insertDividend(IB_CASH_ID, AAPL, '2024-11-08', 3.45, 0.90, 'AAPL dividend');
  insertDividend(IB_CASH_ID, AAPL, '2025-02-07', 3.45, 0.90, 'AAPL dividend');
  insertDividend(IB_CASH_ID, AAPL, '2025-05-09', 3.45, 0.90, 'AAPL dividend');
  insertDividend(IB_CASH_ID, AAPL, '2025-08-08', 3.45, 0.90, 'AAPL dividend');
  insertDividend(IB_CASH_ID, AAPL, '2025-11-07', 3.45, 0.90, 'AAPL dividend');
  insertDividend(IB_CASH_ID, AAPL, '2026-02-06', 3.45, 0.90, 'AAPL dividend');

  // SAP annual (May)
  insertDividend(IB_CASH_ID, SAP_SEC, '2024-05-20', 44, 11.44, 'SAP annual dividend 2024');
  insertDividend(IB_CASH_ID, SAP_SEC, '2025-05-19', 66, 17.16, 'SAP annual dividend 2025');

  // ALV annual (May)
  insertDividend(SC_CASH_ID, ALV, '2024-05-13', 117, 30.42, 'Allianz annual dividend 2024');
  insertDividend(SC_CASH_ID, ALV, '2025-05-12', 143, 37.18, 'Allianz annual dividend 2025');

  // DTE annual (Apr)
  insertDividend(SC_CASH_ID, DTE, '2024-04-15', 77, 20.02, 'Deutsche Telekom dividend 2024');
  insertDividend(SC_CASH_ID, DTE, '2025-04-14', 115, 29.90, 'Deutsche Telekom dividend 2025');
})();

console.log('[Dividends] 23 dividend transactions inserted');

// ---------------------------------------------------------------------------
// 9b. Transactions — Interest
// ---------------------------------------------------------------------------
function insertInterest(depositId: string, dateStr: string, amountEur: number, note: string | null): void {
  const uuid = randomUUID();
  insertXact.run(uuid, 'account', depositId, dateStr, hecto(amountEur), null, 0, note, now, 'INTEREST', 0, 0, nextXmlId(), nextOrder());
}

db.transaction(() => {
  // Quarterly interest on Cash Reserve
  insertInterest(CASH_RESERVE_ID, '2024-03-29', 8, 'Q1 2024 interest');
  insertInterest(CASH_RESERVE_ID, '2024-06-28', 9, 'Q2 2024 interest');
  insertInterest(CASH_RESERVE_ID, '2024-09-30', 10, 'Q3 2024 interest');
  insertInterest(CASH_RESERVE_ID, '2024-12-31', 11, 'Q4 2024 interest');
  insertInterest(CASH_RESERVE_ID, '2025-03-31', 12, 'Q1 2025 interest');
  insertInterest(CASH_RESERVE_ID, '2025-06-30', 13, 'Q2 2025 interest');
  insertInterest(CASH_RESERVE_ID, '2025-09-30', 13, 'Q3 2025 interest');
  insertInterest(CASH_RESERVE_ID, '2025-12-31', 14, 'Q4 2025 interest');
  insertInterest(CASH_RESERVE_ID, '2026-03-31', 12, 'Q1 2026 interest');
})();

console.log('[Interest] 9 interest transactions inserted');

// ---------------------------------------------------------------------------
// 9c. Transactions — Transfer (IB Cash → SC Cash)
// ---------------------------------------------------------------------------
db.transaction(() => {
  const outUuid = randomUUID();
  const inUuid = randomUUID();
  const dateStr = '2024-09-02';
  const amount = 5000;

  // TRANSFER_OUT from IB Cash
  insertXact.run(outUuid, 'account', IB_CASH_ID, dateStr, -hecto(amount), null, 0, 'Transfer to Scalable', now, 'TRANSFER_OUT', 0, 0, nextXmlId(), nextOrder());

  // TRANSFER_IN to SC Cash
  insertXact.run(inUuid, 'account', SC_CASH_ID, dateStr, hecto(amount), null, 0, 'Transfer from IB', now, 'TRANSFER_IN', 0, 0, nextXmlId(), nextOrder());

  // Cross-entry
  insertCrossEntry.run('account-transfer', IB_CASH_ID, outUuid, SC_CASH_ID, inUuid);
})();

console.log('[Transfer] 1 account transfer inserted');

// ---------------------------------------------------------------------------
// 10. Taxonomies
// ---------------------------------------------------------------------------
interface TaxonomyLeaf {
  name: string;
  color: string;
  items: { uuid: string; itemType: 'security' | 'account' }[];
}

function createTaxonomy(taxName: string, leaves: TaxonomyLeaf[]): void {
  const taxUuid = randomUUID();
  const rootUuid = randomUUID();

  // Taxonomy
  db.prepare(`INSERT INTO taxonomy(uuid, name, root) VALUES (?, ?, ?)`).run(taxUuid, taxName, rootUuid);

  // Root category
  db.prepare(`INSERT INTO taxonomy_category(uuid, taxonomy, parent, name, color, weight, rank)
    VALUES (?, ?, NULL, ?, '#000000', 0, 0)`).run(rootUuid, taxUuid, taxName);

  // Leaf categories + assignments
  let rank = 0;
  for (const leaf of leaves) {
    const catUuid = randomUUID();
    rank++;
    db.prepare(`INSERT INTO taxonomy_category(uuid, taxonomy, parent, name, color, weight, rank)
      VALUES (?, ?, ?, ?, ?, 10000, ?)`).run(catUuid, taxUuid, rootUuid, leaf.name, leaf.color, rank);

    for (const item of leaf.items) {
      db.prepare(`INSERT INTO taxonomy_assignment(taxonomy, category, item_type, item, weight, rank)
        VALUES (?, ?, ?, ?, 10000, 0)`).run(taxUuid, catUuid, item.itemType, item.uuid);
    }
  }
}

function secItem(s: SecurityDef): { uuid: string; itemType: 'security' | 'account' } {
  return { uuid: s.uuid, itemType: 'security' };
}
function accItem(uuid: string): { uuid: string; itemType: 'security' | 'account' } {
  return { uuid, itemType: 'account' };
}

db.transaction(() => {
  // Asset Class
  createTaxonomy('Asset Class', [
    { name: 'Equity ETF', color: '#4285F4', items: [secItem(VWCE), secItem(IWDA), secItem(SXR8), secItem(EIMI), secItem(IQQH), secItem(CJ1)] },
    { name: 'Single Stock', color: '#EA4335', items: [secItem(AAPL), secItem(ASML), secItem(SAP_SEC), secItem(MSFT), secItem(NVDA), secItem(MC), secItem(ALV), secItem(DTE)] },
    { name: 'Bond', color: '#FBBC04', items: [secItem(XBLC)] },
    { name: 'Cash', color: '#34A853', items: [accItem(IB_CASH_ID), accItem(SC_CASH_ID), accItem(CASH_RESERVE_ID)] },
  ]);

  // Region
  createTaxonomy('Region', [
    { name: 'Global', color: '#4285F4', items: [secItem(VWCE), secItem(IWDA)] },
    { name: 'North America', color: '#EA4335', items: [secItem(SXR8), secItem(AAPL), secItem(MSFT), secItem(NVDA)] },
    { name: 'Europe', color: '#FBBC04', items: [secItem(ASML), secItem(SAP_SEC), secItem(MC), secItem(ALV), secItem(DTE), secItem(XBLC)] },
    { name: 'Emerging Markets', color: '#34A853', items: [secItem(EIMI)] },
    { name: 'Japan', color: '#FF6D01', items: [secItem(CJ1)] },
    { name: 'Thematic', color: '#46BDC6', items: [secItem(IQQH)] },
  ]);

  // Sector
  createTaxonomy('Sector', [
    { name: 'Technology', color: '#4285F4', items: [secItem(AAPL), secItem(ASML), secItem(SAP_SEC), secItem(MSFT), secItem(NVDA)] },
    { name: 'Broad Market', color: '#EA4335', items: [secItem(VWCE), secItem(IWDA), secItem(SXR8), secItem(EIMI), secItem(CJ1)] },
    { name: 'Finance & Insurance', color: '#FBBC04', items: [secItem(ALV)] },
    { name: 'Luxury', color: '#34A853', items: [secItem(MC)] },
    { name: 'Telecom', color: '#FF6D01', items: [secItem(DTE)] },
    { name: 'Clean Energy', color: '#46BDC6', items: [secItem(IQQH)] },
    { name: 'Fixed Income', color: '#9334E6', items: [secItem(XBLC)] },
  ]);
})();

console.log('[Taxonomies] 3 taxonomies created');

// ---------------------------------------------------------------------------
// 11. Watchlists
// ---------------------------------------------------------------------------
db.transaction(() => {
  // Watchlist 1: "Watchlist"
  const w1Id = db.prepare(`INSERT INTO watchlist(name, _order) VALUES ('Watchlist', 1) RETURNING _id`).get() as { _id: number };
  db.prepare(`INSERT INTO watchlist_security(list, security) VALUES (?, ?)`).run(w1Id._id, NOVO.uuid);
  db.prepare(`INSERT INTO watchlist_security(list, security) VALUES (?, ?)`).run(w1Id._id, TSM.uuid);
  db.prepare(`INSERT INTO watchlist_security(list, security) VALUES (?, ?)`).run(w1Id._id, GOOGL.uuid);
  db.prepare(`INSERT INTO watchlist_security(list, security) VALUES (?, ?)`).run(w1Id._id, AMZN.uuid);

  // Watchlist 2: "Crypto ETPs"
  const w2Id = db.prepare(`INSERT INTO watchlist(name, _order) VALUES ('Crypto ETPs', 2) RETURNING _id`).get() as { _id: number };
  db.prepare(`INSERT INTO watchlist_security(list, security) VALUES (?, ?)`).run(w2Id._id, BTCE.uuid);
  db.prepare(`INSERT INTO watchlist_security(list, security) VALUES (?, ?)`).run(w2Id._id, ZETH.uuid);
})();

console.log('[Watchlists] 2 watchlists created');

// ---------------------------------------------------------------------------
// 12. Settings Sidecar
// ---------------------------------------------------------------------------
const dashOverviewId = randomUUID();
const dashRiskId = randomUUID();

const settings = {
  app: { lastImport: null },
  preferences: {
    language: 'en',
    theme: 'system',
    privacyMode: false,
    costMethod: 'MOVING_AVERAGE',
  },
  reportingPeriods: [],
  dashboards: [
    {
      id: dashOverviewId,
      name: 'Overview',
      widgets: [
        { id: 'w1', type: 'market-value', title: null, span: 1, config: {} },
        { id: 'w2', type: 'ttwror', title: null, span: 1, config: {} },
        { id: 'w3', type: 'irr', title: null, span: 1, config: {} },
        { id: 'w4', type: 'delta', title: null, span: 1, config: {} },
        { id: 'w5', type: 'absolute-performance', title: null, span: 1, config: {} },
        { id: 'w6', type: 'invested-capital', title: null, span: 1, config: {} },
        { id: 'w7', type: 'perf-chart', title: null, span: 3, config: {} },
        { id: 'w8', type: 'movers', title: null, span: 2, config: {} },
        { id: 'w9', type: 'top-holdings', title: null, span: 1, config: {} },
        { id: 'w10', type: 'watchlist', title: null, span: 1, config: { options: { watchlistId: 1 } } },
      ],
      metricsStripIds: [],
    },
    {
      id: dashRiskId,
      name: 'Risk',
      widgets: [
        { id: 'r1', type: 'max-drawdown', title: null, span: 1, config: {} },
        { id: 'r2', type: 'current-drawdown', title: null, span: 1, config: {} },
        { id: 'r3', type: 'volatility', title: null, span: 1, config: {} },
        { id: 'r4', type: 'sharpe-ratio', title: null, span: 1, config: { options: { riskFreeRate: 0 } } },
        { id: 'r5', type: 'all-time-high', title: null, span: 1, config: {} },
        { id: 'r6', type: 'distance-from-ath', title: null, span: 1, config: {} },
        { id: 'r7', type: 'drawdown-chart', title: null, span: 3, config: {} },
      ],
      metricsStripIds: [],
    },
  ],
  activeDashboard: dashOverviewId,
  investmentsView: { columns: [] },
  chartConfig: { version: 2, series: [] },
  tableLayouts: {},
};

fs.writeFileSync(SETTINGS_OUT, JSON.stringify(settings, null, 2), 'utf-8');
console.log(`[Settings] Written to ${SETTINGS_OUT}`);

// ---------------------------------------------------------------------------
// 13. Summary
// ---------------------------------------------------------------------------
const tables = [
  'account', 'security', 'price', 'latest_price', 'xact', 'xact_cross_entry',
  'xact_unit', 'property', 'taxonomy', 'taxonomy_category', 'taxonomy_assignment',
  'watchlist', 'watchlist_security',
];

console.log('\n--- Row counts ---');
for (const t of tables) {
  const row = db.prepare(`SELECT COUNT(*) as cnt FROM ${t}`).get() as { cnt: number };
  console.log(`  ${t}: ${row.cnt}`);
}

// ---------------------------------------------------------------------------
// 14. Logos — fetched from Clearbit and stored as base64 data URIs
// ---------------------------------------------------------------------------
const SEC_LOGOS: { id: string; domain: string }[] = [
  { id: VWCE.uuid,    domain: 'vanguard.com' },
  { id: IWDA.uuid,    domain: 'blackrock.com' },
  { id: SXR8.uuid,    domain: 'blackrock.com' },
  { id: EIMI.uuid,    domain: 'blackrock.com' },
  { id: XBLC.uuid,    domain: 'dws.com' },
  { id: AAPL.uuid,    domain: 'apple.com' },
  { id: ASML.uuid,    domain: 'asml.com' },
  { id: SAP_SEC.uuid, domain: 'sap.com' },
  { id: MSFT.uuid,    domain: 'microsoft.com' },
  { id: NVDA.uuid,    domain: 'nvidia.com' },
  { id: MC.uuid,      domain: 'lvmh.com' },
  { id: ALV.uuid,     domain: 'allianz.com' },
  { id: IQQH.uuid,    domain: 'blackrock.com' },
  { id: CJ1.uuid,     domain: 'amundi.com' },
  { id: DTE.uuid,     domain: 'telekom.de' },
  { id: NOVO.uuid,    domain: 'novonordisk.com' },
  { id: TSM.uuid,     domain: 'tsmc.com' },
  { id: GOOGL.uuid,   domain: 'google.com' },
  { id: AMZN.uuid,    domain: 'amazon.com' },
  { id: BTCE.uuid,    domain: 'etc-group.com' },
  { id: ZETH.uuid,    domain: 'coinshares.com' },
];

const ACC_LOGOS: { id: string; domain: string }[] = [
  { id: IB_SEC_ID,       domain: 'interactivebrokers.com' },
  { id: IB_CASH_ID,      domain: 'interactivebrokers.com' },
  { id: SC_SEC_ID,       domain: 'scalable.capital' },
  { id: SC_CASH_ID,      domain: 'scalable.capital' },
  { id: CASH_RESERVE_ID, domain: 'n26.com' },
];

async function fetchLogoBase64(domain: string): Promise<string | null> {
  try {
    const url = `https://www.google.com/s2/favicons?domain=${domain}&sz=128`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000), redirect: 'follow' });
    if (!res.ok) return null;
    const ct = res.headers.get('content-type') ?? 'image/png';
    if (!ct.startsWith('image/')) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return `data:${ct};base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}

const insertSecAttr = db.prepare(
  `INSERT OR REPLACE INTO security_attr(security, attr_uuid, type, value, seq) VALUES (?, 'logo', 'string', ?, 0)`,
);
const insertAccAttr = db.prepare(
  `INSERT OR REPLACE INTO account_attr(account, attr_uuid, type, value, seq) VALUES (?, 'logo', 'string', ?, 0)`,
);

// Cache: domain → base64 (avoid re-fetching same domain)
const logoCache = new Map<string, string | null>();
async function getLogoBase64(domain: string): Promise<string | null> {
  if (logoCache.has(domain)) return logoCache.get(domain)!;
  const data = await fetchLogoBase64(domain);
  logoCache.set(domain, data);
  return data;
}

void (async () => {
  console.log('\n[Logos] Fetching logos from Clearbit...');
  let logosOk = 0;
  let logosFail = 0;

  for (const { id, domain } of SEC_LOGOS) {
    const data = await getLogoBase64(domain);
    if (data) {
      insertSecAttr.run(id, data);
      logosOk++;
    } else {
      logosFail++;
      console.warn(`  ⚠ No logo for security ${id} (${domain})`);
    }
  }

  for (const { id, domain } of ACC_LOGOS) {
    const data = await getLogoBase64(domain);
    if (data) {
      insertAccAttr.run(id, data);
      logosOk++;
    } else {
      logosFail++;
      console.warn(`  ⚠ No logo for account ${id} (${domain})`);
    }
  }

  console.log(`[Logos] ${logosOk} logos stored, ${logosFail} failed`);

  db.close();
  console.log(`\nDone! Database written to ${DB_OUT}`);

  // ---------------------------------------------------------------------------
  // Apply to live paths (portfolio.db + quovibe.settings.json)
  // Must run with the dev server STOPPED — otherwise the SHM file is locked
  // and copying the main DB while the old SHM remains causes SQLITE_CORRUPT.
  // ---------------------------------------------------------------------------
  const LIVE_DB = path.join(ROOT, 'data/portfolio.db');
  const LIVE_SETTINGS = path.join(ROOT, 'data/quovibe.settings.json');
  const LIVE_SHM = LIVE_DB + '-shm';

  // Detect if the dev server has the DB open: SHM file exists and is non-empty
  let shmLocked = false;
  if (fs.existsSync(LIVE_SHM)) {
    try {
      fs.unlinkSync(LIVE_SHM);
    } catch {
      shmLocked = true;
    }
  }

  if (shmLocked) {
    console.warn('\n⚠  Dev server is running — portfolio.db-shm is locked.');
    console.warn('   Stop the dev server first, then run this script again,');
    console.warn('   OR copy manually after stopping:');
    console.warn(`     copy "${DB_OUT.replace(/\//g, '\\')}" "${LIVE_DB.replace(/\//g, '\\')}"`);
    console.warn(`     copy "${SETTINGS_OUT.replace(/\//g, '\\')}" "${LIVE_SETTINGS.replace(/\//g, '\\')}"`);
    console.warn('   demo.db has been generated successfully — only the live copy was skipped.');
  } else {
    try { fs.unlinkSync(LIVE_DB + '-wal'); } catch { /* ok */ }
    try { fs.unlinkSync(LIVE_DB); } catch { /* ok */ }
    fs.copyFileSync(DB_OUT, LIVE_DB);
    fs.copyFileSync(SETTINGS_OUT, LIVE_SETTINGS);
    console.log(`[Apply] Copied to ${LIVE_DB} + ${LIVE_SETTINGS}`);
  }
})();
