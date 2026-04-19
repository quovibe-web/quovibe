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
//
// The `POST /setup` route (Task 2.5) will live alongside this once it lands.
import { Router, type RequestHandler, type Router as RouterType } from 'express';
import { listSecuritiesAccounts } from '../services/accounts.service';
import { getSqlite } from '../helpers/request';

export const setupRouter: RouterType = Router({ mergeParams: true });

const listRoute: RequestHandler = (req, res) => {
  const sqlite = getSqlite(req);
  res.json(listSecuritiesAccounts(sqlite));
};

setupRouter.get('/securities-accounts', listRoute);
