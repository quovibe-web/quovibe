import { z } from 'zod';

const accountName = z.string().trim().min(1).max(128);
const currencyCode = z.string().trim().regex(/^[A-Z]{3}$/, 'ISO 4217 3-letter code');

const depositInput = z.object({
  name: accountName,
  currency: currencyCode,
}).strict();

const primaryDepositInput = z.object({
  name: accountName,
}).strict();

const freshPayload = z.object({
  source: z.literal('fresh'),
  name: z.string().min(1).max(200),
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

export type CreatePortfolioPayload = z.infer<typeof createPortfolioSchema>;
export type SetupPortfolioPayload = z.infer<typeof setupPortfolioSchema>;
export type FreshPortfolioPayload = Extract<CreatePortfolioPayload, { source: 'fresh' }>;
