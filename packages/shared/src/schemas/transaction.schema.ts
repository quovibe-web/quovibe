import { z } from 'zod';
import { TransactionType } from '../enums';

const SHARE_TYPES = new Set<TransactionType>([
  TransactionType.BUY, TransactionType.SELL,
  TransactionType.DELIVERY_INBOUND, TransactionType.DELIVERY_OUTBOUND,
  TransactionType.SECURITY_TRANSFER,
]);

const CASH_TYPES = new Set<TransactionType>([
  TransactionType.DEPOSIT, TransactionType.REMOVAL,
  TransactionType.DIVIDEND, TransactionType.INTEREST, TransactionType.INTEREST_CHARGE,
  TransactionType.FEES, TransactionType.FEES_REFUND,
  TransactionType.TAXES, TransactionType.TAX_REFUND,
]);

const CROSS_ACCOUNT_DISTINCT_TYPES = new Set<TransactionType>([
  TransactionType.TRANSFER_BETWEEN_ACCOUNTS,
  TransactionType.SECURITY_TRANSFER,
]);

export const createTransactionSchema = z.object({
  type: z.nativeEnum(TransactionType),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/, 'Date must be YYYY-MM-DD or YYYY-MM-DDTHH:mm'),
  amount: z.number().min(0),
  shares: z.number().positive().optional(),
  note: z.string().optional(),
  securityId: z.string().uuid().optional(),
  currencyCode: z.string().length(3).optional(),
  fees: z.number().min(0).optional(),
  taxes: z.number().min(0).optional(),
  accountId: z.string().uuid(),
  crossAccountId: z.string().uuid().optional(),
  fxRate: z.number().positive().optional(),
  fxCurrencyCode: z.string().length(3).optional(),
  feesFx: z.number().min(0).optional(),
  taxesFx: z.number().min(0).optional(),
}).superRefine((data, ctx) => {
  if (SHARE_TYPES.has(data.type) && (data.shares == null || data.shares <= 0)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'shares is required and must be positive for this transaction type',
      path: ['shares'],
    });
  }
  if (CASH_TYPES.has(data.type) && data.amount === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'amount must be greater than 0 for this transaction type',
      path: ['amount'],
    });
  }
  // BUG-01: transfer types must specify two distinct accounts. When
  // crossAccountId is missing the service layer already raises a clearer
  // "crossAccountId is required" error, so only assert distinctness when both
  // are present.
  if (
    CROSS_ACCOUNT_DISTINCT_TYPES.has(data.type) &&
    data.accountId &&
    data.crossAccountId &&
    data.accountId === data.crossAccountId
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Source and destination accounts must differ',
      path: ['crossAccountId'],
    });
  }
});

const transactionUnitSchema = z.object({
  type: z.string(),
  amount: z.number().nullable(),
});

export const transactionResponseSchema = z.object({
  uuid: z.string().uuid(),
  type: z.string(),  // normalized TransactionType string
  date: z.string(),
  amount: z.number().nullable(),
  shares: z.number().nullable(),
  note: z.string().nullable(),
  security: z.string().nullable(),  // raw security UUID
  securityName: z.string().nullable().optional(),
  account: z.string().nullable(),
  accountName: z.string().nullable().optional(),
  currency: z.string().nullable(),
  source: z.string().nullable(),
  fees: z.number(),
  taxes: z.number(),
  crossAccountId: z.string().nullable().optional(),
  direction: z.enum(['inbound', 'outbound']).nullable().optional(),
  units: z.array(transactionUnitSchema).optional(),
});

export type CreateTransactionInput = z.infer<typeof createTransactionSchema>;
export type TransactionResponse = z.infer<typeof transactionResponseSchema>;
