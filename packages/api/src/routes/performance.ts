import { Router, type Router as RouterType, type RequestHandler } from 'express';
import { subDays, parseISO, format } from 'date-fns';
import { CostMethod, dataSeriesValueSchema } from '@quovibe/shared';
import {
  getPortfolioCalc,
  buildCalcScope,
  getSecurityPerformanceList,
  getChartData,
  getReturnsHeatmap,
  resolveInterval,
  getSecurityTtwrorSeries,

} from '../services/performance.service';
import { getTaxonomySeriesPerformance } from '../services/taxonomy-performance.service';
import { resolveDataSeries, resolveDataSeriesLabel, DataSeriesNotFoundError } from '../services/data-series.service';
import { getBenchmarkSeries } from '../services/benchmark.service';
import { getMovers } from '../services/movers.service';
import { getSqlite } from '../helpers/request';

function parseCostMethod(value: unknown): CostMethod {
  if (value === 'FIFO') return CostMethod.FIFO;
  if (value === 'MOVING_AVERAGE') return CostMethod.MOVING_AVERAGE;
  return CostMethod.MOVING_AVERAGE; // default: PMC (standard in Italy and continental Europe)
}

function parsePreTax(value: unknown): boolean {
  return value !== 'false';
}

/** Parse data-series scope query params (filter, withReference, taxonomyId, categoryId). */
function parseScopeFromQuery(req: Parameters<RequestHandler>[0], sqlite: ReturnType<typeof getSqlite>) {
  const filter = req.query.filter as string | undefined;
  const withRefParam = req.query.withReference as string | undefined;
  const taxonomyId = req.query.taxonomyId as string | undefined;
  const categoryId = req.query.categoryId as string | undefined;
  return buildCalcScope(
    sqlite,
    filter,
    withRefParam !== undefined ? withRefParam === 'true' : undefined,
    taxonomyId,
    categoryId,
  );
}

export const performanceRouter: RouterType = Router();

const calculationHandler: RequestHandler = (req, res) => {
  const sqlite = getSqlite(req);
  const period = req.reportingPeriod;
  const costMethod = parseCostMethod(req.query.costMethod);
  const preTax = parsePreTax(req.query.preTax);
  const scope = parseScopeFromQuery(req, sqlite);

  const result = getPortfolioCalc(sqlite, period, costMethod, preTax, true, scope);

  const lastDayStart = format(subDays(parseISO(period.end), 1), 'yyyy-MM-dd');
  const lastDayResult = getPortfolioCalc(sqlite, { start: lastDayStart, end: period.end }, costMethod, preTax, false, scope);

  res.json({
    ...result,
    lastDayAbsoluteChange: lastDayResult.absoluteChange,
    lastDayDeltaValue: lastDayResult.deltaValue,
    lastDayDelta: lastDayResult.delta,
    lastDayAbsolutePerformance: lastDayResult.absolutePerformance,
  });
};

const securitiesHandler: RequestHandler = (req, res) => {
  const sqlite = getSqlite(req);
  const period = req.reportingPeriod;
  const costMethod = parseCostMethod(req.query.costMethod);
  const preTax = parsePreTax(req.query.preTax);

  const result = getSecurityPerformanceList(sqlite, period, costMethod, preTax);
  res.json(result);
};

const chartHandler: RequestHandler = (req, res) => {
  const sqlite = getSqlite(req);
  const period = req.reportingPeriod;
  const requestedInterval = (req.query.interval as string) ?? 'auto';
  const interval = resolveInterval(period.start, period.end, requestedInterval);

  const scope = parseScopeFromQuery(req, sqlite);

  // Read global calendar setting
  const calRow = sqlite.prepare(
    `SELECT value FROM property WHERE name = 'portfolio.calendar'`
  ).get() as { value: string } | undefined;
  const calendarId = calRow?.value ?? 'default';

  const result = getChartData(sqlite, period, interval, calendarId, scope);
  res.json(result);
};

const returnsHandler: RequestHandler = (req, res) => {
  const sqlite = getSqlite(req);
  const scope = parseScopeFromQuery(req, sqlite);
  const period = req.reportingPeriod;
  const hasPeriodParams = typeof req.query.periodStart === 'string' && typeof req.query.periodEnd === 'string';
  const result = getReturnsHeatmap(sqlite, scope, hasPeriodParams ? period : undefined);
  res.json(result);
};

const taxonomySeriesHandler: RequestHandler = (req, res) => {
  const sqlite = getSqlite(req);
  const period = req.reportingPeriod;
  const taxonomyId = req.query.taxonomyId as string | undefined;
  const categoryIdsRaw = req.query.categoryIds as string | undefined;
  const costMethod = parseCostMethod(req.query.costMethod);
  const preTax = parsePreTax(req.query.preTax);
  const requestedInterval = (req.query.interval as string) ?? 'auto';

  if (!taxonomyId || !categoryIdsRaw) {
    res.status(400).json({ error: 'taxonomyId and categoryIds are required' });
    return;
  }

  const categoryIds = categoryIdsRaw.split(',').filter(Boolean).slice(0, 10);
  if (categoryIds.length === 0) {
    res.status(400).json({ error: 'categoryIds must contain at least one valid UUID' });
    return;
  }

  // Read global calendar setting
  const calRow = sqlite.prepare(
    `SELECT value FROM property WHERE name = 'portfolio.calendar'`
  ).get() as { value: string } | undefined;
  const calendarId = calRow?.value ?? 'default';

  const result = getTaxonomySeriesPerformance(
    sqlite, taxonomyId, categoryIds, period, costMethod, preTax, requestedInterval, calendarId,
  );
  res.json(result);
};

const resolveSeriesHandler: RequestHandler = (req, res) => {
  const sqlite = getSqlite(req);
  const parsed = dataSeriesValueSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid data series value', details: parsed.error.flatten() });
    return;
  }
  try {
    const params = resolveDataSeries(sqlite, parsed.data);
    const label = resolveDataSeriesLabel(sqlite, parsed.data);
    res.json({ label, params });
  } catch (err) {
    if (err instanceof DataSeriesNotFoundError) {
      res.status(404).json({ error: err.message });
      return;
    }
    throw err;
  }
};

const benchmarkSeriesHandler: RequestHandler = (req, res) => {
  const sqlite = getSqlite(req);
  const period = req.reportingPeriod;
  const securityIdsRaw = req.query.securityIds as string | undefined;
  const requestedInterval = (req.query.interval as string) ?? 'auto';
  const interval = resolveInterval(period.start, period.end, requestedInterval);

  if (!securityIdsRaw) {
    res.status(400).json({ error: 'securityIds query parameter is required' });
    return;
  }

  const securityIds = securityIdsRaw.split(',').filter(Boolean);
  if (securityIds.length === 0) {
    res.status(400).json({ error: 'securityIds must contain at least one UUID' });
    return;
  }

  if (securityIds.length > 5) {
    res.status(400).json({ error: 'Maximum 5 benchmarks allowed' });
    return;
  }

  // Read global calendar setting (same as chartHandler) so benchmark sampling aligns
  const calRow = sqlite.prepare(
    `SELECT value FROM property WHERE name = 'portfolio.calendar'`
  ).get() as { value: string } | undefined;
  const calendarId = calRow?.value ?? 'default';

  const benchmarks = getBenchmarkSeries(sqlite, securityIds, period, interval, calendarId);
  res.json({ benchmarks });
};

const securitySeriesHandler: RequestHandler = (req, res) => {
  const sqlite = getSqlite(req);
  const period = req.reportingPeriod;
  const securityId = req.query.securityId as string | undefined;
  const requestedInterval = (req.query.interval as string) ?? 'auto';
  const interval = resolveInterval(period.start, period.end, requestedInterval);
  const costMethod = parseCostMethod(req.query.costMethod);
  const preTax = parsePreTax(req.query.preTax);

  if (!securityId) {
    res.status(400).json({ error: 'securityId query parameter is required' });
    return;
  }

  const calRow = sqlite.prepare(
    `SELECT value FROM property WHERE name = 'portfolio.calendar'`
  ).get() as { value: string } | undefined;
  const calendarId = calRow?.value ?? 'default';

  const result = getSecurityTtwrorSeries(sqlite, securityId, period, interval, calendarId, costMethod, preTax);

  if (!result) {
    res.status(404).json({ error: 'Security not found' });
    return;
  }

  res.json(result);
};

const moversHandler: RequestHandler = (req, res) => {
  const sqlite = getSqlite(req);
  const period = req.reportingPeriod;
  const costMethod = parseCostMethod(req.query.costMethod);
  const preTax = parsePreTax(req.query.preTax);
  const scope = parseScopeFromQuery(req, sqlite);

  const countParam = typeof req.query.count === 'string' ? parseInt(req.query.count, 10) : 3;
  const count = Number.isFinite(countParam) && countParam > 0 ? countParam : 3;

  const result = getMovers(sqlite, period, count, costMethod, preTax, scope);
  res.json(result);
};

performanceRouter.get('/calculation', calculationHandler);
performanceRouter.get('/securities', securitiesHandler);
performanceRouter.get('/chart', chartHandler);
performanceRouter.get('/returns', returnsHandler);
performanceRouter.get('/taxonomy-series', taxonomySeriesHandler);
performanceRouter.post('/resolve-series', resolveSeriesHandler);
performanceRouter.get('/benchmark-series', benchmarkSeriesHandler);
performanceRouter.get('/security-series', securitySeriesHandler);

performanceRouter.get('/movers', moversHandler);
