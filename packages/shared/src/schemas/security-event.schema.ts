import { z } from 'zod';
import { SecurityEventType } from '../enums';

export const createSecurityEventSchema = z.object({
  securityId: z.string().uuid(),
  type: z.nativeEnum(SecurityEventType),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
  details: z.string().default('{}'),
}).superRefine((data, ctx) => {
  // STOCK_SPLIT details must be valid JSON.
  // TODO: enforce a typed ratio field (e.g. "10:1" string or positive number) once
  //       all callers are known to supply it consistently.
  if (data.type === SecurityEventType.STOCK_SPLIT) {
    try {
      JSON.parse(data.details);
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'details must be valid JSON for STOCK_SPLIT events',
        path: ['details'],
      });
    }
  }
});

export type CreateSecurityEventInput = z.infer<typeof createSecurityEventSchema>;
