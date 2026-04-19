// packages/api/src/__tests__/_helpers/portfolio-fixtures.ts
//
// Shared portfolio-DB fixtures for tests in Phase 1+ of the BUG-54/55 plan
// (docs/superpowers/plans/2026-04-19-portfolio-account-wiring.md).
//
// IMPORTANT — import-timing contract:
// `config.ts` reads `process.env.QUOVIBE_DATA_DIR` at module-load. Test files
// MUST set that env var (and any related ones, e.g. `QUOVIBE_DEMO_SOURCE`) at
// the module top BEFORE importing this helper. To avoid hoisting issues, every
// helper here uses dynamic `await import(...)` for the api modules so the env
// is guaranteed to be in place by the time the imports resolve. See the
// pattern already used by csv-upload-hardening.test.ts.
import crypto from 'crypto';
import request from 'supertest';
import type { Express } from 'express';

/**
 * Boot a fresh Express app via the standard `createApp` factory, after running
 * the same one-time bootstrap steps used by other supertest-based tests
 * (loadSettings + boot-recovery). Returns a freshly-built Express instance.
 */
async function buildApp(): Promise<Express> {
  const { createApp } = await import('../../create-app');
  const { loadSettings } = await import('../../services/settings.service');
  const { recoverFromInterruptedSwap } = await import('../../services/boot-recovery');
  // Ensure the registry module is loaded so resolveEntry is wired into the pool.
  await import('../../services/portfolio-registry');
  loadSettings();
  recoverFromInterruptedSwap();
  return createApp();
}

/**
 * Create a fresh empty portfolio via `createPortfolio({source:'fresh', name})`
 * and return its outer metadata id alongside a freshly-built Express app.
 *
 * NOTE: the richer `createPortfolio` payload from the plan
 * (`baseCurrency / securitiesAccountName / primaryDeposit / extraDeposits`)
 * is a Phase 2 addition and does not yet exist in this codebase. Callers that
 * need pre-seeded `account` rows must INSERT them directly via
 * `acquirePortfolioDb` (see `seedPortfolioWith2SecuritiesAccounts`).
 */
export async function seedFreshPortfolio(): Promise<{ portfolioId: string; app: Express }> {
  const app = await buildApp();
  const { createPortfolio } = await import('../../services/portfolio-manager');
  const { entry } = await createPortfolio({
    source: 'fresh',
    name: `Fresh-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, // native-ok
  });
  return { portfolioId: entry.id, app };
}

/**
 * Simulate the pre-fix "legacy" state: a portfolio whose inner DB has zero
 * rows in `account`. Implemented by creating a fresh portfolio (which already
 * has zero account rows in the current codebase) and then running an explicit
 * DELETE to make the intent unambiguous and forward-compatible with Phase 2,
 * which will start auto-seeding default account rows.
 */
export async function seedLegacyFreshPortfolio(): Promise<{ portfolioId: string; app: Express }> {
  const { portfolioId, app } = await seedFreshPortfolio();
  const { acquirePortfolioDb, releasePortfolioDb } = await import('../../services/portfolio-db-pool');
  const { sqlite } = acquirePortfolioDb(portfolioId);
  try {
    sqlite.prepare('DELETE FROM account').run();
  } finally {
    releasePortfolioDb(portfolioId);
  }
  return { portfolioId, app };
}

/**
 * Create a portfolio whose inner DB has TWO `type='portfolio'` rows (two
 * securities accounts, mimicking the Demo's IB+Scalable shape) sharing a
 * single deposit account. The two securities-account UUIDs are random and
 * NEVER equal to the outer metadata `portfolioId` — that mismatch is exactly
 * what BUG-55 exposes when the wire field is treated as the outer id.
 */
export async function seedPortfolioWith2SecuritiesAccounts(): Promise<{ portfolioId: string; app: Express }> {
  const { portfolioId, app } = await seedFreshPortfolio();
  const { acquirePortfolioDb, releasePortfolioDb } = await import('../../services/portfolio-db-pool');
  const { sqlite } = acquirePortfolioDb(portfolioId);
  try {
    sqlite.prepare('DELETE FROM account').run();
    const now = new Date().toISOString();
    const dep1 = crypto.randomUUID();
    sqlite
      .prepare(
        `INSERT INTO account (uuid, type, name, currency, referenceAccount, updatedAt, _xmlid, _order, isRetired)
         VALUES (?, 'account', 'Shared Cash', 'EUR', NULL, ?, 1, 1, 0)`,
      )
      .run(dep1, now);
    const sec1 = crypto.randomUUID();
    const sec2 = crypto.randomUUID();
    sqlite
      .prepare(
        `INSERT INTO account (uuid, type, name, currency, referenceAccount, updatedAt, _xmlid, _order, isRetired)
         VALUES (?, 'portfolio', 'Broker A', NULL, ?, ?, 2, 2, 0)`,
      )
      .run(sec1, dep1, now);
    sqlite
      .prepare(
        `INSERT INTO account (uuid, type, name, currency, referenceAccount, updatedAt, _xmlid, _order, isRetired)
         VALUES (?, 'portfolio', 'Broker B', NULL, ?, ?, 3, 3, 0)`,
      )
      .run(sec2, dep1, now);
  } finally {
    releasePortfolioDb(portfolioId);
  }
  return { portfolioId, app };
}

/**
 * Stand up a multi-broker portfolio AND prime a tempFile for the CSV preview
 * step. Returns the outer metadata id and the tempFileId emitted by
 * `POST /api/p/:pid/csv-import/trades/parse`. Reuses the already-built `app`
 * so the test does not pay the boot cost twice.
 */
export async function seedMultiBrokerFixture(
  app: Express,
): Promise<{ portfolioId: string; tempFileId: string }> {
  const { portfolioId } = await seedPortfolioWith2SecuritiesAccounts();
  const csv = 'date,type,security,amount\n2026-01-01,BUY,TEST,100.00\n';
  const parseRes = await request(app)
    .post(`/api/p/${portfolioId}/csv-import/trades/parse`)
    .attach('file', Buffer.from(csv, 'utf8'), {
      filename: 'multi-broker.csv',
      contentType: 'text/csv',
    });
  if (parseRes.status !== 200 || typeof parseRes.body?.tempFileId !== 'string') {
    throw new Error(
      `seedMultiBrokerFixture: parse upload failed (status=${parseRes.status}, body=${JSON.stringify(parseRes.body)})`,
    );
  }
  return { portfolioId, tempFileId: parseRes.body.tempFileId as string };
}

/**
 * Client-test alias for `seedLegacyFreshPortfolio`, kept separate so tests
 * read clearly even if the implementations converge.
 */
export const createLegacyFreshPortfolio = async (
  opts: { name: string },
): Promise<{ entry: { id: string; name: string }; app: Express }> => {
  const { portfolioId, app } = await seedLegacyFreshPortfolio();
  return { entry: { id: portfolioId, name: opts.name }, app };
};
