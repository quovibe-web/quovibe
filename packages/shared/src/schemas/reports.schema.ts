import { z } from 'zod';

export const paymentBreakdownRequestSchema = z.object({
  bucket: z.string().min(1),
  groupBy: z.enum(['month', 'quarter', 'year']),
  type: z.enum(['DIVIDEND', 'INTEREST']),
});
export type PaymentBreakdownRequest = z.infer<typeof paymentBreakdownRequestSchema>;

export const paymentBreakdownItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  grossAmount: z.string(),
  netAmount: z.string(),
  taxes: z.string(),
  fees: z.string(),
  count: z.number().int(),
  currencyCode: z.string().nullable(),
});
export type PaymentBreakdownItem = z.infer<typeof paymentBreakdownItemSchema>;

export const paymentBreakdownResponseSchema = z.object({
  bucket: z.string(),
  type: z.enum(['DIVIDEND', 'INTEREST']),
  items: z.array(paymentBreakdownItemSchema),
  totalGross: z.string(),
  totalNet: z.string(),
});
export type PaymentBreakdownResponse = z.infer<typeof paymentBreakdownResponseSchema>;

export const paymentsQuerySchema = z.object({
  groupBy: z.enum(['month', 'quarter', 'year']).default('month'),
});
export type PaymentsQuery = z.infer<typeof paymentsQuerySchema>;
