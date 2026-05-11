import { Router, type Router as RouterType, type RequestHandler } from 'express';
import { getRate } from '../services/fx.service';
import { fetchSinglePairOnDemand } from '../services/fx-fetcher.service';
import { fetchAllPrices } from '../services/prices.service';
import { getSqlite, getPortfolioId, isDemoPortfolio } from '../helpers/request';

export const pricesRouter: RouterType = Router();

// In-process mutex keyed by portfolio id; replaces the old global PriceScheduler
// lock. Concurrent fetch-all requests for the same portfolio return 409.
// quovibe:allow-module-state — fetch-all mutex keyed by portfolio id; no data held (ADR-016).
const fetchInFlight = new Set<string>();

// Per-pair lazy-fill dedupe. Each fetchSinglePairOnDemand pulls the full ECB
// XML (~2.6 MB), so a multi-currency dashboard's first paint would otherwise
// fan out N parallel downloads of the same feed. INSERT OR REPLACE makes
// concurrent saves idempotent, so the dedupe is a network-waste fix, not a
// correctness fix. Key is `${from}|${to}`; portfolio-agnostic because the
// rate value is the same regardless of which DB stores it.
// quovibe:allow-module-state — per-pair fetch dedupe; no portfolio data (ADR-016).
const pairInFlight = new Map<string, Promise<void>>();

const fetchAll: RequestHandler = async (req, res) => {
  const id = getPortfolioId(req);
  if (isDemoPortfolio(req)) {
    res.status(403).json({ error: 'DEMO_PORTFOLIO_FETCH_BLOCKED' });
    return;
  }
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

const getExchangeRate: RequestHandler = async (req, res) => {
  const { from, to, date } = req.query as Record<string, string>;

  if (!from || !to || !date) {
    res.status(400).json({ error: 'Missing required query params: from, to, date' });
    return;
  }

  const sqlite = getSqlite(req);
  let rate = getRate(sqlite, from, to, date);

  // FX cache lazy-fill is allowed for demo too: vf_exchange_rate is sidecar
  // reference data, not portfolio narrative. The "demo pristine" guard belongs
  // on fetch-all (mutates latest_price + price for all securities), not here.
  if (rate === null) {
    const key = `${from}|${to}`;
    let pending = pairInFlight.get(key);
    if (!pending) {
      pending = fetchSinglePairOnDemand(sqlite, from, to)
        .finally(() => pairInFlight.delete(key));
      pairInFlight.set(key, pending);
    }
    await pending;
    rate = getRate(sqlite, from, to, date);
  }

  if (rate === null) {
    res.status(404).json({ error: `No rate found for ${from}/${to} on ${date}` });
    return;
  }

  res.json({ from, to, date, rate: rate.toString() });
};

pricesRouter.post('/fetch-all', fetchAll);
pricesRouter.get('/exchange-rates', getExchangeRate);
