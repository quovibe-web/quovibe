/**
 * seed-demo.ts — Generate a screenshot-ready demo database.
 *
 * Usage:   npx tsx scripts/seed-demo.ts
 * Output:  data/demo.db
 *
 * Under ADR-015 this file is a bootstrap ARTIFACT, not a live portfolio. The
 * Docker build copies it to `/app/assets/demo.db`; the API clones it to
 * `data/portfolio-demo.db` the first time a user selects "Try demo" from the
 * Welcome page. Schema is applied via `applyBootstrap` so the demo DB uses the
 * exact same DDL as every other portfolio (single source of truth).
 */
import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import { format, isWeekend, eachDayOfInterval } from 'date-fns';
import * as fs from 'fs';
import * as path from 'path';
import { applyBootstrap } from '../packages/api/src/db/apply-bootstrap';
import { CURRENT_VERSION as WIDGETS_SCHEMA_VERSION } from '../packages/api/src/services/widget-migrations';

const ROOT = path.resolve(__dirname, '..');
const DB_OUT = path.join(ROOT, 'data/demo.db');

// Remove existing (plus WAL sidecars in case of a prior crashed run)
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
// 1. DDL — applied from bootstrap.sql (single source of truth, ADR-015 §3.5)
// ---------------------------------------------------------------------------
applyBootstrap(db);
console.log('[DDL] bootstrap.sql applied');

// ---------------------------------------------------------------------------
// 1b. Portfolio metadata (vf_portfolio_meta) — required so the API's sidecar
//     rebuild (§3.14) can auto-register the demo file when cloned into
//     data/portfolio-demo.db on a fresh install.
// ---------------------------------------------------------------------------
const seedMeta = db.prepare('INSERT OR REPLACE INTO vf_portfolio_meta (key, value) VALUES (?, ?)');
seedMeta.run('name', 'Demo Portfolio');
seedMeta.run('createdAt', now);
seedMeta.run('source', 'demo');
seedMeta.run('schemaVersion', '1');
console.log('[Meta] vf_portfolio_meta seeded');

// ---------------------------------------------------------------------------
// 1c. Default dashboard (vf_dashboard) — mirrors seedDefaultDashboard so a
//     freshly cloned demo DB has a dashboard on first open.
// ---------------------------------------------------------------------------
const DEFAULT_DASHBOARD_ID = randomUUID();
const RISK_DASHBOARD_ID = randomUUID();

const insertDashboard = db.prepare(
  `INSERT INTO vf_dashboard (id, name, position, widgets_json, schema_version, columns, createdAt, updatedAt)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
);

insertDashboard.run(
  DEFAULT_DASHBOARD_ID,
  'Overview',
  0,
  JSON.stringify([
    { id: 'w1', type: 'market-value',         title: null, span: 1, config: {} },
    { id: 'w2', type: 'ttwror',               title: null, span: 1, config: {} },
    { id: 'w3', type: 'irr',                  title: null, span: 1, config: {} },
    { id: 'w4', type: 'delta',                title: null, span: 1, config: {} },
    { id: 'w5', type: 'absolute-performance', title: null, span: 1, config: {} },
    { id: 'w6', type: 'invested-capital',     title: null, span: 1, config: {} },
    { id: 'w7', type: 'perf-chart',           title: null, span: 3, config: {} },
    { id: 'w8', type: 'movers',               title: null, span: 2, config: {} },
    { id: 'w9', type: 'top-holdings',         title: null, span: 1, config: {} },
    { id: 'w10', type: 'watchlist',           title: null, span: 1, config: { options: { watchlistId: 1 } } },
  ]),
  WIDGETS_SCHEMA_VERSION,
  3,
  now,
  now,
);

insertDashboard.run(
  RISK_DASHBOARD_ID,
  'Risk',
  1,
  JSON.stringify([
    { id: 'r1', type: 'max-drawdown',      title: null, span: 1, config: {} },
    { id: 'r2', type: 'current-drawdown',  title: null, span: 1, config: {} },
    { id: 'r3', type: 'volatility',        title: null, span: 1, config: {} },
    { id: 'r4', type: 'sharpe-ratio',      title: null, span: 1, config: { options: { riskFreeRate: 0 } } },
    { id: 'r5', type: 'all-time-high',     title: null, span: 1, config: {} },
    { id: 'r6', type: 'distance-from-ath', title: null, span: 1, config: {} },
    { id: 'r7', type: 'drawdown-chart',    title: null, span: 3, config: {} },
  ]),
  WIDGETS_SCHEMA_VERSION,
  3,
  now,
  now,
);

console.log('[Dashboards] 2 dashboards seeded (Overview + Risk)');

// ---------------------------------------------------------------------------
// 2. Accounts
// ---------------------------------------------------------------------------
const IB_CASH_ID = randomUUID();
const IB_USD_CASH_ID = randomUUID();
const IB_SEC_ID = randomUUID();
const SC_CASH_ID = randomUUID();
const SC_SEC_ID = randomUUID();
const CASH_RESERVE_ID = randomUUID();
const OLD_BANK_ID = randomUUID();

const insertAccount = db.prepare(`
  INSERT INTO account(uuid, type, name, referenceAccount, currency, note, isRetired, updatedAt, _xmlid, _order)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

db.transaction(() => {
  insertAccount.run(IB_CASH_ID, 'account', 'Interactive Brokers (Cash)', null, 'EUR', null, 0, now, nextXmlId(), nextOrder());
  insertAccount.run(IB_USD_CASH_ID, 'account', 'Interactive Brokers (USD Cash)', null, 'USD', 'Multi-currency sub-account', 0, now, nextXmlId(), nextOrder());
  insertAccount.run(IB_SEC_ID, 'portfolio', 'Interactive Brokers (Securities)', IB_CASH_ID, null, null, 0, now, nextXmlId(), nextOrder());
  insertAccount.run(SC_CASH_ID, 'account', 'Scalable Capital (Cash)', null, 'EUR', null, 0, now, nextXmlId(), nextOrder());
  insertAccount.run(SC_SEC_ID, 'portfolio', 'Scalable Capital (Securities)', SC_CASH_ID, null, null, 0, now, nextXmlId(), nextOrder());
  insertAccount.run(CASH_RESERVE_ID, 'account', 'Cash Reserve', null, 'EUR', 'Emergency fund & savings', 0, now, nextXmlId(), nextOrder());
  insertAccount.run(OLD_BANK_ID, 'account', 'Old Checking (Closed)', null, 'EUR', 'Closed account — kept for historical reference', 1, now, nextXmlId(), nextOrder());
})();

console.log('[Accounts] 7 accounts inserted (incl. 1 USD sub-account, 1 retired)');

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
  isRetired?: boolean;
  currency: string;
  note?: string | null;
}

function sec(
  name: string, ticker: string, isin: string, feedTicker: string,
  basePrice: number, targetReturn: number, dailyVol: number,
  portfolioId: string | null, depositId: string | null,
  isRetired = false,
  currency = 'EUR',
  note: string | null = null,
): SecurityDef {
  return { uuid: randomUUID(), name, ticker, isin, feedTicker, basePrice, targetReturn, dailyVol, portfolioId, depositId, isRetired, currency, note };
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
const NVDA = sec('NVIDIA Corp', 'NVDA.DE', 'US67066G1040', 'NVDA.DE', 55, 0.40, 0.025, SC_SEC_ID, SC_CASH_ID, false, 'EUR', 'Speculative AI position — review quarterly.');
const MC = sec('LVMH', 'MC.PA', 'FR0000121014', 'MC.PA', 780, 0.06, 0.013, SC_SEC_ID, SC_CASH_ID);
const ALV = sec('Allianz SE', 'ALV.DE', 'DE0008404005', 'ALV.DE', 245, 0.12, 0.011, SC_SEC_ID, SC_CASH_ID);
const IQQH = sec('iShares Global Clean Energy', 'IQQH.DE', 'IE00B1XNHC34', 'IQQH.DE', 9.50, -0.15, 0.020, SC_SEC_ID, SC_CASH_ID);
const CJ1 = sec('Amundi MSCI Japan', 'CJ1.PA', 'LU1781541179', 'CJ1.PA', 245, -0.05, 0.012, SC_SEC_ID, SC_CASH_ID);
const DTE = sec('Deutsche Telekom', 'DTE.DE', 'DE0005557508', 'DTE.DE', 22, 0.08, 0.010, SC_SEC_ID, SC_CASH_ID);

// IB portfolio — USD-denominated security (cross-currency demo).
const TSLA = sec(
  'Tesla Inc', 'TSLA', 'US88160R1014', 'TSLA',
  220, 0.05, 0.030,
  IB_SEC_ID, IB_USD_CASH_ID,
  false, 'USD',
  'Speculative single-stock position — review quarterly.',
);

// Fully-exited positions — exercise the Investments holdings filter
// ("Shares held = 0") and the "Show retired" toggle against TRADED securities.
// Watchlist-only ZETH never appears on Investments (tradedOnly hides
// never-transacted instruments), so it cannot demonstrate the retired toggle
// there. Both below are bought then fully sold (net shares 0). ZAL stays
// active (sold out, still tracked). O2D is retired/archived so it surfaces
// only when "Show retired" is on — securities.ts hides a retired row only
// while net shares are 0, so a still-held retired row would never toggle.
const ZAL = sec('Zalando SE', 'ZAL.DE', 'DE000ZAL1111', 'ZAL.DE', 30, 0.05, 0.018, IB_SEC_ID, IB_CASH_ID, false, 'EUR', 'Exited — rotated out of e-commerce, kept on watch for re-entry.');
const O2D = sec('Telefónica Deutschland', 'O2D.DE', 'DE000A1J5RX9', 'O2D.DE', 2.40, -0.05, 0.015, SC_SEC_ID, SC_CASH_ID, true, 'EUR', 'Closed after Telefónica squeeze-out — archived.');

// Watchlist-only (6)
const NOVO = sec('Novo Nordisk', 'NOVO-B.CO', 'DK0062498333', 'NOVO-B.CO', 780, 0.10, 0.018, null, null);
const TSM = sec('Taiwan Semiconductor', 'TSM.DE', 'US8740391003', 'TSM.DE', 140, 0.25, 0.020, null, null);
const GOOGL = sec('Alphabet Inc', 'GOOGL.DE', 'US02079K3059', 'GOOGL.DE', 135, 0.15, 0.016, null, null);
const AMZN = sec('Amazon.com', 'AMZN.DE', 'US0231351067', 'AMZN.DE', 150, 0.20, 0.017, null, null);
const BTCE = sec('BTCetc Bitcoin ETP', 'BTCE.DE', 'DE000A27Z304', 'BTCE.DE', 55, 0.30, 0.035, null, null);
const ZETH = sec('CoinShares Ether ETP', 'ZETH.DE', 'GB00BLD4ZL17', 'ZETH.DE', 12, 0.15, 0.040, null, null, true);

const ALL_SECURITIES: SecurityDef[] = [
  VWCE, IWDA, SXR8, EIMI, XBLC, AAPL, ASML, SAP_SEC,
  MSFT, NVDA, MC, ALV, IQQH, CJ1, DTE,
  TSLA,
  ZAL, O2D,
  NOVO, TSM, GOOGL, AMZN, BTCE, ZETH
];

const insertSecurity = db.prepare(`
  INSERT INTO security(uuid, onlineId, name, currency, targetCurrency, note, isin, tickerSymbol, calendar, wkn,
    feedTickerSymbol, feed, feedURL, latestFeed, latestFeedURL, isRetired, updatedAt)
  VALUES (?, ?, ?, ?, NULL, ?, ?, ?, NULL, NULL, ?, 'YAHOO', NULL, 'YAHOO', NULL, ?, ?)
`);

db.transaction(() => {
  for (const s of ALL_SECURITIES) {
    insertSecurity.run(s.uuid, s.feedTicker, s.name, s.currency, s.note ?? null, s.isin, s.ticker, s.feedTicker, s.isRetired ? 1 : 0, now);
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

// OHLC columns were removed from bootstrap.sql (ppxml2db schema parity).
const insertPrice = db.prepare(`
  INSERT INTO price(security, tstamp, value) VALUES (?, ?, ?)
`);
const insertLatestPrice = db.prepare(`
  INSERT INTO latest_price(security, tstamp, value) VALUES (?, ?, ?)
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

      insertPrice.run(sec.uuid, dateStr, price8(price));
    }

    priceHistory.set(sec.uuid, secPrices);

    // Latest price = last trading day
    const lastDay = fmtDate(allTradingDays[allTradingDays.length - 1]);
    const lastPrice = secPrices.get(lastDay)!;
    insertLatestPrice.run(sec.uuid, lastDay, price8(lastPrice));
  }
})();

// Invariant: every latest_price row must share a tstamp with MAX(price.tstamp)
// for its security. Orphans are dormant in the UI (effectiveLatestPrice in
// securities.ts picks the newer historical close) but still wrong data — fail
// loud at seed time so a future regression can't ship a polluted template.
const latestPriceOrphans = db.prepare(`
  SELECT s.name AS name, lp.tstamp AS lpTs,
         (SELECT MAX(tstamp) FROM price WHERE security = s.uuid) AS histTs
  FROM latest_price lp
  JOIN security s ON s.uuid = lp.security
  WHERE lp.tstamp != (SELECT MAX(tstamp) FROM price WHERE security = s.uuid)
`).all();
if (latestPriceOrphans.length > 0) {
  throw new Error(`[Seed invariant] latest_price / price tstamp mismatch: ${JSON.stringify(latestPriceOrphans)}`);
}

console.log(`[Prices] ${ALL_SECURITIES.length * numDays} price rows + ${ALL_SECURITIES.length} latest_price rows (invariant checked)`);

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
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)
`);
const insertCrossEntry = db.prepare(`
  INSERT INTO xact_cross_entry(type, from_acc, from_xact, to_acc, to_xact)
  VALUES (?, ?, ?, ?, ?)
`);
const insertXactUnit = db.prepare(`
  INSERT INTO xact_unit(xact, type, amount, currency, forex_amount, forex_currency, exchangeRate)
  VALUES (?, ?, ?, ?, NULL, NULL, NULL)
`);
const insertXactUnitForex = db.prepare(`
  INSERT INTO xact_unit(xact, type, amount, currency, forex_amount, forex_currency, exchangeRate)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

// ---------------------------------------------------------------------------
// 6. Transactions — Deposits
// ---------------------------------------------------------------------------
function insertDeposit(accountId: string, dateStr: string, amountEur: number, note: string | null, currency = 'EUR'): void {
  const uuid = randomUUID();
  insertXact.run(uuid, 'account', accountId, dateStr, currency, hecto(amountEur), null, 0, note, now, 'DEPOSIT', 0, 0, nextXmlId(), nextOrder());
}

db.transaction(() => {
  // Initial deposits — Jan 2024
  insertDeposit(IB_CASH_ID, '2024-01-03', 60000, 'Initial funding');
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

  // Buffer top-up — funds the cross-currency transfer + standalone fees/taxes added below.
  insertDeposit(IB_CASH_ID, '2024-07-15', 5000, 'Top-up — fund USD sub-account & misc costs');

  // USD sub-account funding (cross-currency demo).
  insertDeposit(IB_USD_CASH_ID, '2024-08-01', 5000, 'USD funding', 'USD');
  insertDeposit(IB_USD_CASH_ID, '2025-04-15', 2000, 'USD top-up', 'USD');

  // Retired account historical flow — opened, drained, closed.
  insertDeposit(OLD_BANK_ID, '2024-01-04', 1000, 'Initial balance — old account');
})();

console.log('[Deposits] 26 deposit transactions inserted');

// ---------------------------------------------------------------------------
// 7. Transactions — BUY (Double-Entry)
// ---------------------------------------------------------------------------
function insertBuy(
  portfolioId: string, depositId: string, secDef: SecurityDef,
  dateStr: string, sharesCount: number, note: string | null,
  currency = 'EUR',
): void {
  const priceAtDate = lookupPrice(secDef.uuid, dateStr);
  const totalAmount = sharesCount * priceAtDate;
  // Realistic brokerage fee: 0.15% of trade value, min 2.95, rounded to 2dp
  const feeEur = Math.round(Math.max(2.95, totalAmount * 0.0015) * 100) / 100;
  const feeHecto = hecto(feeEur);

  // Securities-side xact
  const secSideUuid = randomUUID();
  insertXact.run(
    secSideUuid, 'portfolio', portfolioId, dateStr, currency,
    hecto(totalAmount), secDef.uuid, shares8(sharesCount),
    note, now, 'BUY', feeHecto, 0, nextXmlId(), nextOrder()
  );
  // FEE unit so getFees(tx) picks it up in Cost & Tax Drag
  insertXactUnit.run(secSideUuid, 'FEE', feeHecto, currency);

  // Cash-side xact (same security, shares=0, fees=0, taxes=0).
  // ppxml2db convention: xact.amount is a non-negative magnitude; sign is
  // carried by xact.type (BUY is an OUTFLOW). See transaction.service.ts:11-32.
  const cashSideUuid = randomUUID();
  insertXact.run(
    cashSideUuid, 'account', depositId, dateStr, currency,
    hecto(totalAmount + feeEur), secDef.uuid, 0,
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
  dateStr: string, sharesCount: number, feeEur: number, taxEur: number, note: string | null,
  currency = 'EUR',
): void {
  const priceAtDate = lookupPrice(secDef.uuid, dateStr);
  const totalAmount = sharesCount * priceAtDate;

  // Securities-side xact
  const secSideUuid = randomUUID();
  insertXact.run(
    secSideUuid, 'portfolio', portfolioId, dateStr, currency,
    hecto(totalAmount), secDef.uuid, shares8(sharesCount),
    note, now, 'SELL', hecto(feeEur), hecto(taxEur), nextXmlId(), nextOrder()
  );
  // FEE and TAX units so getFees/getTaxes pick them up in Cost & Tax Drag
  insertXactUnit.run(secSideUuid, 'FEE', hecto(feeEur), currency);
  if (taxEur > 0) insertXactUnit.run(secSideUuid, 'TAX', hecto(taxEur), currency);

  // Cash-side xact (same security, shares=0, fees=0, taxes=0)
  const cashSideUuid = randomUUID();
  insertXact.run(
    cashSideUuid, 'account', depositId, dateStr, currency,
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
// 8b. Fully-exited positions (BUY + full SELL → net shares 0)
// ZAL: active, surfaces under "Shares held = 0". O2D: retired, hidden by
// default and revealed by the "Show retired" toggle. Cash nets ~flat (buy
// then sell), so the non-negative-balance invariant below stays satisfied.
// ---------------------------------------------------------------------------
db.transaction(() => {
  // ZAL — bought then fully sold; security stays active.
  insertBuy(IB_SEC_ID, IB_CASH_ID, ZAL, '2024-03-05', 50, 'Initial e-commerce position');
  insertSell(IB_SEC_ID, IB_CASH_ID, ZAL, '2025-04-10', 50, 2.95, 0, 'Full exit — rotated out of e-commerce');

  // O2D — bought then fully sold; security is archived (isRetired=1).
  insertBuy(SC_SEC_ID, SC_CASH_ID, O2D, '2024-02-12', 1000, 'Telefónica DE position');
  insertSell(SC_SEC_ID, SC_CASH_ID, O2D, '2025-01-20', 1000, 2.95, 0, 'Closed after squeeze-out — archived');
})();

console.log('[Exited] 2 fully-exited securities (ZAL active, O2D retired) — 4 orders');

// ---------------------------------------------------------------------------
// 9. Transactions — Dividends
// ---------------------------------------------------------------------------
function insertDividend(
  depositId: string, secDef: SecurityDef,
  dateStr: string, grossEur: number, taxEur: number, note: string | null,
  currency = 'EUR',
): void {
  const uuid = randomUUID();
  const netAmount = grossEur - taxEur;
  insertXact.run(
    uuid, 'account', depositId, dateStr, currency,
    hecto(netAmount), secDef.uuid, 0,
    note, now, 'DIVIDENDS', 0, hecto(taxEur), nextXmlId(), nextOrder()
  );

  // Tax unit if tax > 0
  if (taxEur > 0) {
    insertXactUnit.run(uuid, 'TAX', hecto(taxEur), currency);
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
function insertInterest(depositId: string, dateStr: string, amountEur: number, note: string | null, currency = 'EUR'): void {
  const uuid = randomUUID();
  insertXact.run(uuid, 'account', depositId, dateStr, currency, hecto(amountEur), null, 0, note, now, 'INTEREST', 0, 0, nextXmlId(), nextOrder());
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
// 9b2. Standalone cash-account transactions
// Single xact row, single account, sign carried by xact.type. Each type
// covers one of the per-type matrix entries the app supports beyond the
// dual-entry / dividend / interest set above.
// ---------------------------------------------------------------------------
function insertCashTx(
  type: string, accountId: string, dateStr: string, amountEur: number,
  note: string | null, currency = 'EUR',
): void {
  const uuid = randomUUID();
  insertXact.run(
    uuid, 'account', accountId, dateStr, currency,
    hecto(amountEur), null, 0, note, now, type, 0, 0, nextXmlId(), nextOrder(),
  );
}

db.transaction(() => {
  // REMOVAL — withdrawal from Cash Reserve.
  insertCashTx('REMOVAL', CASH_RESERVE_ID, '2025-08-15', 500, 'Annual gift to family');

  // REMOVAL — drain & close the legacy account.
  insertCashTx('REMOVAL', OLD_BANK_ID, '2024-02-15', 1000, 'Closing old account — funds withdrawn');

  // INTEREST_CHARGE — overdraft / margin interest charged.
  insertCashTx('INTEREST_CHARGE', IB_CASH_ID, '2024-11-30', 5, 'Margin interest charge');

  // FEES — standalone account-maintenance fee.
  insertCashTx('FEES', IB_CASH_ID, '2025-01-31', 25, 'Annual platform fee');

  // FEES_REFUND — broker rebate.
  insertCashTx('FEES_REFUND', SC_CASH_ID, '2025-06-30', 10, 'Promotional fee rebate');

  // TAXES — standalone tax payment (e.g. wealth-tax bolettino).
  insertCashTx('TAXES', IB_CASH_ID, '2025-07-31', 50, 'Wealth tax (bolettino)');

  // TAX_REFUND — annual tax reconciliation refund.
  insertCashTx('TAX_REFUND', IB_CASH_ID, '2025-09-15', 30, 'Withholding-tax refund');
})();

console.log('[StandaloneCash] 7 standalone cash-account transactions inserted');

// ---------------------------------------------------------------------------
// 9c. Transactions — Transfer (IB Cash → SC Cash)
// ---------------------------------------------------------------------------
db.transaction(() => {
  const outUuid = randomUUID();
  const inUuid = randomUUID();
  const dateStr = '2024-09-02';
  const amount = 5000;

  // TRANSFER_OUT from IB Cash (same magnitude convention as BUY cash-side above).
  insertXact.run(outUuid, 'account', IB_CASH_ID, dateStr, 'EUR', hecto(amount), null, 0, 'Transfer to Scalable', now, 'TRANSFER_OUT', 0, 0, nextXmlId(), nextOrder());

  // TRANSFER_IN to SC Cash
  insertXact.run(inUuid, 'account', SC_CASH_ID, dateStr, 'EUR', hecto(amount), null, 0, 'Transfer from IB', now, 'TRANSFER_IN', 0, 0, nextXmlId(), nextOrder());

  // Cross-entry
  insertCrossEntry.run('account-transfer', IB_CASH_ID, outUuid, SC_CASH_ID, inUuid);
})();

console.log('[Transfer] 1 account transfer inserted');

// ---------------------------------------------------------------------------
// 9d. Security transfers + standalone share deliveries
// SECURITY_TRANSFER (Group D) — share movement between two portfolios, dual
// xact rows + xact_cross_entry of type='portfolio-transfer'. DB type form:
// source row TRANSFER_OUT, dest row TRANSFER_IN (see TYPE_MAP_TO_PPXML2DB
// in transaction.service.ts).
// DELIVERY_INBOUND / DELIVERY_OUTBOUND (Group C) — single xact row on a
// portfolio account, shares only. We keep fees=0 here on purpose: the
// service layer's outflow/inflow convention writes a negative xact.amount
// for DELIVERY_OUTBOUND with fees (transaction.service.ts inflow rule),
// which conflicts with the magnitude invariant pinned a few lines below.
// Demo coverage of the FEE-bearing path is already exercised via BUY/SELL.
// ---------------------------------------------------------------------------
db.transaction(() => {
  // SECURITY_TRANSFER — move 5 IWDA from IB → SC securities account.
  const stOutUuid = randomUUID();
  const stInUuid = randomUUID();
  const stDate = '2025-02-20';
  const stShares = 5;
  insertXact.run(
    stOutUuid, 'portfolio', IB_SEC_ID, stDate, 'EUR',
    0, IWDA.uuid, shares8(stShares),
    'Internal portfolio rebalance', now, 'TRANSFER_OUT', 0, 0, nextXmlId(), nextOrder(),
  );
  insertXact.run(
    stInUuid, 'portfolio', SC_SEC_ID, stDate, 'EUR',
    0, IWDA.uuid, shares8(stShares),
    'Inbound from IB', now, 'TRANSFER_IN', 0, 0, nextXmlId(), nextOrder(),
  );
  insertCrossEntry.run('portfolio-transfer', IB_SEC_ID, stOutUuid, SC_SEC_ID, stInUuid);

  // DELIVERY_INBOUND — 10 free MSFT (e.g. employer ESPP grant), no fees.
  const diUuid = randomUUID();
  insertXact.run(
    diUuid, 'portfolio', SC_SEC_ID, '2024-10-15', 'EUR',
    0, MSFT.uuid, shares8(10),
    'Employer share grant', now, 'TRANSFER_IN', 0, 0, nextXmlId(), nextOrder(),
  );

  // DELIVERY_OUTBOUND — 2 NVDA shares gifted out, no fees.
  const doUuid = randomUUID();
  insertXact.run(
    doUuid, 'portfolio', SC_SEC_ID, '2025-12-20', 'EUR',
    0, NVDA.uuid, shares8(2),
    'Gift transfer to family member', now, 'TRANSFER_OUT', 0, 0, nextXmlId(), nextOrder(),
  );
})();

console.log('[SecTransfer/Delivery] 1 security-transfer (2 rows + 1 cross) + 1 inbound + 1 outbound');

// ---------------------------------------------------------------------------
// 9e. FX rates + cross-currency transactions
// vf_exchange_rate is keyed (date, from_currency, to_currency); rate is the
// qv-convention security-per-deposit value, i.e. amount_from × rate =
// amount_to. fx.service.getRate forward-fills (closest previous date), so a
// weekly cadence is sufficient for downstream lookups.
// ---------------------------------------------------------------------------
const insertFx = db.prepare(
  `INSERT OR REPLACE INTO vf_exchange_rate (date, from_currency, to_currency, rate) VALUES (?, ?, ?, ?)`,
);

db.transaction(() => {
  // Weekly EUR→USD rate, drifting around 1.05–1.15.
  let rate = 1.10;
  const allDays = tradingDays(PRICE_START, PRICE_END);
  for (let i = 0; i < allDays.length; i += 5) {
    const day = allDays[i];
    rate = Math.max(1.05, Math.min(1.15, rate + gaussRandom(0, 0.005)));
    insertFx.run(fmtDate(day), 'EUR', 'USD', rate.toFixed(6));
  }
})();

console.log('[FX] EUR→USD weekly rates seeded into vf_exchange_rate');

// USD same-currency BUY of TSLA — paid from the USD sub-account. No FOREX
// unit because deposit and security currencies match.
db.transaction(() => {
  insertBuy(IB_SEC_ID, IB_USD_CASH_ID, TSLA, '2024-08-20', 10, 'TSLA initial position (USD)', 'USD');
  insertBuy(IB_SEC_ID, IB_USD_CASH_ID, TSLA, '2025-05-16', 5, 'TSLA top-up (USD)', 'USD');
})();

console.log('[USD-BUY] 2 same-currency USD BUYs of TSLA');

// Cross-currency BUY of TSLA — security-side denominates in USD but payment
// flows from the EUR IB cash account. Mirrors transaction.service.ts BUY
// FOREX-unit emission: xact.amount lives in deposit ccy (EUR), the FOREX
// xact_unit carries the security-ccy magnitude in `forex_amount`.
function insertCrossCurrencyBuy(
  portfolioId: string, depositId: string, secDef: SecurityDef,
  dateStr: string, sharesCount: number, fxRate: number, note: string | null,
): void {
  const priceSecCcy = lookupPrice(secDef.uuid, dateStr);     // already in security currency (USD here)
  const grossSecurity = sharesCount * priceSecCcy;           // USD gross
  const grossDeposit = grossSecurity / fxRate;               // EUR gross
  // Realistic brokerage fee: 0.15% of trade value (EUR), min 2.95 EUR.
  const feeEur = Math.round(Math.max(2.95, grossDeposit * 0.0015) * 100) / 100;
  const feeHecto = hecto(feeEur);

  // Securities-side xact in deposit currency.
  const secSideUuid = randomUUID();
  insertXact.run(
    secSideUuid, 'portfolio', portfolioId, dateStr, 'EUR',
    hecto(grossDeposit), secDef.uuid, shares8(sharesCount),
    note, now, 'BUY', feeHecto, 0, nextXmlId(), nextOrder(),
  );
  // FEE unit (EUR).
  insertXactUnit.run(secSideUuid, 'FEE', feeHecto, 'EUR');
  // FOREX unit — amount=deposit hecto (EUR), forex_amount=security hecto (USD).
  insertXactUnitForex.run(
    secSideUuid, 'FOREX',
    hecto(grossDeposit), 'EUR',
    hecto(grossSecurity), secDef.currency,
    String(fxRate),
  );

  // Cash-side xact (deposit currency, includes fee).
  const cashSideUuid = randomUUID();
  insertXact.run(
    cashSideUuid, 'account', depositId, dateStr, 'EUR',
    hecto(grossDeposit + feeEur), secDef.uuid, 0,
    null, now, 'BUY', 0, 0, nextXmlId(), nextOrder(),
  );

  insertCrossEntry.run('buysell', portfolioId, secSideUuid, depositId, cashSideUuid);
}

db.transaction(() => {
  insertCrossCurrencyBuy(IB_SEC_ID, IB_CASH_ID, TSLA, '2025-03-17', 4, 1.10, 'TSLA cross-currency BUY (EUR → USD)');
})();

console.log('[FX-BUY] 1 cross-currency BUY of TSLA (EUR cash → USD security)');

// Cross-currency TRANSFER_BETWEEN_ACCOUNTS — EUR IB Cash → USD sub-account.
// Both legs carry the source-side currency on xact.currency per the documented
// upstream inheritance (csv-import.md "per-leg currency on transfers"); the
// FOREX xact_unit on the source row records the destination magnitude.
db.transaction(() => {
  const fxOutUuid = randomUUID();
  const fxInUuid = randomUUID();
  const fxDate = '2025-09-22';
  const amountEur = 2000;
  const fxRate = 1.10;

  insertXact.run(
    fxOutUuid, 'account', IB_CASH_ID, fxDate, 'EUR',
    hecto(amountEur), null, 0,
    'Convert EUR → USD (rebalance)', now, 'TRANSFER_OUT', 0, 0, nextXmlId(), nextOrder(),
  );
  insertXact.run(
    fxInUuid, 'account', IB_USD_CASH_ID, fxDate, 'EUR',
    hecto(amountEur), null, 0,
    'Convert EUR → USD (rebalance)', now, 'TRANSFER_IN', 0, 0, nextXmlId(), nextOrder(),
  );
  insertCrossEntry.run('account-transfer', IB_CASH_ID, fxOutUuid, IB_USD_CASH_ID, fxInUuid);
  // FOREX unit on the source row.
  insertXactUnitForex.run(
    fxOutUuid, 'FOREX',
    hecto(amountEur), 'EUR',
    hecto(amountEur * fxRate), 'USD',
    String(fxRate),
  );
})();

console.log('[FX-Transfer] 1 cross-currency transfer (EUR → USD) inserted');

// ---------------------------------------------------------------------------
// Invariant: every xact.amount is a non-negative magnitude (ppxml2db
// convention). Sign is carried by xact.type (OUTFLOW vs INFLOW) — see
// transaction.service.ts:11-32 for the canonical rule. Getting this wrong
// silently double-negates BUY/TRANSFER_OUT in getDepositBalance and inflates
// cash balances; that was BUG-80.
// ---------------------------------------------------------------------------
const negativeAmountRows = db.prepare(`
  SELECT type, COUNT(*) AS n
  FROM xact
  WHERE amount < 0
  GROUP BY type
`).all();
if (negativeAmountRows.length > 0) {
  throw new Error(
    `[Seed invariant] xact.amount must be >= 0 (ppxml2db magnitude convention); ` +
    `violations: ${JSON.stringify(negativeAmountRows)}`
  );
}

// ---------------------------------------------------------------------------
// Invariant: xact.type stores the ppxml2db form, not the quovibe enum form.
// The live write path (transaction.service.ts:55-65) maps enum→DB for the
// divergent names; the seed must produce the same on-disk shape or the
// balance/reports queries that key on the DB form silently skip rows. The
// only divergent name today is DIVIDEND→DIVIDENDS; extend this guard when
// TYPE_MAP_TO_PPXML2DB grows.
// ---------------------------------------------------------------------------
const enumLeakRows = db.prepare(`
  SELECT type, COUNT(*) AS n
  FROM xact
  WHERE type IN ('DIVIDEND')
  GROUP BY type
`).all();
if (enumLeakRows.length > 0) {
  throw new Error(
    `[Seed invariant] xact.type must use ppxml2db form (e.g. 'DIVIDENDS' not 'DIVIDEND'); ` +
    `violations: ${JSON.stringify(enumLeakRows)}`
  );
}

console.log('[Xact] invariants checked (amount >= 0, DB type names)');

// ---------------------------------------------------------------------------
// Invariant: every cash account ends with a non-negative balance. CASE copies
// getDepositBalance in accounts.service.ts:138-157 verbatim (DB-form, post
// enum→ppxml2db rename). When TYPE_MAP_TO_PPXML2DB grows or a new
// cash-affecting xact.type is introduced, this CASE and getDepositBalance's
// must be updated in lockstep — they share the same sign table by definition.
// Closes BUG-105: pre-fix, BUG-80's sign-flip silently inflated IB Cash so the
// DCA + lump-sum schedule appeared solvent; the honest ledger ended at -€5,852.
// ---------------------------------------------------------------------------
const negativeCashAccounts = db.prepare(`
  SELECT a.uuid, a.name,
         COALESCE(SUM(
           CASE x.type
             WHEN 'DEPOSIT'         THEN  x.amount
             WHEN 'REMOVAL'         THEN -x.amount
             WHEN 'BUY'             THEN -x.amount
             WHEN 'SELL'            THEN  x.amount
             WHEN 'DIVIDENDS'       THEN  x.amount
             WHEN 'INTEREST'        THEN  x.amount
             WHEN 'FEES'            THEN -x.amount
             WHEN 'FEES_REFUND'     THEN  x.amount
             WHEN 'TAXES'           THEN -x.amount
             WHEN 'TAX_REFUND'      THEN  x.amount
             WHEN 'INTEREST_CHARGE' THEN -x.amount
             WHEN 'TRANSFER_IN'     THEN  x.amount
             WHEN 'TRANSFER_OUT'    THEN -x.amount
             ELSE 0
           END
         ), 0) AS balance
  FROM account a
  LEFT JOIN xact x ON x.account = a.uuid
  WHERE a.type = 'account'
  GROUP BY a.uuid
  HAVING balance < 0
`).all();
if (negativeCashAccounts.length > 0) {
  throw new Error(
    `[Seed invariant] cash accounts ended below zero (BUG-105): ` +
    JSON.stringify(negativeCashAccounts)
  );
}

console.log('[Cash] per-account balance invariant checked (all >= 0)');

// ---------------------------------------------------------------------------
// 10. Taxonomies
// ---------------------------------------------------------------------------
interface TaxonomyLeaf {
  name: string;
  color: string;
  // Target allocation in basis points (10000 = 100%). Leaves within a
  // taxonomy MUST sum to 10000 so the Rebalancing tab renders valid targets.
  weight: number;
  items: { uuid: string; itemType: 'security' | 'account' }[];
}

function createTaxonomy(taxName: string, leaves: TaxonomyLeaf[]): void {
  const weightSum = leaves.reduce((acc, leaf) => acc + leaf.weight, 0);
  if (weightSum !== 10000) {
    throw new Error(`[Taxonomies] "${taxName}" leaf weights must sum to 10000 bp (got ${weightSum}).`);
  }

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
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(catUuid, taxUuid, rootUuid, leaf.name, leaf.color, leaf.weight, rank);

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
  // Asset Class (weights sum to 100%)
  createTaxonomy('Asset Class', [
    { name: 'Equity ETF', color: '#4285F4', weight: 5000, items: [secItem(VWCE), secItem(IWDA), secItem(SXR8), secItem(EIMI), secItem(IQQH), secItem(CJ1)] },
    { name: 'Single Stock', color: '#EA4335', weight: 2000, items: [secItem(AAPL), secItem(ASML), secItem(SAP_SEC), secItem(MSFT), secItem(NVDA), secItem(MC), secItem(ALV), secItem(DTE)] },
    { name: 'Bond', color: '#FBBC04', weight: 1500, items: [secItem(XBLC)] },
    { name: 'Cash', color: '#34A853', weight: 1500, items: [accItem(IB_CASH_ID), accItem(SC_CASH_ID), accItem(CASH_RESERVE_ID)] },
  ]);

  // Region (weights sum to 100%)
  // Cash category mirrors the Asset-Class taxonomy so the Allocation surface's
  // portfolio total matches across all three taxonomies (BUG-78).
  createTaxonomy('Region', [
    { name: 'Global', color: '#4285F4', weight: 2500, items: [secItem(VWCE), secItem(IWDA)] },
    { name: 'North America', color: '#EA4335', weight: 2500, items: [secItem(SXR8), secItem(AAPL), secItem(MSFT), secItem(NVDA)] },
    { name: 'Europe', color: '#FBBC04', weight: 2000, items: [secItem(ASML), secItem(SAP_SEC), secItem(MC), secItem(ALV), secItem(DTE), secItem(XBLC)] },
    { name: 'Emerging Markets', color: '#34A853', weight: 500, items: [secItem(EIMI)] },
    { name: 'Japan', color: '#FF6D01', weight: 500, items: [secItem(CJ1)] },
    { name: 'Thematic', color: '#46BDC6', weight: 500, items: [secItem(IQQH)] },
    { name: 'Cash', color: '#9E9E9E', weight: 1500, items: [accItem(IB_CASH_ID), accItem(SC_CASH_ID), accItem(CASH_RESERVE_ID)] },
  ]);

  // Sector (weights sum to 100%)
  // Cash category mirrors the Asset-Class taxonomy so the Allocation surface's
  // portfolio total matches across all three taxonomies (BUG-78).
  createTaxonomy('Sector', [
    { name: 'Technology', color: '#4285F4', weight: 2500, items: [secItem(AAPL), secItem(ASML), secItem(SAP_SEC), secItem(MSFT), secItem(NVDA)] },
    { name: 'Broad Market', color: '#EA4335', weight: 2000, items: [secItem(VWCE), secItem(IWDA), secItem(SXR8), secItem(EIMI), secItem(CJ1)] },
    { name: 'Finance & Insurance', color: '#FBBC04', weight: 1000, items: [secItem(ALV)] },
    { name: 'Luxury', color: '#34A853', weight: 1000, items: [secItem(MC)] },
    { name: 'Telecom', color: '#FF6D01', weight: 1000, items: [secItem(DTE)] },
    { name: 'Clean Energy', color: '#46BDC6', weight: 500, items: [secItem(IQQH)] },
    { name: 'Fixed Income', color: '#9334E6', weight: 500, items: [secItem(XBLC)] },
    { name: 'Cash', color: '#9E9E9E', weight: 1500, items: [accItem(IB_CASH_ID), accItem(SC_CASH_ID), accItem(CASH_RESERVE_ID)] },
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
// 11b. Custom attribute types — exercises the user-editable attribute CRUD
// surface (only `logo` is built-in; everything else is per-PP parity).
// id is TEXT and used as the foreign key in security_attr.attr_uuid.
// ---------------------------------------------------------------------------
const SECURITY_TARGET = 'name.abuchen.portfolio.model.Security';
const insertAttrType = db.prepare(`
  INSERT INTO attribute_type (id, name, columnLabel, source, target, type, converterClass, props_json)
  VALUES (?, ?, ?, NULL, ?, ?, ?, '[]')
`);
const insertSecAttrCustom = db.prepare(`
  INSERT INTO security_attr (security, attr_uuid, type, value, seq) VALUES (?, ?, ?, ?, 0)
`);

db.transaction(() => {
  insertAttrType.run(
    'ter', 'TER', 'TER', SECURITY_TARGET,
    'java.lang.Double',
    'name.abuchen.portfolio.model.AttributeType$PercentConverter',
  );
  insertAttrType.run(
    'vendor', 'Vendor', 'Vendor', SECURITY_TARGET,
    'java.lang.String',
    'name.abuchen.portfolio.model.AttributeType$StringConverter',
  );

  // TER values (decimal — 0.0022 == 22 bps).
  const terValues: [SecurityDef, string][] = [
    [VWCE, '0.0022'], [IWDA, '0.0020'], [SXR8, '0.0007'],
    [EIMI, '0.0018'], [XBLC, '0.0012'], [IQQH, '0.0065'], [CJ1, '0.0045'],
  ];
  for (const [s, v] of terValues) {
    insertSecAttrCustom.run(s.uuid, 'ter', 'string', v);
  }

  // Vendor (free-text).
  const vendorValues: [SecurityDef, string][] = [
    [VWCE, 'Vanguard'], [IWDA, 'iShares'], [SXR8, 'iShares'],
    [EIMI, 'iShares'], [XBLC, 'Xtrackers'], [IQQH, 'iShares'],
    [CJ1, 'Amundi'],
  ];
  for (const [s, v] of vendorValues) {
    insertSecAttrCustom.run(s.uuid, 'vendor', 'string', v);
  }
})();

console.log('[AttributeTypes] 2 custom attribute types + 14 security_attr values inserted');

// ---------------------------------------------------------------------------
// 11c. Portfolio-scoped chart config (vf_chart_config) — exercises the chart
// content surface (series refs, visibility, benchmarks). Aesthetics live in
// sidecar preferences, NOT in this row.
// ---------------------------------------------------------------------------
db.prepare(
  `INSERT INTO vf_chart_config (chart_id, config_json, schema_version, updatedAt) VALUES (?, ?, ?, ?)`,
).run(
  'dashboard-perf-chart',
  JSON.stringify({
    seriesRefs: [
      { kind: 'account', id: IB_SEC_ID },
      { kind: 'account', id: SC_SEC_ID },
      { kind: 'security', id: VWCE.uuid },
    ],
    visibility: { [IB_SEC_ID]: true, [SC_SEC_ID]: true, [VWCE.uuid]: true },
    benchmarks: [],
  }),
  1,
  now,
);

console.log('[ChartConfig] 1 vf_chart_config row inserted');

// ---------------------------------------------------------------------------
// 12. Summary
// ---------------------------------------------------------------------------
const tables = [
  'account', 'security', 'price', 'latest_price', 'xact', 'xact_cross_entry',
  'xact_unit', 'property', 'taxonomy', 'taxonomy_category', 'taxonomy_assignment',
  'watchlist', 'watchlist_security', 'attribute_type', 'security_attr',
  'vf_portfolio_meta', 'vf_dashboard', 'vf_exchange_rate', 'vf_chart_config',
];

console.log('\n--- Row counts ---');
for (const t of tables) {
  const row = db.prepare(`SELECT COUNT(*) as cnt FROM ${t}`).get() as { cnt: number };
  console.log(`  ${t}: ${row.cnt}`);
}

// ---------------------------------------------------------------------------
// 13. Logos — fetched from Clearbit / Google favicon and stored as base64
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
  console.log('\n[Logos] Fetching logos...');
  let logosOk = 0;
  let logosFail = 0;

  for (const { id, domain } of SEC_LOGOS) {
    const data = await getLogoBase64(domain);
    if (data) {
      insertSecAttr.run(id, data);
      logosOk++;
    } else {
      logosFail++;
      console.warn(`  No logo for security ${id} (${domain})`);
    }
  }

  for (const { id, domain } of ACC_LOGOS) {
    const data = await getLogoBase64(domain);
    if (data) {
      insertAccAttr.run(id, data);
      logosOk++;
    } else {
      logosFail++;
      console.warn(`  No logo for account ${id} (${domain})`);
    }
  }

  console.log(`[Logos] ${logosOk} stored, ${logosFail} failed`);

  db.close();
  console.log(`\n[seed-demo] wrote ${DB_OUT}`);
})();
