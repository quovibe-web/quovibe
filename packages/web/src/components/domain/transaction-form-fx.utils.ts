import { TransactionType } from '@quovibe/shared';

export interface CurrencyHolder {
  currency: string;
}

export interface DeriveFxCurrenciesInput {
  type: TransactionType;
  sourceAccount: CurrencyHolder | null | undefined;
  crossAccount: CurrencyHolder | null | undefined;
  security: CurrencyHolder | null | undefined;
}

export interface DeriveFxCurrenciesResult {
  srcCurrency: string | null;
  dstCurrency: string | null;
  isCrossCurrency: boolean;
}

export const BUY_SELL_TYPES: ReadonlySet<TransactionType> = new Set([
  TransactionType.BUY,
  TransactionType.SELL,
]);

// The covered set below ({BUY, SELL, TRANSFER_BETWEEN_ACCOUNTS}) must stay in
// sync with `CROSS_CURRENCY_FX_TYPES` in `packages/shared/src/transaction-gating.ts`.
// If a new type is added there, this helper needs a matching derivation rule —
// otherwise the server's FX gate fires on a payload the client never built an
// input for (silent client gap).
//
// BUY/SELL: src = cash leg (crossAccount), dst = security currency. The FX rate
// transforms the deposit-side amount into the security-currency forex_amount,
// matching transaction.service.ts > buildUnits BUY/SELL convention.
//
// TRANSFER_BETWEEN_ACCOUNTS: src = source deposit, dst = destination deposit.
// fxRate transforms xact.amount (src ccy) into xact_unit.forex_amount (dst ccy).
//
// Other types: no cross-currency leg — null/null/false.
export function deriveFxCurrencies({
  type,
  sourceAccount,
  crossAccount,
  security,
}: DeriveFxCurrenciesInput): DeriveFxCurrenciesResult {
  let srcCurrency: string | null = null;
  let dstCurrency: string | null = null;

  if (BUY_SELL_TYPES.has(type)) {
    srcCurrency = crossAccount?.currency ?? null;
    dstCurrency = security?.currency ?? null;
  } else if (type === TransactionType.TRANSFER_BETWEEN_ACCOUNTS) {
    srcCurrency = sourceAccount?.currency ?? null;
    dstCurrency = crossAccount?.currency ?? null;
  }

  const isCrossCurrency = !!(
    srcCurrency &&
    dstCurrency &&
    srcCurrency !== dstCurrency
  );

  return { srcCurrency, dstCurrency, isCrossCurrency };
}
