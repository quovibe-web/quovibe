import { Router, type RequestHandler, type Router as RouterType } from 'express';
import type BetterSqlite3 from 'better-sqlite3';
import { convertPriceFromDb } from '../services/unit-conversion';

export const debugRouter: RouterType = Router();

debugRouter.get('/db-sample', (async (req, res) => {
  const sqlite = req.app.locals.sqlite as BetterSqlite3.Database;

  const xacts = sqlite
    .prepare(`SELECT uuid, type, date, currency, amount, shares FROM xact LIMIT 5`)
    .all();

  const xactUnits = sqlite
    .prepare(`SELECT xact, type, amount FROM xact_unit LIMIT 5`)
    .all();

  const prices = sqlite
    .prepare(`SELECT security, tstamp, value FROM price ORDER BY tstamp DESC LIMIT 5`)
    .all();

  const latestPrices = sqlite
    .prepare(`SELECT security, tstamp, value FROM latest_price LIMIT 5`)
    .all();

  const firstPrice = prices[0] as { value: number } | undefined;
  res.json({
    note: 'Raw DB values — shares÷10^8, prices÷10^8, amounts÷100 (expected)',
    xacts,
    xactUnits,
    prices,
    latestPrices,
    derived: {
      firstXact_amount_raw: (xacts[0] as { amount: number } | undefined)?.amount,
      firstXact_shares_raw: (xacts[0] as { shares: number } | undefined)?.shares,
      firstXact_shares_converted: xacts[0]
        ? ((xacts[0] as { shares: number }).shares / 1e9).toFixed(6)
        : null,
      firstPrice_raw: firstPrice?.value,
      firstPrice_converted: firstPrice
        ? convertPriceFromDb({ close: firstPrice.value }).close.toFixed(6)
        : null,
    },
  });
}) as RequestHandler);
