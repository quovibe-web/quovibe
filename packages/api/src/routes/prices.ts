import { Router, type Router as RouterType, type RequestHandler } from 'express';
import { fetchExchangeRatesSchema } from '@quovibe/shared';
import { getRate } from '../services/fx.service';
import { fetchAllExchangeRates } from '../services/fx-fetcher.service';
import { fetchAllPrices } from '../services/prices.service';
import { getSqlite, getPortfolioId } from '../helpers/request';

export const pricesRouter: RouterType = Router();

// In-process mutex keyed by portfolio id; replaces the old global PriceScheduler
// lock. Concurrent fetch-all requests for the same portfolio return 409.
const fetchInFlight = new Set<string>();

const fetchAll: RequestHandler = async (req, res) => {
  const id = getPortfolioId(req);
  if (fetchInFlight.has(id)) {
    res.status(409).json({ error: 'FETCH_IN_PROGRESS' });
    return;
  }
  fetchInFlight.add(id);
  try {
    const result = await fetchAllPrices(getSqlite(req));
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  } finally {
    fetchInFlight.delete(id);
  }
};

const getExchangeRate: RequestHandler = (req, res) => {
  const { from, to, date } = req.query as Record<string, string>;

  if (!from || !to || !date) {
    res.status(400).json({ error: 'Missing required query params: from, to, date' });
    return;
  }

  const sqlite = getSqlite(req);
  const rate = getRate(sqlite, from, to, date);

  if (rate === null) {
    res.status(404).json({ error: `No rate found for ${from}/${to} on ${date}` });
    return;
  }

  res.json({ from, to, date, rate: rate.toString() });
};

pricesRouter.post('/fetch-all', fetchAll);
pricesRouter.get('/exchange-rates', getExchangeRate);

// ─── Fetch exchange rates for all foreign currencies ──────────────────────────

const fetchExchangeRatesHandler: RequestHandler = async (req, res) => {
  const sqlite = getSqlite(req);
  const parsed = fetchExchangeRatesSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request body', details: parsed.error.flatten() });
    return;
  }

  try {
    const result = await fetchAllExchangeRates(sqlite, parsed.data ?? {});
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
};

pricesRouter.post('/fetch-exchange-rates', fetchExchangeRatesHandler);
