// packages/api/src/routes/setup.ts
//
// Portfolio setup / inner-account discovery routes (BUG-54/55 Phase 2).
//
// This router hosts thin endpoints that the client uses to inspect or
// initialize a portfolio's inner shape (the `account` table on the
// per-portfolio DB). It is mounted at `/api/p/:portfolioId` so it shares the
// same `portfolioContext` middleware as the other portfolio-scoped routers.
//
// Currently exposes:
//   GET  /securities-accounts — lists active securities accounts (drives the
//                               CSV-wizard picker and PortfolioLayout N=0
//                               redirect)
//   POST /setup                — initializes the M3 default account layout for
//                               a legacy N=0 portfolio (Task 2.5)
//
// REQUIREMENT: must be mounted under the `portfolioContext` middleware so
// `getSqlite(req)` resolves. Mounting elsewhere will 500 at the first request.
//
// `mergeParams: true` is kept so the POST handler can read
// `req.params.portfolioId` directly.
import { Router, type RequestHandler, type Router as RouterType } from 'express';
import { setupPortfolioSchema } from '@quovibe/shared';
import { listSecuritiesAccounts, AccountServiceError } from '../services/accounts.service';
import { setupPortfolio, PortfolioManagerError } from '../services/portfolio-manager';
import { getSqlite, getPortfolioId } from '../helpers/request';

export const setupRouter: RouterType = Router({ mergeParams: true });

const listRoute: RequestHandler = (req, res) => {
  const sqlite = getSqlite(req);
  res.json(listSecuritiesAccounts(sqlite));
};

const postSetup: RequestHandler = (req, res) => {
  const parsed = setupPortfolioSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'INVALID_INPUT', details: parsed.error.format() });
    return;
  }
  try {
    setupPortfolio(getPortfolioId(req), parsed.data);
    res.status(200).json({ ok: true });
  } catch (err) {
    if (err instanceof PortfolioManagerError) {
      const status = err.code === 'ALREADY_SETUP' ? 409
                   : err.code === 'PORTFOLIO_NOT_FOUND' ? 404
                   : 400;
      res.status(status).json({ error: err.code });
      return;
    }
    if (err instanceof AccountServiceError && err.code === 'DUPLICATE_NAME') {
      // Symmetric with portfolios.ts postCreate and accounts.ts — DUPLICATE_NAME
      // surfaces as 409 wherever a route hits the seeding/insert surface
      // (`.claude/rules/api.md`).
      res.status(409).json({ error: err.code });
      return;
    }
    throw err;
  }
};

setupRouter.get('/securities-accounts', listRoute);
setupRouter.post('/setup', postSetup);
