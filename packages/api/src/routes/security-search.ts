import { Router, type Router as RouterType, type RequestHandler } from 'express';
import { searchQuerySchema, previewPricesSchema, importPricesSchema } from '@quovibe/shared';
import { searchYahoo, fetchPreviewPrices, YahooSearchError } from '../services/yahoo-search.service';
import { importSecurityPrices } from '../services/security-search-import.service';
import { getSqlite } from '../helpers/request';

export const securitySearchRouter: RouterType = Router();

// ─── GET /search ─────────────────────────────────────────────────────────────

const searchHandler: RequestHandler = async (req, res) => {
  const parsed = searchQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid query', details: parsed.error.flatten() });
    return;
  }

  try {
    const items = await searchYahoo(parsed.data.q);
    res.json(items);
  } catch (err) {
    if (err instanceof YahooSearchError) {
      console.error('[security-search] Yahoo search failed:', err.message);
      res.status(502).json({ error: 'Search provider unavailable' });
      return;
    }
    throw err;
  }
};

// ─── POST /preview-prices ────────────────────────────────────────────────────

const previewPricesHandler: RequestHandler = async (req, res) => {
  const parsed = previewPricesSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });
    return;
  }

  try {
    const result = await fetchPreviewPrices(parsed.data.ticker, parsed.data.startDate);
    res.json(result);
  } catch (err) {
    if (err instanceof YahooSearchError) {
      console.error('[security-search] Yahoo preview-prices failed:', err.message);
      res.status(502).json({ error: 'Price provider unavailable' });
      return;
    }
    throw err;
  }
};

// ─── POST /:id/prices/import ──────────────────────────────────────────────────

const importPricesHandler: RequestHandler = (req, res) => {
  const parsed = importPricesSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });
    return;
  }

  const id = req.params.id as string;
  const sqlite = getSqlite(req);

  // Verify security exists
  const security = sqlite.prepare('SELECT uuid FROM security WHERE uuid = ?').get(id) as { uuid: string } | undefined;
  if (!security) {
    res.status(404).json({ error: 'Security not found' });
    return;
  }

  const result = importSecurityPrices(sqlite, id, parsed.data.prices);
  res.json(result);
};

securitySearchRouter.get('/search', searchHandler);
securitySearchRouter.post('/preview-prices', previewPricesHandler);
securitySearchRouter.post('/:id/prices/import', importPricesHandler);
