import { Router, type Router as RouterType, type RequestHandler } from 'express';
import { paymentBreakdownRequestSchema, paymentsQuerySchema } from '@quovibe/shared';
import { getStatementOfAssets } from '../services/performance.service';
import { getSqlite } from '../helpers/request';
import { DATE_REGEX } from '../middleware/reporting-period';
import {
  getHoldingsFlat,
  getHoldingsByTaxonomy,
  getPayments,
  getPaymentBreakdown,
} from '../services/reports.service';

function resolveDate(value: unknown, fallback: string): string {
  return typeof value === 'string' && DATE_REGEX.test(value) ? value : fallback;
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

export const reportsRouter: RouterType = Router();

// GET /api/reports/statement-of-assets?date=YYYY-MM-DD
const statementOfAssetsHandler: RequestHandler = (req, res) => {
  const sqlite = getSqlite(req);
  const date = resolveDate(req.query.date, todayStr());
  res.json(getStatementOfAssets(sqlite, date));
};

// GET /api/reports/holdings?date=YYYY-MM-DD&taxonomy=<uuid>
const holdingsHandler: RequestHandler = (req, res) => {
  const sqlite = getSqlite(req);
  const date = resolveDate(req.query.date, todayStr());
  const taxonomyId = req.query.taxonomy as string | undefined;

  if (!taxonomyId) {
    res.json(getHoldingsFlat(sqlite, date));
    return;
  }

  res.json(getHoldingsByTaxonomy(sqlite, date, taxonomyId));
};

// GET /api/reports/payments?periodStart=&periodEnd=&groupBy=month|quarter|year
const paymentsHandler: RequestHandler = (req, res) => {
  const sqlite = getSqlite(req);
  const period = req.reportingPeriod;
  const parsed = paymentsQuerySchema.safeParse(req.query);
  const groupBy = parsed.success ? parsed.data.groupBy : 'month';

  res.json(getPayments(sqlite, period.start, period.end, groupBy));
};

const breakdownHandler: RequestHandler = async (req, res) => {
  const sqlite = getSqlite(req);
  const period = req.reportingPeriod;

  const parsed = paymentBreakdownRequestSchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid params', details: parsed.error.flatten() });
    return;
  }
  const { bucket, groupBy, type } = parsed.data;

  res.json(getPaymentBreakdown(sqlite, period.start, period.end, bucket, groupBy, type));
};

reportsRouter.get('/statement-of-assets', statementOfAssetsHandler);
reportsRouter.get('/holdings', holdingsHandler);
reportsRouter.get('/payments/breakdown', breakdownHandler);
reportsRouter.get('/payments', paymentsHandler);
