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

// PATCH /api/portfolios/:id — partial-update of registry-level fields.
// Both fields optional; an empty body is a valid 200 no-op.
export const patchPortfolioSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  lastOpenedAt: z.string().optional(),
});

export type PatchPortfolioInput = z.infer<typeof patchPortfolioSchema>;

// Wire-contract: server returns this shape on import-pp-xml + import-quovibe-db
// success. Computed via three COUNT queries at the portfolio-bootstrap site.
// `accounts` = deposit accounts (account.type='account'); securities-account
// rows are NOT counted here. `transactions` excludes the BUY/SELL cash-side
// row to match the user-visible transactions list filter
// (.claude/rules/double-entry.md "Per-account Query").
export const importSummarySchema = z.object({
  accounts:     z.number().int().nonnegative(),
  securities:   z.number().int().nonnegative(),
  transactions: z.number().int().nonnegative(),
}).strict();

export type ImportSummary = z.infer<typeof importSummarySchema>;
