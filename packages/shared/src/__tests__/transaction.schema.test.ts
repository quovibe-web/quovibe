import { describe, it, expect } from 'vitest';
import { createTransactionSchema } from '../schemas/transaction.schema';
import { TransactionType } from '../enums';

const UUID_A = '00000000-0000-4000-8000-000000000001';
const UUID_B = '00000000-0000-4000-8000-000000000002';
const UUID_SEC = '00000000-0000-4000-8000-000000000010';

function basePayload(type: TransactionType, overrides: Record<string, unknown> = {}) {
  return {
    type,
    date: '2026-04-25',
    accountId: UUID_A,
    amount: 100,
    ...overrides,
  };
}

describe('createTransactionSchema — securityId required (BUG-106)', () => {
  it('rejects BUY with no securityId', () => {
    const result = createTransactionSchema.safeParse(
      basePayload(TransactionType.BUY, { shares: 1 }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      const codes = result.error.issues.map((i) => i.path.join('.'));
      expect(codes).toContain('securityId');
    }
  });

  it('rejects SELL with no securityId', () => {
    const result = createTransactionSchema.safeParse(
      basePayload(TransactionType.SELL, { shares: 1 }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects DIVIDEND with no securityId', () => {
    const result = createTransactionSchema.safeParse(basePayload(TransactionType.DIVIDEND));
    expect(result.success).toBe(false);
    if (!result.success) {
      const codes = result.error.issues.map((i) => i.path.join('.'));
      expect(codes).toContain('securityId');
    }
  });

  it('rejects SECURITY_TRANSFER with no securityId', () => {
    const result = createTransactionSchema.safeParse(
      basePayload(TransactionType.SECURITY_TRANSFER, {
        amount: 0,
        shares: 1,
        crossAccountId: UUID_B,
      }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects DELIVERY_INBOUND with no securityId', () => {
    const result = createTransactionSchema.safeParse(
      basePayload(TransactionType.DELIVERY_INBOUND, { amount: 0, shares: 1 }),
    );
    expect(result.success).toBe(false);
  });

  it('accepts BUY with a valid securityId + shares + amount', () => {
    const result = createTransactionSchema.safeParse(
      basePayload(TransactionType.BUY, { shares: 1, securityId: UUID_SEC }),
    );
    expect(result.success).toBe(true);
  });

  it('accepts DIVIDEND with a valid securityId + amount', () => {
    const result = createTransactionSchema.safeParse(
      basePayload(TransactionType.DIVIDEND, { securityId: UUID_SEC }),
    );
    expect(result.success).toBe(true);
  });

  it('does NOT require securityId for cash-only types (DEPOSIT)', () => {
    const result = createTransactionSchema.safeParse(basePayload(TransactionType.DEPOSIT));
    expect(result.success).toBe(true);
  });
});

describe('createTransactionSchema — amount=0 allowed for share-only types (BUG-113)', () => {
  it('accepts SECURITY_TRANSFER with amount=0', () => {
    const result = createTransactionSchema.safeParse(
      basePayload(TransactionType.SECURITY_TRANSFER, {
        amount: 0,
        shares: 1,
        securityId: UUID_SEC,
        crossAccountId: UUID_B,
      }),
    );
    expect(result.success).toBe(true);
  });

  it('accepts DELIVERY_INBOUND with amount=0', () => {
    const result = createTransactionSchema.safeParse(
      basePayload(TransactionType.DELIVERY_INBOUND, {
        amount: 0,
        shares: 1,
        securityId: UUID_SEC,
      }),
    );
    expect(result.success).toBe(true);
  });

  it('accepts DELIVERY_OUTBOUND with amount=0', () => {
    const result = createTransactionSchema.safeParse(
      basePayload(TransactionType.DELIVERY_OUTBOUND, {
        amount: 0,
        shares: 1,
        securityId: UUID_SEC,
      }),
    );
    expect(result.success).toBe(true);
  });

  it('still rejects BUY with amount=0', () => {
    const result = createTransactionSchema.safeParse(
      basePayload(TransactionType.BUY, {
        amount: 0,
        shares: 1,
        securityId: UUID_SEC,
      }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      const codes = result.error.issues.map((i) => i.path.join('.'));
      expect(codes).toContain('amount');
    }
  });

  it('still rejects DEPOSIT with amount=0', () => {
    const result = createTransactionSchema.safeParse(
      basePayload(TransactionType.DEPOSIT, { amount: 0 }),
    );
    expect(result.success).toBe(false);
  });

  it('still rejects TRANSFER_BETWEEN_ACCOUNTS with amount=0', () => {
    const result = createTransactionSchema.safeParse(
      basePayload(TransactionType.TRANSFER_BETWEEN_ACCOUNTS, {
        amount: 0,
        crossAccountId: UUID_B,
      }),
    );
    expect(result.success).toBe(false);
  });
});
