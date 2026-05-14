import { Router, type Router as RouterType, type RequestHandler } from 'express';
import { eq } from 'drizzle-orm';
import {
  createWatchlistSchema,
  updateWatchlistSchema,
  addWatchlistSecuritySchema,
  reorderWatchlistsSchema,
  reorderWatchlistSecuritiesSchema,
} from '@quovibe/shared';
import { watchlists } from '../db/schema';
import { getDb, getSqlite } from '../helpers/request';
import {
  updateWatchlistName,
  convertWatchlistPriceFromDb,
  computePeriodChange,
  deleteWatchlistById,
  duplicateWatchlistById,
  type WatchlistPeriodChange,
} from '../services/watchlists.service';

export const watchlistsRouter: RouterType = Router();

// ─── Types ──────────────────────────────────────────────────────────────────

interface WatchlistRow {
  _id: number;
  name: string;
  _order: number;
}

interface WireWatchlistSecurity {
  id: string;
  name: string;
  isin: string | null;
  ticker: string | null;
  currency: string;
  logoUrl: string | null;
  latestPrice: number | null;
  latestPriceDate: string | null;
  previousClose: number | null;
  change1d: WatchlistPeriodChange | null;
  change1w: WatchlistPeriodChange | null;
  change1m: WatchlistPeriodChange | null;
  change1y: WatchlistPeriodChange | null;
}

/** SQLite date() modifiers for each period-change window. */
const PERIOD_WINDOWS = {
  w: '-7 days',
  m: '-1 month',
  y: '-1 year',
} as const;

// ─── Handlers ────────────────────────────────────────────────────────────────

const listWatchlists: RequestHandler = (req, res) => {
  const sqlite = getSqlite(req);

  const lists = sqlite
    .prepare('SELECT _id, name, _order FROM watchlist ORDER BY _order ASC')
    .all() as WatchlistRow[];

  const result = lists.map((wl) => {
    // Derived table `base` computes the per-security anchor once
    // (latest_price.tstamp if present else max(price.tstamp)) and the 1D
    // predicate uses strict inequality against it — BUG-40 rule: today's
    // intraday snapshot written by yf.chart() shares the anchor date and
    // would otherwise collapse change1d to 0 (.claude/rules/latest-price.md).
    // 1W/1M/1Y apply SQLite's date(anchor, '-N …') modifier; YYYY-MM-DD
    // storage makes the string comparison well-ordered.
    const securities = sqlite
      .prepare(
        `SELECT
           base.id,
           base.name,
           base.isin,
           base.ticker,
           base.currency,
           base.logoUrl,
           base.latestPriceRaw,
           base.latestPriceDate,
           base.currentPriceRaw,
           (SELECT p.value  FROM price p WHERE p.security = base.id AND p.tstamp < base.anchorTstamp                        ORDER BY p.tstamp DESC LIMIT 1) AS prev1dRaw,
           (SELECT p.tstamp FROM price p WHERE p.security = base.id AND p.tstamp < base.anchorTstamp                        ORDER BY p.tstamp DESC LIMIT 1) AS prev1dDate,
           (SELECT p.value  FROM price p WHERE p.security = base.id AND p.tstamp <= date(base.anchorTstamp, '${PERIOD_WINDOWS.w}') ORDER BY p.tstamp DESC LIMIT 1) AS prev1wRaw,
           (SELECT p.tstamp FROM price p WHERE p.security = base.id AND p.tstamp <= date(base.anchorTstamp, '${PERIOD_WINDOWS.w}') ORDER BY p.tstamp DESC LIMIT 1) AS prev1wDate,
           (SELECT p.value  FROM price p WHERE p.security = base.id AND p.tstamp <= date(base.anchorTstamp, '${PERIOD_WINDOWS.m}') ORDER BY p.tstamp DESC LIMIT 1) AS prev1mRaw,
           (SELECT p.tstamp FROM price p WHERE p.security = base.id AND p.tstamp <= date(base.anchorTstamp, '${PERIOD_WINDOWS.m}') ORDER BY p.tstamp DESC LIMIT 1) AS prev1mDate,
           (SELECT p.value  FROM price p WHERE p.security = base.id AND p.tstamp <= date(base.anchorTstamp, '${PERIOD_WINDOWS.y}') ORDER BY p.tstamp DESC LIMIT 1) AS prev1yRaw,
           (SELECT p.tstamp FROM price p WHERE p.security = base.id AND p.tstamp <= date(base.anchorTstamp, '${PERIOD_WINDOWS.y}') ORDER BY p.tstamp DESC LIMIT 1) AS prev1yDate
         FROM (
           SELECT
             s.uuid AS id,
             s.name,
             s.isin,
             s.tickerSymbol AS ticker,
             s.currency,
             (SELECT sa.value FROM security_attr sa WHERE sa.security = s.uuid AND sa.value LIKE 'data:image%' LIMIT 1) AS logoUrl,
             lp.value  AS latestPriceRaw,
             lp.tstamp AS latestPriceDate,
             COALESCE(lp.value,  (SELECT p.value  FROM price p WHERE p.security = s.uuid ORDER BY p.tstamp DESC LIMIT 1)) AS currentPriceRaw,
             COALESCE(lp.tstamp, (SELECT p.tstamp FROM price p WHERE p.security = s.uuid ORDER BY p.tstamp DESC LIMIT 1)) AS anchorTstamp
           FROM watchlist_security ws
           JOIN security s ON s.uuid = ws.security
           LEFT JOIN latest_price lp ON lp.security = s.uuid
           WHERE ws.list = ?
         ) AS base`,
      )
      .all(wl._id) as Array<{
        id: string;
        name: string;
        isin: string | null;
        ticker: string | null;
        currency: string | null;
        logoUrl: string | null;
        latestPriceRaw: number | null;
        latestPriceDate: string | null;
        currentPriceRaw: number | null;
        prev1dRaw: number | null;
        prev1dDate: string | null;
        prev1wRaw: number | null;
        prev1wDate: string | null;
        prev1mRaw: number | null;
        prev1mDate: string | null;
        prev1yRaw: number | null;
        prev1yDate: string | null;
      }>;

    const mappedSecurities: WireWatchlistSecurity[] = securities.map((s) => ({
      id: s.id,
      name: s.name,
      isin: s.isin,
      ticker: s.ticker,
      currency: s.currency ?? 'EUR',
      logoUrl: s.logoUrl,
      latestPrice: convertWatchlistPriceFromDb(s.latestPriceRaw),
      latestPriceDate: s.latestPriceDate,
      // `previousClose` = 1D anchor price — WidgetWatchlist wire compat.
      previousClose: convertWatchlistPriceFromDb(s.prev1dRaw),
      change1d: computePeriodChange(s.currentPriceRaw, s.prev1dRaw, s.prev1dDate),
      change1w: computePeriodChange(s.currentPriceRaw, s.prev1wRaw, s.prev1wDate),
      change1m: computePeriodChange(s.currentPriceRaw, s.prev1mRaw, s.prev1mDate),
      change1y: computePeriodChange(s.currentPriceRaw, s.prev1yRaw, s.prev1yDate),
    }));

    return {
      id: wl._id,
      name: wl.name,
      order: wl._order,
      securities: mappedSecurities,
    };
  });

  res.json(result);
};

const createWatchlist: RequestHandler = (req, res) => {
  const input = createWatchlistSchema.parse(req.body);
  const sqlite = getSqlite(req);

  const { maxOrder } = sqlite
    .prepare('SELECT COALESCE(MAX(_order), -1) + 1 AS maxOrder FROM watchlist')
    .get() as { maxOrder: number };

  const result = sqlite
    .prepare('INSERT INTO watchlist (name, _order) VALUES (?, ?) RETURNING _id, name, _order') // db-route-ok
    .get(input.name, maxOrder) as WatchlistRow;

  res.status(201).json({
    id: result._id,
    name: result.name,
    order: result._order,
    securities: [],
  });
};

const reorderWatchlists: RequestHandler = (req, res) => {
  const { ids } = reorderWatchlistsSchema.parse(req.body);
  const sqlite = getSqlite(req);

  sqlite.transaction(() => {
    const stmt = sqlite.prepare('UPDATE watchlist SET _order = ? WHERE _id = ?'); // db-route-ok
    ids.forEach((id, index) => {
      stmt.run(index, id); // native-ok
    });
  })();

  res.json({ ok: true });
};

const updateWatchlist: RequestHandler = async (req, res) => {
  const input = updateWatchlistSchema.parse(req.body);
  const db = getDb(req);
  const id = parseInt(req.params['id'] as string, 10);

  if (isNaN(id)) { // native-ok
    res.status(400).json({ error: 'Invalid watchlist id' });
    return;
  }

  const existing = await db.select().from(watchlists).where(eq(watchlists.id, id));
  if (existing.length === 0) {
    res.status(404).json({ error: 'Watchlist not found' });
    return;
  }

  if (input.name !== undefined) {
    await updateWatchlistName(db, id, input.name);
  }

  const updated = await db.select().from(watchlists).where(eq(watchlists.id, id));
  if (updated.length === 0) {
    res.status(404).json({ error: 'Watchlist not found after update' });
    return;
  }
  const wl = updated[0];
  res.json({ id: wl.id, name: wl.name, order: wl._order });
};

const deleteWatchlist: RequestHandler = async (req, res) => {
  const db = getDb(req);
  const sqlite = getSqlite(req);
  const id = parseInt(req.params['id'] as string, 10);

  if (isNaN(id)) { // native-ok
    res.status(400).json({ error: 'Invalid watchlist id' });
    return;
  }

  const existing = await db.select().from(watchlists).where(eq(watchlists.id, id));
  if (existing.length === 0) {
    res.status(404).json({ error: 'Watchlist not found' });
    return;
  }

  deleteWatchlistById(sqlite, id);

  res.status(204).send();
};

const duplicateWatchlist: RequestHandler = (req, res) => {
  const sqlite = getSqlite(req);
  const id = parseInt(req.params['id'] as string, 10);

  if (isNaN(id)) { // native-ok
    res.status(400).json({ error: 'Invalid watchlist id' });
    return;
  }

  const existing = sqlite
    .prepare('SELECT _id, name, _order FROM watchlist WHERE _id = ?')
    .get(id) as WatchlistRow | undefined;

  if (!existing) {
    res.status(404).json({ error: 'Watchlist not found' });
    return;
  }

  const { maxOrder } = sqlite
    .prepare('SELECT COALESCE(MAX(_order), -1) + 1 AS maxOrder FROM watchlist')
    .get() as { maxOrder: number };

  const newName = `${existing.name} (copy)`;
  const created = duplicateWatchlistById(sqlite, id, newName, maxOrder);

  res.status(201).json({ id: created._id, name: created.name, order: created._order });
};

const addSecurity: RequestHandler = async (req, res) => {
  const input = addWatchlistSecuritySchema.parse(req.body);
  const db = getDb(req);
  const sqlite = getSqlite(req);
  const id = parseInt(req.params['id'] as string, 10);

  if (isNaN(id)) { // native-ok
    res.status(400).json({ error: 'Invalid watchlist id' });
    return;
  }

  const existing = await db.select().from(watchlists).where(eq(watchlists.id, id));
  if (existing.length === 0) {
    res.status(404).json({ error: 'Watchlist not found' });
    return;
  }

  // Check for duplicate
  const alreadyIn = sqlite
    .prepare('SELECT 1 FROM watchlist_security WHERE list = ? AND security = ?')
    .get(id, input.securityId);
  if (alreadyIn) {
    res.status(409).json({ error: 'SECURITY_ALREADY_IN_WATCHLIST' });
    return;
  }

  sqlite
    .prepare('INSERT INTO watchlist_security (list, security) VALUES (?, ?)') // db-route-ok
    .run(id, input.securityId);

  res.status(201).json({ ok: true });
};

const removeSecurity: RequestHandler = async (req, res) => {
  const db = getDb(req);
  const sqlite = getSqlite(req);
  const id = parseInt(req.params['id'] as string, 10);
  const securityId = req.params['securityId'] as string;

  if (isNaN(id)) { // native-ok
    res.status(400).json({ error: 'Invalid watchlist id' });
    return;
  }

  const existing = await db.select().from(watchlists).where(eq(watchlists.id, id));
  if (existing.length === 0) {
    res.status(404).json({ error: 'Watchlist not found' });
    return;
  }

  sqlite
    .prepare('DELETE FROM watchlist_security WHERE list = ? AND security = ?') // db-route-ok
    .run(id, securityId);

  res.status(204).send();
};

const reorderSecurities: RequestHandler = async (req, res) => {
  const { securityIds } = reorderWatchlistSecuritiesSchema.parse(req.body);
  const db = getDb(req);
  const sqlite = getSqlite(req);
  const id = parseInt(req.params['id'] as string, 10);

  if (isNaN(id)) { // native-ok
    res.status(400).json({ error: 'Invalid watchlist id' });
    return;
  }

  const existing = await db.select().from(watchlists).where(eq(watchlists.id, id));
  if (existing.length === 0) {
    res.status(404).json({ error: 'Watchlist not found' });
    return;
  }

  // watchlist_security has no _order column — delete and re-insert in the desired order
  sqlite.transaction(() => {
    sqlite.prepare('DELETE FROM watchlist_security WHERE list = ?').run(id); // db-route-ok
    const stmt = sqlite.prepare('INSERT INTO watchlist_security (list, security) VALUES (?, ?)'); // db-route-ok
    for (const secId of securityIds) {
      stmt.run(id, secId);
    }
  })();

  res.json({ ok: true });
};

// ─── Routes ──────────────────────────────────────────────────────────────────

watchlistsRouter.get('/', listWatchlists);
watchlistsRouter.post('/', createWatchlist);
watchlistsRouter.put('/reorder', reorderWatchlists); // MUST be before /:id
watchlistsRouter.put('/:id', updateWatchlist);
watchlistsRouter.delete('/:id', deleteWatchlist);
watchlistsRouter.post('/:id/duplicate', duplicateWatchlist);
watchlistsRouter.post('/:id/securities', addSecurity);
watchlistsRouter.delete('/:id/securities/:securityId', removeSecurity);
watchlistsRouter.put('/:id/securities/reorder', reorderSecurities);
