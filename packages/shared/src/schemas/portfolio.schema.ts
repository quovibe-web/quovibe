import { z } from 'zod';
import { nonBlankString, currencyCode } from './utils';

// Wire-contract schemas for portfolio creation + legacy-portfolio setup.
// Bound to HTTP:
//   createPortfolioSchema → POST /api/portfolios
//   setupPortfolioSchema  → POST /api/p/:pid/setup
//
// The server-internal type `CreatePortfolioInput` in packages/api/src/services/
// portfolio-manager.ts is intentionally a SUPERSET of this schema (it also
// carries the `import-pp-xml` branch, which flows through /api/import/xml and
// never hits this wire contract). Keep the distinction: shared = HTTP bodies,
// service = internal call shape.

const accountName = nonBlankString(128);

const depositInput = z.object({
  name: accountName,
  currency: currencyCode,
}).strict();

// Primary deposit inherits the portfolio's baseCurrency — no `currency` field here.
const primaryDepositInput = z.object({
  name: accountName,
}).strict();

const freshPayload = z.object({
  source: z.literal('fresh'),
  name: nonBlankString(200),
  baseCurrency: currencyCode,
  securitiesAccountName: accountName,
  primaryDeposit: primaryDepositInput,
  extraDeposits: z.array(depositInput).max(16).default([]),
}).strict();

export const createPortfolioSchema = z.discriminatedUnion('source', [
  freshPayload,
  z.object({ source: z.literal('demo') }).strict(),
  z.object({ source: z.literal('import-quovibe-db') }).strict(),
]);

export const setupPortfolioSchema = z.object({
  baseCurrency: currencyCode,
  securitiesAccountName: accountName,
  primaryDeposit: primaryDepositInput,
  extraDeposits: z.array(depositInput).max(16).default([]),
}).strict();

export type CreatePortfolioInput = z.infer<typeof createPortfolioSchema>;
export type SetupPortfolioInput = z.infer<typeof setupPortfolioSchema>;
export type FreshPortfolioInput = Extract<CreatePortfolioInput, { source: 'fresh' }>;
