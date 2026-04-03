import express, { type Express, type RequestHandler, type ErrorRequestHandler } from 'express';
import cors from 'cors';
import type BetterSqlite3 from 'better-sqlite3';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { reportingPeriodMiddleware } from './middleware/reporting-period';
import { errorHandler } from './middleware/error-handler';
import { accountsRouter } from './routes/accounts';
import { securitiesRouter } from './routes/securities';
import { transactionsRouter } from './routes/transactions';
import { portfolioRouter } from './routes/portfolio';
import { performanceRouter } from './routes/performance';
import { reportsRouter } from './routes/reports';
import { taxonomiesRouter } from './routes/taxonomies';
import { rebalancingRouter } from './routes/rebalancing';
import { pricesRouter } from './routes/prices';
import { debugRouter } from './routes/debug';
import { securityEventsRouter } from './routes/security-events';
import { importRouter } from './routes/import';
import { calendarsRouter } from './routes/calendars';
import { attributeTypesRouter } from './routes/attribute-types';
import { taxonomyWriteRouter } from './routes/taxonomy-write';
import { settingsRouter } from './routes/settings';
import { dashboardRouter } from './routes/dashboard';
import { csvImportRouter } from './routes/csv-import';
import { watchlistsRouter } from './routes/watchlists';

export function createApp(
  db: BetterSQLite3Database<Record<string, unknown>>,
  sqlite: BetterSqlite3.Database,
): Express {
  const app = express();

  app.use(express.json({ limit: '10mb' }));
  app.use(cors());

  // Attach db instances to app.locals for access in routes/services
  app.locals.db = db;
  app.locals.sqlite = sqlite;

  app.use(reportingPeriodMiddleware as RequestHandler);

  app.get('/api', (_req, res) => {
    res.json({
      status: 'ok',
      endpoints: {
        accounts:     'GET|POST /api/accounts, GET|PUT|DELETE /api/accounts/:id, GET /api/accounts/:id/transactions',
        securities:   'GET|POST /api/securities, GET|PUT /api/securities/:id, PUT /api/securities/:id/prices/fetch, POST /api/securities/:id/prices/test-fetch, PUT /api/securities/:id/feed-config',
        events:       'GET|POST /api/securities/:securityId/events, DELETE /api/securities/:securityId/events/:eventId',
        transactions: 'GET|POST /api/transactions, PUT|DELETE /api/transactions/:id, GET /api/transactions/first-date',
        portfolio:    'GET /api/portfolio, PUT /api/portfolio/settings, GET /api/portfolio/export',
        performance:  'GET /api/performance/calculation|securities|chart|returns|taxonomy-series',
        reports:      'GET /api/reports/statement-of-assets|holdings|dividends',
        taxonomies:   'GET /api/taxonomies, GET /api/taxonomies/:id, GET /api/taxonomies/:id/rebalancing',
        prices:       'POST /api/prices/fetch-all, GET /api/prices/exchange-rates',
        calendars:    'GET /api/calendars, GET /api/calendars/:id/holidays',
        import:       'POST /api/import/xml, GET /api/import/status',
        csvImport:    'POST /api/import/csv/trades/parse|preview|execute, POST /api/import/csv/prices/parse|execute, GET|POST|PUT|DELETE /api/import/csv/configs',
        attributeTypes: 'GET /api/attribute-types',
        settings:   'GET|POST|PUT /api/settings/reporting-periods, DELETE /api/settings/reporting-periods/:index',
        dashboard: 'GET|PUT /api/dashboard',
        watchlists: 'GET|POST /api/watchlists, PUT|DELETE /api/watchlists/:id, POST /api/watchlists/:id/duplicate, PUT /api/watchlists/reorder, POST|DELETE /api/watchlists/:id/securities, PUT /api/watchlists/:id/securities/reorder',
      },
    });
  });

  app.use('/api/accounts', accountsRouter);
  app.use('/api/securities', securitiesRouter);
  app.use('/api/transactions', transactionsRouter);
  app.use('/api/portfolio', portfolioRouter);
  app.use('/api/performance', performanceRouter);
  app.use('/api/reports', reportsRouter);
  app.use('/api/taxonomies', taxonomiesRouter);
  app.use('/api/taxonomies', rebalancingRouter);
  app.use('/api/taxonomies', taxonomyWriteRouter); // MUST be after taxonomiesRouter
  app.use('/api/prices', pricesRouter);
  app.use('/api/securities/:securityId/events', securityEventsRouter);
  app.use('/api/calendars', calendarsRouter);
  app.use('/api/attribute-types', attributeTypesRouter);
  if (process.env.NODE_ENV !== 'production') {
    app.use('/api/debug', debugRouter);
  }
  app.use('/api/import', importRouter);
  app.use('/api/import/csv', csvImportRouter);
  app.use('/api/settings', settingsRouter);
  app.use('/api/dashboard', dashboardRouter);
  app.use('/api/watchlists', watchlistsRouter);

  // Error handler must be last
  app.use(errorHandler as ErrorRequestHandler);

  return app;
}
