import { z } from 'zod';

export const friendlyAttributeTypeEnum = z.enum([
  'TEXT', 'NUMBER', 'PERCENTAGE', 'AMOUNT', 'DATE', 'BOOLEAN',
]);

export type FriendlyAttributeType = z.infer<typeof friendlyAttributeTypeEnum>;

export const createAttributeTypeSchema = z
  .object({
    name: z.string().trim().min(1).max(64),
    columnLabel: z.string().trim().min(1).max(64).optional(),
    friendlyType: friendlyAttributeTypeEnum,
    target: z.literal('Security').optional(),
  })
  .strict();

export const updateAttributeTypeSchema = z
  .object({
    name: z.string().trim().min(1).max(64),
    columnLabel: z.string().trim().min(1).max(64).optional(),
  })
  .strict();

export type CreateAttributeTypeInput = z.infer<typeof createAttributeTypeSchema>;
export type UpdateAttributeTypeInput = z.infer<typeof updateAttributeTypeSchema>;
