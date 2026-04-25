import { z } from 'zod';
import { nonBlankString } from './utils';

// Wire vocabulary uses ppxml2db DB literals: 'account' = deposit, 'portfolio' = securities.
// AccountType enum (DEPOSIT/SECURITIES) remains the internal vocabulary used by
// transaction-gating; it is NOT exposed on the wire (see plan: BUG-114).
export const createAccountSchema = z.object({
  name: nonBlankString(128),
  type: z.enum(['account', 'portfolio']),
  // Only deposit accounts own a currency; securities accounts inherit from referenceAccount.
  currency: z.string().length(3).optional(),
  referenceAccountId: z.string().uuid().optional(),
});

export const updateAccountSchema = createAccountSchema.partial().extend({
  isRetired: z.boolean().optional(),
});

export const accountResponseSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  // ppxml2db stores 'portfolio' (securities) and 'account' (deposit) — these are the raw DB values
  type: z.enum(['portfolio', 'account']),
  currency: z.string().nullable(),
  isRetired: z.boolean(),
  referenceAccountId: z.string().nullable(),
  balance: z.string(),
});

export const updateAccountLogoSchema = z.object({
  logoUrl: z.string().nullable(),
});

export type CreateAccountInput = z.infer<typeof createAccountSchema>;
export type UpdateAccountInput = z.infer<typeof updateAccountSchema>;
export type AccountResponse = z.infer<typeof accountResponseSchema>;
export type UpdateAccountLogoInput = z.infer<typeof updateAccountLogoSchema>;
