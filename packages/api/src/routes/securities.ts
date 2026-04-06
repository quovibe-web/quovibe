import { Router, type Router as RouterType } from 'express';
import type { RequestHandler } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { eq, asc, and, like } from 'drizzle-orm';
import { createSecuritySchema, filterTradingDays, resolveCalendarId, updateSecurityAttributesSchema, updateSecurityTaxonomiesSchema } from '@quovibe/shared';
import { securities, latestPrices, prices, securityAttributes } from '../db/schema';
import { convertPriceFromDb } from '../services/unit-conversion';
import { fetchNetSharesPerSecurity } from '../services/performance.service';
import { fetchSecurityPrices, testFetchPrices } from '../services/prices.service';
import type { TestFetchConfig } from '../services/prices.service';
import { getDb, getSqlite } from '../helpers/request';
import { securitySearchRouter } from './security-search';
import {
  createSecurity as createSecurityService,
  updateSecurity as updateSecurityService,
  updateSecurityTaxonomies,
  updateSecurityFeedConfig,
  deleteSecurity as deleteSecurityService,
} from '../services/securities.service';

export const securitiesRouter: RouterType = Router();

// CRITICO: register /search and /preview-prices BEFORE /:id to prevent
// Express from treating "search"/"preview-prices" as an :id parameter
securitiesRouter.use('/', securitySearchRouter);

const listSecurities: RequestHandler = async (req, res) => {
  const db = getDb(req);
  const sqlite = getSqlite(req);
  const includeRetired = req.query.includeRetired === 'true';
  const page = Math.max(1, parseInt(req.query.page as string || '1', 10));
  const limit = Math.min(100, parseInt(req.query.limit as string || '50', 10));

  const rows = await db
    .select({
      id: securities.id,
      name: securities.name,
      isin: securities.isin,
      ticker: securities.ticker,
      wkn: securities.wkn,
      currency: securities.currency,
      note: securities.note,
      isRetired: securities.isRetired,
      feedUrl: securities.feedUrl,
      feed: securities.feed,
      latestFeed: securities.latestFeed,
      latestFeedUrl: securities.latestFeedUrl,
      latestDate: latestPrices.date,
      latestValue: latestPrices.value,
      logoUrl: securityAttributes.value,
    })
    .from(securities)
    .leftJoin(latestPrices, eq(latestPrices.securityId, securities.id))
    .leftJoin(
      securityAttributes,
      and(
        eq(securityAttributes.securityId, securities.id),
        like(securityAttributes.value, 'data:image%'),
      ),
    )
    .where(includeRetired ? undefined : eq(securities.isRetired, false))
    .limit(limit)
    .offset((page - 1) * limit);

  // Batch-fetch last historical close per security
  const secIds = rows.map(r => r.id);
  const lastHistMap = new Map<string, { date: string; value: number }>();
  if (secIds.length > 0) {
    const placeholders = secIds.map(() => '?').join(',');
    const histRows = sqlite
      .prepare(
        `SELECT p.security, p.tstamp, p.value FROM price p
         INNER JOIN (
           SELECT security, MAX(tstamp) as max_date FROM price WHERE security IN (${placeholders}) GROUP BY security
         ) m ON p.security = m.security AND p.tstamp = m.max_date`,
      )
      .all(...secIds) as { security: string; tstamp: string; value: number }[];
    for (const h of histRows) lastHistMap.set(h.security, { date: h.tstamp, value: h.value });
  }

  // Batch-fetch net shares per security
  const netSharesMap = fetchNetSharesPerSecurity(sqlite, null);

  const data = rows.map(r => {
    const hist = lastHistMap.get(r.id);
    const lpDate = r.latestDate ?? null;
    const lpValue = r.latestValue != null
      ? convertPriceFromDb({ close: r.latestValue }).close.toNumber()
      : null;
    let effectiveLatestPrice: number | null;
    let effectiveLatestDate: string | null;
    if (hist && (!lpDate || hist.date > lpDate)) {
      effectiveLatestPrice = convertPriceFromDb({ close: hist.value }).close.toNumber();
      effectiveLatestDate = hist.date;
    } else {
      effectiveLatestPrice = lpValue;
      effectiveLatestDate = lpDate;
    }
    return {
      id: r.id,
      name: r.name,
      isin: r.isin,
      ticker: r.ticker,
      wkn: r.wkn,
      currency: r.currency,
      note: r.note,
      isRetired: r.isRetired,
      feedUrl: r.feedUrl,
      feed: r.feed,
      latestFeed: r.latestFeed,
      latestFeedUrl: r.latestFeedUrl,
      latestDate: effectiveLatestDate,
      latestPrice: effectiveLatestPrice,
      logoUrl: r.logoUrl ?? null,
      shares: netSharesMap.get(r.id)?.toString() ?? '0',
    };
  });

  res.json({ data, page, limit });
};

const getSecurity: RequestHandler = async (req, res) => {
  const db = getDb(req);
  const sqlite = getSqlite(req);
  const id = req.params['id'] as string;

  const rows = await db
    .select({
      id: securities.id,
      name: securities.name,
      isin: securities.isin,
      ticker: securities.ticker,
      wkn: securities.wkn,
      currency: securities.currency,
      note: securities.note,
      isRetired: securities.isRetired,
      feedUrl: securities.feedUrl,
      feed: securities.feed,
      latestFeed: securities.latestFeed,
      latestFeedUrl: securities.latestFeedUrl,
      feedTickerSymbol: securities.feedTickerSymbol,
      calendar: securities.calendar,
      latestDate: latestPrices.date,
      latestValue: latestPrices.value,
    })
    .from(securities)
    .leftJoin(latestPrices, eq(latestPrices.securityId, securities.id))
    .where(eq(securities.id, id));

  if (rows.length === 0) {
    res.status(404).json({ error: 'Security not found' });
    return;
  }

  const r = rows[0];

  const priceRows = await db
    .select()
    .from(prices)
    .where(eq(prices.securityId, id))
    .orderBy(asc(prices.date));

  const allPrices = priceRows.map(p => ({
    date: p.date,
    value: convertPriceFromDb({ close: p.close }).close.toString(),
  }));

  // Filter prices to trading days: resolve security calendar → global calendar → 'default'
  const globalCalRow = sqlite
    .prepare(`SELECT value FROM property WHERE name = 'portfolio.calendar'`)
    .get() as { value: string } | undefined;
  const resolvedCalendar = resolveCalendarId(r.calendar, globalCalRow?.value);
  const tradingDates = new Set(filterTradingDays(resolvedCalendar, allPrices.map(p => p.date)));
  const historicalPrices = resolvedCalendar === 'empty'
    ? allPrices
    : allPrices.filter(p => tradingDates.has(p.date));

  // Read FEED properties from security_prop
  const propRows = sqlite
    .prepare(`SELECT name, value FROM security_prop WHERE security = ? AND type = 'FEED' ORDER BY seq`)
    .all(id) as { name: string; value: string | null }[];
  const feedProperties: Record<string, string> = {};
  for (const p of propRows) {
    if (p.value != null) feedProperties[p.name] = p.value;
  }

  const attrRows = sqlite
    .prepare(`
      SELECT sa.attr_uuid as typeId, at.name as typeName, sa.value
      FROM security_attr sa
      LEFT JOIN attribute_type at ON at.id = sa.attr_uuid
        AND at.target = 'name.abuchen.portfolio.model.Security'
      WHERE sa.security = ?
    `)
    .all(id) as { typeId: string; typeName: string | null; value: string | null }[];

  const taxRows = sqlite
    .prepare(`
      SELECT category as categoryId, taxonomy as taxonomyId, weight
      FROM taxonomy_assignment
      WHERE item = ? AND item_type = 'security'
    `)
    .all(id) as { categoryId: string; taxonomyId: string; weight: number | null }[];

  // Effective latest price: use whichever is more recent between latest_price and last historical close
  const lastHistClose = historicalPrices.length > 0 ? historicalPrices[historicalPrices.length - 1] : null;
  const lpDate = r.latestDate ?? null;
  const lpValue = r.latestValue != null ? convertPriceFromDb({ close: r.latestValue }).close.toNumber() : null;
  let effectiveLatestPrice: number | null;
  let effectiveLatestDate: string | null;
  if (lastHistClose && (!lpDate || lastHistClose.date > lpDate)) {
    effectiveLatestPrice = parseFloat(lastHistClose.value);
    effectiveLatestDate = lastHistClose.date;
  } else {
    effectiveLatestPrice = lpValue;
    effectiveLatestDate = lpDate;
  }

  // Net shares for this security (filter by id to avoid scanning all xact rows)
  const netShares = fetchNetSharesPerSecurity(sqlite, null, id).get(id)?.toString() ?? '0';

  res.json({
    id: r.id,
    name: r.name,
    isin: r.isin,
    ticker: r.ticker,
    wkn: r.wkn,
    currency: r.currency,
    note: r.note,
    isRetired: r.isRetired,
    feedUrl: r.feedUrl,
    feed: r.feed,
    latestFeed: r.latestFeed,
    latestFeedUrl: r.latestFeedUrl,
    feedTickerSymbol: r.feedTickerSymbol ?? null,
    feedProperties,
    latestDate: effectiveLatestDate,
    latestPrice: effectiveLatestPrice,
    shares: netShares,
    prices: historicalPrices,
    calendar: r.calendar ?? null,
    attributes: attrRows.map(a => ({
      typeId: a.typeId,
      typeName: a.typeName ?? a.typeId,
      value: a.value ?? '',
    })),
    taxonomyAssignments: taxRows,
  });
};

const createSecurity: RequestHandler = async (req, res) => {
  const input = createSecuritySchema.parse(req.body);
  const db = getDb(req);
  const sqlite = getSqlite(req);
  const id = uuidv4();

  createSecurityService(sqlite, {
    id, name: input.name, isin: input.isin ?? null, ticker: input.ticker ?? null,
    wkn: input.wkn ?? null, currency: input.currency, note: input.note ?? null,
    isRetired: input.isRetired ?? false, feedUrl: input.feedUrl ?? null,
    feed: input.feed ?? null, latestFeedUrl: input.latestFeedUrl ?? null,
    latestFeed: input.latestFeed ?? null, feedTickerSymbol: input.feedTickerSymbol ?? null,
    calendar: input.calendar ?? null, onlineId: input.onlineId ?? null,
    pathToDate: input.pathToDate, pathToClose: input.pathToClose,
  });

  const rows = await db.select().from(securities).where(eq(securities.id, id));
  if (rows.length === 0) {
    res.status(500).json({ error: 'Failed to retrieve created security' });
    return;
  }
  const r = rows[0];
  res.status(201).json({
    ...r,
    calendar: r.calendar ?? null,
    latestFeedUrl: r.latestFeedUrl ?? null,
  });
};

const updateSecurity: RequestHandler = async (req, res) => {
  const input = createSecuritySchema.partial().parse(req.body);
  const db = getDb(req);
  const sqlite = getSqlite(req);
  const id = req.params['id'] as string;

  const existing = await db.select().from(securities).where(eq(securities.id, id));
  if (existing.length === 0) {
    res.status(404).json({ error: 'Security not found' });
    return;
  }

  updateSecurityService(sqlite, id, input);

  const updated = await db.select().from(securities).where(eq(securities.id, id));
  if (updated.length === 0) {
    res.status(404).json({ error: 'Security not found after update' });
    return;
  }
  const r = updated[0];
  res.json({
    ...r,
    calendar: r.calendar ?? null,
    latestFeedUrl: r.latestFeedUrl ?? null,
  });
};

const updateAttributesHandler: RequestHandler = async (req, res) => {
  const db = getDb(req);
  const sqlite = getSqlite(req);
  const id = req.params['id'] as string;

  const existing = await db.select({ id: securities.id }).from(securities).where(eq(securities.id, id));
  if (existing.length === 0) { res.status(404).json({ error: 'Security not found' }); return; }

  const { attributes } = updateSecurityAttributesSchema.parse(req.body);

  const getAttrType = sqlite.prepare("SELECT type FROM attribute_type WHERE id = ? LIMIT 1");

  const deleteAll = sqlite.prepare('DELETE FROM security_attr WHERE security = ?'); // db-route-ok
  const insert = sqlite.prepare( // db-route-ok
    'INSERT INTO security_attr (security, attr_uuid, type, value, seq) VALUES (?, ?, ?, ?, ?)',
  );

  sqlite.transaction(() => {
    deleteAll.run(id);
    for (let i = 0; i < attributes.length; i++) {
      const attr = attributes[i];
      const atRow = getAttrType.get(attr.typeId) as { type: string } | undefined;
      const type = atRow?.type === 'java.lang.Double' ? 'double' : 'string';
      insert.run(id, attr.typeId, type, attr.value, i);
    }
  })();

  res.json({ ok: true });
};

const updateTaxonomyHandler: RequestHandler = async (req, res) => {
  const db = getDb(req);
  const sqlite = getSqlite(req);
  const id = req.params['id'] as string;

  const existing = await db.select({ id: securities.id }).from(securities).where(eq(securities.id, id));
  if (existing.length === 0) { res.status(404).json({ error: 'Security not found' }); return; }

  const { assignments } = updateSecurityTaxonomiesSchema.parse(req.body);

  updateSecurityTaxonomies(sqlite, id, assignments);

  res.json({ ok: true });
};

const fetchSecurityPricesHandler: RequestHandler = async (req, res) => {
  const sqlite = getSqlite(req);
  const id = req.params['id'] as string;

  const row = sqlite
    .prepare('SELECT uuid, feed FROM security WHERE uuid = ?')
    .get(id) as { uuid: string; feed: string | null } | undefined;

  if (!row) {
    res.status(404).json({ error: 'Security not found' });
    return;
  }

  if (!row.feed) {
    res.status(400).json({ error: 'Security has no feed configured' });
    return;
  }

  const mode = req.query['mode'] === 'replace' ? 'replace' : 'merge';
  const result = await fetchSecurityPrices(sqlite, id, undefined, undefined, mode);
  res.json({ securityId: id, ...result });
};

const testFetchPricesHandler: RequestHandler = async (req, res) => {
  const sqlite = getSqlite(req);
  const id = req.params['id'] as string;

  const row = sqlite
    .prepare('SELECT uuid FROM security WHERE uuid = ?')
    .get(id) as { uuid: string } | undefined;

  if (!row) {
    res.status(404).json({ error: 'Security not found' });
    return;
  }

  const body = req.body as Partial<TestFetchConfig>;
  const overrideConfig: TestFetchConfig = {};
  if (body.feed) overrideConfig.feed = body.feed;
  if (body.feedUrl) overrideConfig.feedUrl = body.feedUrl;
  if (body.pathToDate) overrideConfig.pathToDate = body.pathToDate;
  if (body.pathToClose) overrideConfig.pathToClose = body.pathToClose;
  if (body.dateFormat) overrideConfig.dateFormat = body.dateFormat;
  if (body.factor != null) overrideConfig.factor = body.factor;

  const result = await testFetchPrices(sqlite, id, Object.keys(overrideConfig).length > 0 ? overrideConfig : undefined);

  const sorted = [...result.prices].sort((a, b) => b.date.localeCompare(a.date));
  res.json({
    prices: sorted.map(p => ({ date: p.date, close: p.close.toString() })),
    count: sorted.length,
    firstDate: sorted[0]?.date ?? null,
    lastDate: sorted[sorted.length - 1]?.date ?? null,
    error: result.error ?? null,
  });
};

const updateFeedConfigHandler: RequestHandler = async (req, res) => {
  const sqlite = getSqlite(req);
  const id = req.params['id'] as string;

  const existing = sqlite
    .prepare('SELECT uuid FROM security WHERE uuid = ?')
    .get(id) as { uuid: string } | undefined;

  if (!existing) {
    res.status(404).json({ error: 'Security not found' });
    return;
  }

  const body = req.body as {
    feed?: string;
    feedUrl?: string;
    pathToDate?: string;
    pathToClose?: string;
    dateFormat?: string;
    factor?: number;
  };

  updateSecurityFeedConfig(sqlite, id, body);

  res.json({ ok: true });
};

const deleteSecurity: RequestHandler = (req, res) => {
  const { id } = req.params;
  const sqlite = getSqlite(req);

  const security = sqlite.prepare('SELECT uuid FROM security WHERE uuid = ?').get(id) as { uuid: string } | undefined;
  if (!security) {
    res.status(404).json({ error: 'Security not found' });
    return;
  }

  const txCount = (sqlite.prepare('SELECT COUNT(*) as n FROM xact WHERE security = ?').get(id) as { n: number }).n;
  if (txCount > 0) {
    res.status(409).json({ error: 'security_has_transactions', count: txCount });
    return;
  }

  deleteSecurityService(sqlite, id as string);

  res.json({ ok: true });
};

securitiesRouter.get('/', listSecurities);
securitiesRouter.get('/:id', getSecurity);
securitiesRouter.post('/', createSecurity);
securitiesRouter.put('/:id', updateSecurity);
securitiesRouter.delete('/:id', deleteSecurity);
securitiesRouter.put('/:id/attributes', updateAttributesHandler);
securitiesRouter.put('/:id/taxonomy', updateTaxonomyHandler);
securitiesRouter.put('/:id/prices/fetch', fetchSecurityPricesHandler);
securitiesRouter.post('/:id/prices/test-fetch', testFetchPricesHandler);
securitiesRouter.put('/:id/feed-config', updateFeedConfigHandler);
