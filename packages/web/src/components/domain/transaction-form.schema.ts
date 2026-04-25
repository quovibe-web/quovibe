import { z } from 'zod';
import {
  AMOUNT_REQUIRED_TYPES,
  CROSS_CURRENCY_FX_TYPES,
  SECURITY_REQUIRED_TYPES,
  TransactionType,
} from '@quovibe/shared';

// Date / time stay in local component state (calendar popover + locale parsing
// is heavy enough that keeping it outside RHF avoids re-renders on every
// keystroke). They are merged into the wire payload at submit time, not
// surfaced through the form schema.
export const transactionFormBaseSchema = z.object({
  type: z.nativeEnum(TransactionType),
  securityId: z.string().optional(),
  accountId: z.string(),
  crossAccountId: z.string().optional(),
  shares: z.string().optional(),
  amount: z.string().optional(),
  price: z.string().optional(),
  fees: z.string().optional(),
  taxes: z.string().optional(),
  fxRate: z.string().optional(),
  feesFx: z.string().optional(),
  taxesFx: z.string().optional(),
  note: z.string().optional(),
});

export type TransactionFormShape = z.infer<typeof transactionFormBaseSchema>;

// Caller contract:
// - `isCrossCurrency` MUST be derived from the resolved currencies of the
//   selected account / cross-account / security (e.g. for BUY/SELL: cash-side
//   account.currency vs security.currency; for TRANSFER_BETWEEN_ACCOUNTS:
//   source.currency vs dest.currency). Hardcoding `false` silently regresses
//   BUG-111 / BUG-112 client-side. The wire schema cannot enforce the cross-
//   currency gate (no DB access in @quovibe/shared); the route layer's
//   `enforceCrossCurrencyFxRate` is the server-side counterpart.
// - The `shows*` flags MUST mirror the FIELD_CONFIG entry for the active
//   transaction type — they tell the schema which fields the user can edit
//   so hidden fields are never required and never validated.
export interface TransactionFormSchemaContext {
  type: TransactionType;
  isCrossCurrency: boolean;
  showsCrossAccount: boolean;
  showsAmount: boolean;
  showsShares: boolean;
  showsPrice: boolean;
  showsFees: boolean;
  showsTaxes: boolean;
}

export type Translator = (key: string) => string;

function isPresent(v: string | undefined): v is string {
  return v != null && v.trim() !== '';
}

// Strict numeric grammar: optional sign, digits, optional fraction, optional
// exponent. Rejects ' 10 ' (silently trimmed by Number()), '1 0', '1,5'
// (locale comma), and other whitespace/punctuation that Number() would coerce
// or NaN inconsistently. Matches what the wire schema's z.number() accepts
// after preparePayload's parseFloat().
const NUMERIC_RE = /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/;

function parseFiniteNumber(v: string): number | null {
  if (!NUMERIC_RE.test(v)) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function buildTransactionFormSchema(
  ctx: TransactionFormSchemaContext,
  t: Translator,
) {
  const {
    type,
    isCrossCurrency,
    showsCrossAccount,
    showsAmount,
    showsShares,
    showsPrice,
    showsFees,
    showsTaxes,
  } = ctx;
  const securityRequired = SECURITY_REQUIRED_TYPES.has(type);
  const amountMustBePositive = AMOUNT_REQUIRED_TYPES.has(type);
  const fxRequiredWhenCross = CROSS_CURRENCY_FX_TYPES.has(type);

  return transactionFormBaseSchema.superRefine((data, c) => {
    if (securityRequired && !isPresent(data.securityId)) {
      c.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['securityId'],
        message: t('validation.securityRequired'),
      });
    }

    if (!isPresent(data.accountId)) {
      c.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['accountId'],
        message: t('validation.accountRequired'),
      });
    }

    if (showsCrossAccount && !isPresent(data.crossAccountId)) {
      c.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['crossAccountId'],
        message: t('validation.targetRequired'),
      });
    }
    if (
      isPresent(data.accountId) &&
      isPresent(data.crossAccountId) &&
      data.accountId === data.crossAccountId
    ) {
      c.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['crossAccountId'],
        message: t('validation.sourceDestMustDiffer'),
      });
    }

    if (showsShares) {
      if (!isPresent(data.shares)) {
        c.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['shares'],
          message: t('validation.sharesRequired'),
        });
      } else {
        const n = parseFiniteNumber(data.shares);
        if (n == null || n <= 0) {
          c.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['shares'],
            message: t('validation.sharesMustBePositive'),
          });
        }
      }
    }

    if (showsPrice) {
      // BUY/SELL derive amount = shares × price; both must be > 0 to satisfy
      // AMOUNT_REQUIRED_TYPES on the wire. SECURITY_TRANSFER + DELIVERY_*
      // (BUG-113) accept amount = 0, so price may be empty/0.
      if (amountMustBePositive) {
        if (!isPresent(data.price)) {
          c.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['price'],
            message: t('validation.priceMustBePositive'),
          });
        } else {
          const n = parseFiniteNumber(data.price);
          if (n == null || n <= 0) {
            c.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['price'],
              message: t('validation.priceMustBePositive'),
            });
          }
        }
      } else if (isPresent(data.price)) {
        const n = parseFiniteNumber(data.price);
        if (n == null || n < 0) {
          c.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['price'],
            message: t('validation.priceMustBePositive'),
          });
        }
      }
    }

    if (showsAmount && amountMustBePositive) {
      if (!isPresent(data.amount)) {
        c.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['amount'],
          message: t('validation.amountRequired'),
        });
      } else {
        const n = parseFiniteNumber(data.amount);
        if (n == null || n <= 0) {
          c.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['amount'],
            message: t('validation.amountMustBePositive'),
          });
        }
      }
    }

    if (showsFees && isPresent(data.fees)) {
      const n = parseFiniteNumber(data.fees);
      if (n == null || n < 0) {
        c.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['fees'],
          message: t('validation.feesMustBeNonNegative'),
        });
      }
    }
    if (showsTaxes && isPresent(data.taxes)) {
      const n = parseFiniteNumber(data.taxes);
      if (n == null || n < 0) {
        c.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['taxes'],
          message: t('validation.taxesMustBeNonNegative'),
        });
      }
    }

    if (isCrossCurrency && fxRequiredWhenCross) {
      if (!isPresent(data.fxRate)) {
        c.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['fxRate'],
          message: t('validation.fxRateMustBePositive'),
        });
      } else {
        const n = parseFiniteNumber(data.fxRate);
        if (n == null || n <= 0) {
          c.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['fxRate'],
            message: t('validation.fxRateMustBePositive'),
          });
        }
      }
      if (isPresent(data.feesFx)) {
        const n = parseFiniteNumber(data.feesFx);
        if (n == null || n < 0) {
          c.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['feesFx'],
            message: t('validation.feesMustBeNonNegative'),
          });
        }
      }
      if (isPresent(data.taxesFx)) {
        const n = parseFiniteNumber(data.taxesFx);
        if (n == null || n < 0) {
          c.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['taxesFx'],
            message: t('validation.taxesMustBeNonNegative'),
          });
        }
      }
    }
  });
}
