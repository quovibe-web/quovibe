// packages/api/src/create-app.ts
import express, { type Express, type RequestHandler, type ErrorRequestHandler } from 'express';
import cors from 'cors';
import { reportingPeriodMiddleware } from './middleware/reporting-period';
import { errorHandler } from './middleware/error-handler';
import { portfolioContext } from './middleware/portfolio-context';
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
import { calendarsRouter } from './routes/calendars';
import { attributeTypesRouter } from './routes/attribute-types';
import { taxonomyWriteRouter } from './routes/taxonomy-write';
import { settingsRouter } from './routes/settings';
import { dashboardRouter } from './routes/dashboard';
import { csvImportRouter } from './routes/csv-import';
import { watchlistsRouter } from './routes/watchlists';
import { logoRouter } from './routes/logo';
import { importRouter } from './routes/import';
import { portfoliosRouter } from './routes/portfolios';
import { eventsRouter } from './routes/events';

/**
 * Build the Express app. In ADR-015 the server carries no global DB handle —
 * per-request portfolio resolution happens in `portfolioContext` middleware
 * mounted at `/api/p/:portfolioId`.
 */
export function createApp(): Express {
  const app = express();

  app.use(express.json({ limit: '10mb' }));
  app.use(cors());

  app.use(reportingPeriodMiddleware as RequestHandler);

  app.get('/api', (_req, res) => {
    res.json({
      status: 'ok',
      portfolioScoped: '/api/p/:portfolioId/*',
      registry: '/api/portfolios',
      events: '/api/events',
    });
  });

  // --- cross-portfolio endpoints -----------------------------------------
  app.use('/api/portfolios', portfoliosRouter);
  app.use('/api/events', eventsRouter);
  app.use('/api/settings', settingsRouter);
  app.use('/api/logo', logoRouter);
  app.use('/api/import', importRouter);          // legacy-style XML upload; see Task 3c.10

  // --- portfolio-scoped endpoints, gated by portfolioContext ------------
  app.use('/api/p/:portfolioId', portfolioContext);
  app.use('/api/p/:portfolioId/accounts', accountsRouter);
  app.use('/api/p/:portfolioId/securities', securitiesRouter);
  app.use('/api/p/:portfolioId/transactions', transactionsRouter);
  app.use('/api/p/:portfolioId/portfolio', portfolioRouter);
  app.use('/api/p/:portfolioId/performance', performanceRouter);
  app.use('/api/p/:portfolioId/reports', reportsRouter);
  app.use('/api/p/:portfolioId/taxonomies', taxonomiesRouter);
  app.use('/api/p/:portfolioId/taxonomies', rebalancingRouter);
  app.use('/api/p/:portfolioId/taxonomies', taxonomyWriteRouter);
  app.use('/api/p/:portfolioId/prices', pricesRouter);
  app.use('/api/p/:portfolioId/securities/:securityId/events', securityEventsRouter);
  app.use('/api/p/:portfolioId/calendars', calendarsRouter);
  app.use('/api/p/:portfolioId/attribute-types', attributeTypesRouter);
  app.use('/api/p/:portfolioId/dashboards', dashboardRouter);
  app.use('/api/p/:portfolioId/csv-import', csvImportRouter);
  app.use('/api/p/:portfolioId/watchlists', watchlistsRouter);

  if (process.env.NODE_ENV !== 'production') {
    app.use('/api/p/:portfolioId/debug', debugRouter);
  }

  app.use(errorHandler as ErrorRequestHandler);

  return app;
}
