import { z } from 'zod';

export const createWatchlistSchema = z.object({
  name: z.string().min(1).max(100),
});

export const updateWatchlistSchema = z.object({
  name: z.string().min(1).max(100).optional(),
});

export const addWatchlistSecuritySchema = z.object({
  securityId: z.string().uuid(),
});

export const reorderWatchlistsSchema = z.object({
  ids: z.array(z.number().int()),
});

export const reorderWatchlistSecuritiesSchema = z.object({
  securityIds: z.array(z.string()),
});

export type CreateWatchlistInput = z.infer<typeof createWatchlistSchema>;
export type UpdateWatchlistInput = z.infer<typeof updateWatchlistSchema>;
export type AddWatchlistSecurityInput = z.infer<typeof addWatchlistSecuritySchema>;
export type ReorderWatchlistsInput = z.infer<typeof reorderWatchlistsSchema>;
export type ReorderWatchlistSecuritiesInput = z.infer<typeof reorderWatchlistSecuritiesSchema>;
