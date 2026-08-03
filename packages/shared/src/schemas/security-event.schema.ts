import { z } from 'zod';
import { SecurityEventType } from '../enums';
import { parseSplitRatio } from '../split/pp-split';

export const createSecurityEventSchema = z.object({
  securityId: z.string().uuid(),
  type: z.nativeEnum(SecurityEventType),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
  details: z.string().default('{}'),
}).superRefine((data, ctx) => {
  // Split details are stored in the plain `new:old` ratio form. Rows written
  // before splits were implemented carry a JSON object instead, so both shapes
  // are accepted on the wire; readers try the ratio first and fall back.
  if (data.type === SecurityEventType.STOCK_SPLIT) {
    if (parseSplitRatio(data.details)) return;
    try {
      JSON.parse(data.details);
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'details must be a "new:old" ratio or valid JSON for STOCK_SPLIT events',
        path: ['details'],
      });
    }
  }
});

export type CreateSecurityEventInput = z.infer<typeof createSecurityEventSchema>;
