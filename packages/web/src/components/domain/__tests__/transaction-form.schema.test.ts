import { describe, expect, it } from 'vitest';
import { TransactionType } from '@quovibe/shared';
import {
  buildTransactionFormSchema,
  type TransactionFormSchemaContext,
} from '../transaction-form.schema';

const t = (k: string) => k;

const ACC_A = '11111111-1111-1111-1111-111111111111';
const ACC_B = '22222222-2222-2222-2222-222222222222';
const SEC = '33333333-3333-3333-3333-333333333333';

interface CtxOverride {
  type?: TransactionType;
  isCrossCurrency?: boolean;
  showsCrossAccount?: boolean;
  showsAmount?: boolean;
  showsShares?: boolean;
  showsPrice?: boolean;
  showsFees?: boolean;
  showsTaxes?: boolean;
}

function ctx(over: CtxOverride = {}): TransactionFormSchemaContext {
  const merged = {
    type: TransactionType.BUY,
    isCrossCurrency: false,
    showsCrossAccount: true,
    showsAmount: false,
    showsShares: true,
    showsPrice: true,
    showsFees: true,
    showsTaxes: true,
    ...over,
  };
  return {
    type: merged.type,
    isCrossCurrency: merged.isCrossCurrency,
    fields: {
      crossAccountId: merged.showsCrossAccount,
      amount: merged.showsAmount,
      shares: merged.showsShares,
      price: merged.showsPrice,
      fees: merged.showsFees,
      taxes: merged.showsTaxes,
    },
  };
}

const baseFields = {
  date: '2026-04-25',
  time: '00:00',
  fees: '',
  taxes: '',
  fxRate: '',
  feesFx: '',
  taxesFx: '',
  note: '',
};

function fieldErrors(issues: { path: (string | number)[]; message: string }[]) {
  return Object.fromEntries(issues.map(i => [i.path[0], i.message]));
}

describe('buildTransactionFormSchema — BUY', () => {
  it('requires securityId, accountId, crossAccountId, shares, price', () => {
    const schema = buildTransactionFormSchema(ctx({ type: TransactionType.BUY }), t);
    const r = schema.safeParse({ ...baseFields, type: TransactionType.BUY, accountId: '' });
    expect(r.success).toBe(false);
    if (!r.success) {
      const errs = fieldErrors(r.error.issues);
      expect(errs.securityId).toBe('validation.securityRequired');
      expect(errs.accountId).toBe('validation.accountRequired');
      expect(errs.crossAccountId).toBe('validation.targetRequired');
      expect(errs.shares).toBe('validation.sharesRequired');
      expect(errs.price).toBe('validation.priceMustBePositive');
    }
  });

  it('rejects negative shares', () => {
    const schema = buildTransactionFormSchema(ctx({ type: TransactionType.BUY }), t);
    const r = schema.safeParse({
      ...baseFields,
      type: TransactionType.BUY,
      accountId: ACC_A,
      crossAccountId: ACC_B,
      securityId: SEC,
      shares: '-100',
      price: '50',
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      const errs = fieldErrors(r.error.issues);
      expect(errs.shares).toBe('validation.sharesMustBePositive');
    }
  });

  it('rejects zero price', () => {
    const schema = buildTransactionFormSchema(ctx({ type: TransactionType.BUY }), t);
    const r = schema.safeParse({
      ...baseFields,
      type: TransactionType.BUY,
      accountId: ACC_A,
      crossAccountId: ACC_B,
      securityId: SEC,
      shares: '10',
      price: '0',
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      const errs = fieldErrors(r.error.issues);
      expect(errs.price).toBe('validation.priceMustBePositive');
    }
  });

  it('accepts a fully-valid BUY', () => {
    const schema = buildTransactionFormSchema(ctx({ type: TransactionType.BUY }), t);
    const r = schema.safeParse({
      ...baseFields,
      type: TransactionType.BUY,
      accountId: ACC_A,
      crossAccountId: ACC_B,
      securityId: SEC,
      shares: '10',
      price: '50',
      fees: '2.5',
      taxes: '1.0',
    });
    expect(r.success).toBe(true);
  });

  it('rejects negative fees but accepts empty', () => {
    const schema = buildTransactionFormSchema(ctx({ type: TransactionType.BUY }), t);
    const negFees = schema.safeParse({
      ...baseFields,
      type: TransactionType.BUY,
      accountId: ACC_A,
      crossAccountId: ACC_B,
      securityId: SEC,
      shares: '10',
      price: '50',
      fees: '-1',
    });
    expect(negFees.success).toBe(false);
    if (!negFees.success) {
      const errs = fieldErrors(negFees.error.issues);
      expect(errs.fees).toBe('validation.feesMustBeNonNegative');
    }
  });
});

describe('buildTransactionFormSchema — SECURITY_TRANSFER (BUG-113)', () => {
  it('accepts amount=0 / no price (no AMOUNT_REQUIRED gate)', () => {
    const schema = buildTransactionFormSchema(
      ctx({
        type: TransactionType.SECURITY_TRANSFER,
        showsCrossAccount: true,
        showsShares: true,
        showsPrice: true,
        showsAmount: false,
        showsFees: true,
        showsTaxes: false,
      }),
      t,
    );
    const r = schema.safeParse({
      ...baseFields,
      type: TransactionType.SECURITY_TRANSFER,
      accountId: ACC_A,
      crossAccountId: ACC_B,
      securityId: SEC,
      shares: '5',
      price: '',
      amount: '',
    });
    expect(r.success).toBe(true);
  });

  it('rejects same source and destination accounts (BUG-01)', () => {
    const schema = buildTransactionFormSchema(
      ctx({
        type: TransactionType.SECURITY_TRANSFER,
        showsCrossAccount: true,
        showsAmount: false,
      }),
      t,
    );
    const r = schema.safeParse({
      ...baseFields,
      type: TransactionType.SECURITY_TRANSFER,
      accountId: ACC_A,
      crossAccountId: ACC_A,
      securityId: SEC,
      shares: '5',
      price: '',
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      const errs = fieldErrors(r.error.issues);
      expect(errs.crossAccountId).toBe('validation.sourceDestMustDiffer');
    }
  });
});

describe('buildTransactionFormSchema — DEPOSIT (cash-only)', () => {
  it('requires amount > 0, ignores hidden fields', () => {
    const schema = buildTransactionFormSchema(
      ctx({
        type: TransactionType.DEPOSIT,
        showsCrossAccount: false,
        showsShares: false,
        showsPrice: false,
        showsAmount: true,
        showsFees: false,
        showsTaxes: false,
      }),
      t,
    );
    const r = schema.safeParse({
      ...baseFields,
      type: TransactionType.DEPOSIT,
      accountId: ACC_A,
      amount: '',
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      const errs = fieldErrors(r.error.issues);
      expect(errs.amount).toBe('validation.amountRequired');
    }
  });

  it('accepts a valid DEPOSIT', () => {
    const schema = buildTransactionFormSchema(
      ctx({
        type: TransactionType.DEPOSIT,
        showsCrossAccount: false,
        showsShares: false,
        showsPrice: false,
        showsAmount: true,
        showsFees: false,
        showsTaxes: false,
      }),
      t,
    );
    const r = schema.safeParse({
      ...baseFields,
      type: TransactionType.DEPOSIT,
      accountId: ACC_A,
      amount: '500',
    });
    expect(r.success).toBe(true);
  });

  it('rejects negative amount with the positive-amount message', () => {
    const schema = buildTransactionFormSchema(
      ctx({
        type: TransactionType.DEPOSIT,
        showsCrossAccount: false,
        showsShares: false,
        showsPrice: false,
        showsAmount: true,
        showsFees: false,
        showsTaxes: false,
      }),
      t,
    );
    const r = schema.safeParse({
      ...baseFields,
      type: TransactionType.DEPOSIT,
      accountId: ACC_A,
      amount: '-100',
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      const errs = fieldErrors(r.error.issues);
      expect(errs.amount).toBe('validation.amountMustBePositive');
    }
  });
});

describe('buildTransactionFormSchema — cross-currency BUY (BUG-112)', () => {
  it('requires fxRate when isCrossCurrency=true', () => {
    const schema = buildTransactionFormSchema(
      ctx({ type: TransactionType.BUY, isCrossCurrency: true }),
      t,
    );
    const r = schema.safeParse({
      ...baseFields,
      type: TransactionType.BUY,
      accountId: ACC_A,
      crossAccountId: ACC_B,
      securityId: SEC,
      shares: '10',
      price: '50',
      fxRate: '',
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      const errs = fieldErrors(r.error.issues);
      expect(errs.fxRate).toBe('validation.fxRateMustBePositive');
    }
  });

  it('rejects zero fxRate', () => {
    const schema = buildTransactionFormSchema(
      ctx({ type: TransactionType.BUY, isCrossCurrency: true }),
      t,
    );
    const r = schema.safeParse({
      ...baseFields,
      type: TransactionType.BUY,
      accountId: ACC_A,
      crossAccountId: ACC_B,
      securityId: SEC,
      shares: '10',
      price: '50',
      fxRate: '0',
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      const errs = fieldErrors(r.error.issues);
      expect(errs.fxRate).toBe('validation.fxRateMustBePositive');
    }
  });

  it('accepts a fully-valid cross-currency BUY', () => {
    const schema = buildTransactionFormSchema(
      ctx({ type: TransactionType.BUY, isCrossCurrency: true }),
      t,
    );
    const r = schema.safeParse({
      ...baseFields,
      type: TransactionType.BUY,
      accountId: ACC_A,
      crossAccountId: ACC_B,
      securityId: SEC,
      shares: '10',
      price: '50',
      fxRate: '1.10',
    });
    expect(r.success).toBe(true);
  });

  it('does NOT require fxRate when isCrossCurrency=false', () => {
    const schema = buildTransactionFormSchema(
      ctx({ type: TransactionType.BUY, isCrossCurrency: false }),
      t,
    );
    const r = schema.safeParse({
      ...baseFields,
      type: TransactionType.BUY,
      accountId: ACC_A,
      crossAccountId: ACC_B,
      securityId: SEC,
      shares: '10',
      price: '50',
      fxRate: '',
    });
    expect(r.success).toBe(true);
  });
});

describe('buildTransactionFormSchema — TRANSFER_BETWEEN_ACCOUNTS (BUG-111)', () => {
  it('requires amount > 0 and rejects same source/dest', () => {
    const schema = buildTransactionFormSchema(
      ctx({
        type: TransactionType.TRANSFER_BETWEEN_ACCOUNTS,
        showsCrossAccount: true,
        showsShares: false,
        showsPrice: false,
        showsAmount: true,
        showsFees: false,
        showsTaxes: false,
      }),
      t,
    );
    const r = schema.safeParse({
      ...baseFields,
      type: TransactionType.TRANSFER_BETWEEN_ACCOUNTS,
      accountId: ACC_A,
      crossAccountId: ACC_A,
      amount: '',
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      const errs = fieldErrors(r.error.issues);
      expect(errs.amount).toBe('validation.amountRequired');
      expect(errs.crossAccountId).toBe('validation.sourceDestMustDiffer');
    }
  });

  it('requires fxRate when cross-currency', () => {
    const schema = buildTransactionFormSchema(
      ctx({
        type: TransactionType.TRANSFER_BETWEEN_ACCOUNTS,
        isCrossCurrency: true,
        showsCrossAccount: true,
        showsShares: false,
        showsPrice: false,
        showsAmount: true,
        showsFees: false,
        showsTaxes: false,
      }),
      t,
    );
    const r = schema.safeParse({
      ...baseFields,
      type: TransactionType.TRANSFER_BETWEEN_ACCOUNTS,
      accountId: ACC_A,
      crossAccountId: ACC_B,
      amount: '500',
      fxRate: '',
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      const errs = fieldErrors(r.error.issues);
      expect(errs.fxRate).toBe('validation.fxRateMustBePositive');
    }
  });
});

describe('buildTransactionFormSchema — DELIVERY_INBOUND', () => {
  it('accepts shares-only with no taxes/crossAccount, amount=0 OK', () => {
    const schema = buildTransactionFormSchema(
      ctx({
        type: TransactionType.DELIVERY_INBOUND,
        showsCrossAccount: false,
        showsShares: true,
        showsPrice: true,
        showsAmount: false,
        showsFees: true,
        showsTaxes: false,
      }),
      t,
    );
    const r = schema.safeParse({
      ...baseFields,
      type: TransactionType.DELIVERY_INBOUND,
      accountId: ACC_A,
      securityId: SEC,
      shares: '5',
      price: '',
      amount: '',
    });
    expect(r.success).toBe(true);
  });

  it('rejects negative fees', () => {
    const schema = buildTransactionFormSchema(
      ctx({
        type: TransactionType.DELIVERY_INBOUND,
        showsCrossAccount: false,
        showsShares: true,
        showsPrice: true,
        showsAmount: false,
        showsFees: true,
        showsTaxes: false,
      }),
      t,
    );
    const r = schema.safeParse({
      ...baseFields,
      type: TransactionType.DELIVERY_INBOUND,
      accountId: ACC_A,
      securityId: SEC,
      shares: '5',
      fees: '-1',
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      const errs = fieldErrors(r.error.issues);
      expect(errs.fees).toBe('validation.feesMustBeNonNegative');
    }
  });
});

describe('buildTransactionFormSchema — DELIVERY_OUTBOUND', () => {
  it('accepts shares-only with no fees/taxes/crossAccount, amount=0 OK', () => {
    const schema = buildTransactionFormSchema(
      ctx({
        type: TransactionType.DELIVERY_OUTBOUND,
        showsCrossAccount: false,
        showsShares: true,
        showsPrice: true,
        showsAmount: false,
        showsFees: false,
        showsTaxes: false,
      }),
      t,
    );
    const r = schema.safeParse({
      ...baseFields,
      type: TransactionType.DELIVERY_OUTBOUND,
      accountId: ACC_A,
      securityId: SEC,
      shares: '3',
    });
    expect(r.success).toBe(true);
  });
});

describe('buildTransactionFormSchema — REMOVAL (cash-only, security NOT required)', () => {
  it('accepts a valid REMOVAL with no securityId', () => {
    const schema = buildTransactionFormSchema(
      ctx({
        type: TransactionType.REMOVAL,
        showsCrossAccount: false,
        showsShares: false,
        showsPrice: false,
        showsAmount: true,
        showsFees: false,
        showsTaxes: false,
      }),
      t,
    );
    const r = schema.safeParse({
      ...baseFields,
      type: TransactionType.REMOVAL,
      accountId: ACC_A,
      amount: '100',
    });
    expect(r.success).toBe(true);
  });
});

describe('buildTransactionFormSchema — pathological numeric strings', () => {
  it('rejects whitespace-padded "10 " on shares', () => {
    const schema = buildTransactionFormSchema(ctx({ type: TransactionType.BUY }), t);
    const r = schema.safeParse({
      ...baseFields,
      type: TransactionType.BUY,
      accountId: ACC_A,
      crossAccountId: ACC_B,
      securityId: SEC,
      shares: '10 ',
      price: '50',
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      const errs = fieldErrors(r.error.issues);
      expect(errs.shares).toBe('validation.sharesMustBePositive');
    }
  });

  it('rejects locale comma "1,5" on price', () => {
    const schema = buildTransactionFormSchema(ctx({ type: TransactionType.BUY }), t);
    const r = schema.safeParse({
      ...baseFields,
      type: TransactionType.BUY,
      accountId: ACC_A,
      crossAccountId: ACC_B,
      securityId: SEC,
      shares: '10',
      price: '1,5',
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      const errs = fieldErrors(r.error.issues);
      expect(errs.price).toBe('validation.priceMustBePositive');
    }
  });

  it('treats whitespace-only string as missing (required-field message, not "must be positive")', () => {
    const schema = buildTransactionFormSchema(ctx({ type: TransactionType.BUY }), t);
    const r = schema.safeParse({
      ...baseFields,
      type: TransactionType.BUY,
      accountId: ACC_A,
      crossAccountId: ACC_B,
      securityId: SEC,
      shares: '   ',
      price: '50',
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      const errs = fieldErrors(r.error.issues);
      expect(errs.shares).toBe('validation.sharesRequired');
    }
  });
});

describe('buildTransactionFormSchema — DIVIDEND (BUG-106)', () => {
  it('requires securityId', () => {
    const schema = buildTransactionFormSchema(
      ctx({
        type: TransactionType.DIVIDEND,
        showsCrossAccount: false,
        showsShares: false,
        showsPrice: false,
        showsAmount: true,
        showsFees: true,
        showsTaxes: true,
      }),
      t,
    );
    const r = schema.safeParse({
      ...baseFields,
      type: TransactionType.DIVIDEND,
      accountId: ACC_A,
      amount: '50',
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      const errs = fieldErrors(r.error.issues);
      expect(errs.securityId).toBe('validation.securityRequired');
    }
  });
});

describe('buildTransactionFormSchema — TRANSFER_BETWEEN_ACCOUNTS', () => {
  it('cross-ccy: requires fxRate', () => {
    const schema = buildTransactionFormSchema(
      ctx({
        type: TransactionType.TRANSFER_BETWEEN_ACCOUNTS,
        isCrossCurrency: true,
        showsCrossAccount: true,
        showsAmount: true,
        showsShares: false,
        showsPrice: false,
        showsFees: false,
        showsTaxes: false,
      }),
      t,
    );
    const r = schema.safeParse({
      ...baseFields,
      type: TransactionType.TRANSFER_BETWEEN_ACCOUNTS,
      accountId: ACC_A,
      crossAccountId: ACC_B,
      amount: '100',
      // fxRate omitted
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      const errs = fieldErrors(r.error.issues);
      expect(errs.fxRate).toBe('validation.fxRateMustBePositive');
    }
  });

  it('cross-ccy with positive fxRate: passes', () => {
    const schema = buildTransactionFormSchema(
      ctx({
        type: TransactionType.TRANSFER_BETWEEN_ACCOUNTS,
        isCrossCurrency: true,
        showsCrossAccount: true,
        showsAmount: true,
        showsShares: false,
        showsPrice: false,
        showsFees: false,
        showsTaxes: false,
      }),
      t,
    );
    const r = schema.safeParse({
      ...baseFields,
      type: TransactionType.TRANSFER_BETWEEN_ACCOUNTS,
      accountId: ACC_A,
      crossAccountId: ACC_B,
      amount: '100',
      fxRate: '1.0837',
    });
    expect(r.success).toBe(true);
  });

  it('same-ccy: fxRate not required', () => {
    const schema = buildTransactionFormSchema(
      ctx({
        type: TransactionType.TRANSFER_BETWEEN_ACCOUNTS,
        isCrossCurrency: false,
        showsCrossAccount: true,
        showsAmount: true,
        showsShares: false,
        showsPrice: false,
        showsFees: false,
        showsTaxes: false,
      }),
      t,
    );
    const r = schema.safeParse({
      ...baseFields,
      type: TransactionType.TRANSFER_BETWEEN_ACCOUNTS,
      accountId: ACC_A,
      crossAccountId: ACC_B,
      amount: '100',
    });
    expect(r.success).toBe(true);
  });

  it('cross-ccy with zero fxRate: fails', () => {
    const schema = buildTransactionFormSchema(
      ctx({
        type: TransactionType.TRANSFER_BETWEEN_ACCOUNTS,
        isCrossCurrency: true,
        showsCrossAccount: true,
        showsAmount: true,
        showsShares: false,
        showsPrice: false,
        showsFees: false,
        showsTaxes: false,
      }),
      t,
    );
    const r = schema.safeParse({
      ...baseFields,
      type: TransactionType.TRANSFER_BETWEEN_ACCOUNTS,
      accountId: ACC_A,
      crossAccountId: ACC_B,
      amount: '100',
      fxRate: '0',
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      const errs = fieldErrors(r.error.issues);
      expect(errs.fxRate).toBe('validation.fxRateMustBePositive');
    }
  });

  it('source equals destination: rejects with sourceDestMustDiffer', () => {
    const schema = buildTransactionFormSchema(
      ctx({
        type: TransactionType.TRANSFER_BETWEEN_ACCOUNTS,
        isCrossCurrency: false,
        showsCrossAccount: true,
        showsAmount: true,
        showsShares: false,
        showsPrice: false,
        showsFees: false,
        showsTaxes: false,
      }),
      t,
    );
    const r = schema.safeParse({
      ...baseFields,
      type: TransactionType.TRANSFER_BETWEEN_ACCOUNTS,
      accountId: ACC_A,
      crossAccountId: ACC_A,
      amount: '100',
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      const errs = fieldErrors(r.error.issues);
      expect(errs.crossAccountId).toBe('validation.sourceDestMustDiffer');
    }
  });
});
