import { Router, type Router as RouterType, type RequestHandler } from 'express';
import { fetchExchangeRatesSchema } from '@quovibe/shared';
import type { PriceScheduler } from '../workers/price-scheduler';
import { getRate } from '../services/fx.service';
import { fetchAllExchangeRates } from '../services/fx-fetcher.service';
import { getSqlite } from '../helpers/request';

function getScheduler(
  req: { app: { locals: Record<string, unknown> } },
): PriceScheduler | undefined {
  return req.app.locals.priceScheduler as PriceScheduler | undefined;
}

export const pricesRouter: RouterType = Router();

const fetchAll: RequestHandler = async (req, res) => {
  const scheduler = getScheduler(req);
  if (!scheduler) {
    res.status(503).json({ error: 'Price scheduler not available' });
    return;
  }

  const status = scheduler.getStatus();
  if (status.status === 'running') {
    res.status(409).json({ error: 'Price fetch already in progress' });
    return;
  }

  try {
    const result = await scheduler.triggerNow();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
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
