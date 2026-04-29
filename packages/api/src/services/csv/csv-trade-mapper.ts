// packages/api/src/services/csv/csv-trade-mapper.ts
import Decimal from 'decimal.js';
import { v4 as uuidv4 } from 'uuid';
import { TransactionType, CROSS_CURRENCY_FX_TYPES } from '@quovibe/shared';
import type { NormalizedTradeRow, RowError } from '@quovibe/shared';

// ─── Account routing groups (from api.md) ─────────

const GROUP_A_DUAL_ENTRY = new Set<TransactionType>([TransactionType.BUY, TransactionType.SELL]);

const GROUP_B_CASH_ONLY = new Set<TransactionType>([
  TransactionType.DEPOSIT, TransactionType.REMOVAL,
  TransactionType.DIVIDEND, TransactionType.INTEREST, TransactionType.INTEREST_CHARGE,
  TransactionType.FEES, TransactionType.FEES_REFUND,
  TransactionType.TAXES, TransactionType.TAX_REFUND,
]);

const GROUP_C_SHARES_ONLY = new Set<TransactionType>([
  TransactionType.DELIVERY_INBOUND, TransactionType.DELIVERY_OUTBOUND,
]);

const GROUP_D_SECURITY_TRANSFER = new Set<TransactionType>([
  TransactionType.SECURITY_TRANSFER,
]);

const GROUP_E_ACCOUNT_TRANSFER = new Set<TransactionType>([
  TransactionType.TRANSFER_BETWEEN_ACCOUNTS,
]);

const SHARE_REQUIRED_TYPES = new Set<TransactionType>([
  TransactionType.BUY, TransactionType.SELL,
  TransactionType.DELIVERY_INBOUND, TransactionType.DELIVERY_OUTBOUND,
  TransactionType.SECURITY_TRANSFER,
]);

const SECURITY_REQUIRED_TYPES = new Set<TransactionType>([
  TransactionType.BUY, TransactionType.SELL,
  TransactionType.DIVIDEND,
  TransactionType.DELIVERY_INBOUND, TransactionType.DELIVERY_OUTBOUND,
  TransactionType.SECURITY_TRANSFER,
]);

// ppxml2db convention (see docs/pp-reference/calculation-model.md Section 2):
//   Outflow/debit types: amount = gross + fees + taxes
//   Inflow/credit types: amount = gross - fees - taxes
const OUTFLOW_TYPES = new Set<TransactionType>([
  TransactionType.BUY,
  TransactionType.DELIVERY_INBOUND,
  TransactionType.REMOVAL,
  TransactionType.INTEREST_CHARGE,
  TransactionType.FEES,
  TransactionType.TAXES,
  TransactionType.TRANSFER_BETWEEN_ACCOUNTS,
]);
const INFLOW_TYPES = new Set<TransactionType>([
  TransactionType.SELL,
  TransactionType.DIVIDEND,
  TransactionType.DELIVERY_OUTBOUND,
  TransactionType.DEPOSIT,
  TransactionType.INTEREST,
  TransactionType.FEES_REFUND,
  TransactionType.TAX_REFUND,
  TransactionType.SECURITY_TRANSFER,
]);

// ─── Types ────────────────────────────────────────

export interface TradeMapperContext {
  portfolioId: string;
  depositAccountId: string;
  portfolioCurrency: string;
  securityMap: Map<string, string>;             // csvName → securityId
  securityCurrencyMap?: Map<string, string>;    // securityId → currency (cross-ccy gate)
  accountCurrencyMap?: Map<string, string>;     // accountUuid → currency (cross-ccy gate)
}

export interface XactInsert {
  id: string;
  type: string;
  date: string;
  currency: string;
  amount: number;       // hecto-units (×100)
  shares: number;       // ×10^8
  note: string | null;
  securityId: string | null;
  accountId: string;
  acctype: string;
  source: string;
  fees: number;         // hecto-units
  taxes: number;        // hecto-units
}

export interface CrossEntryInsert {
  fromXact: string;
  fromAcc: string;
  toXact: string;
  toAcc: string;
  type: string;
}

// xact_unit row to be inserted alongside its xact. Mirrors the shape of
// `UnitRow` in transaction.service.ts and the xact_unit columns in
// bootstrap.sql:130-143. `currency` is NOT NULL in the schema.
export interface UnitInsert {
  xact: string;
  type: 'FEE' | 'TAX' | 'FOREX';
  amount: number;                  // hecto-units, in `currency`
  currency: string;
  forex_amount: number | null;     // hecto-units, in `forex_currency` (FOREX only)
  forex_currency: string | null;
  exchangeRate: string | null;     // qv-convention rate, security-per-deposit
}

export interface TradeMapResult {
  transactions: XactInsert[];
  crossEntries: CrossEntryInsert[];
  units: UnitInsert[];
  errors: RowError[];
}

// ─── Net amount computation (mirrors transaction.service.ts) ───

function computeNetAmountHecto(
  type: TransactionType,
  grossAmount: Decimal,
  fees: Decimal,
  taxes: Decimal,
): number {
  let net: Decimal;
  if (OUTFLOW_TYPES.has(type)) {
    net = grossAmount.plus(fees).plus(taxes);
  } else if (INFLOW_TYPES.has(type)) {
    net = grossAmount.minus(fees).minus(taxes);
  } else {
    net = grossAmount;
  }
  return Math.round(parseFloat(net.times(100).toPrecision(15)));
}

export function toHecto(value: number): number {
  return Math.round(parseFloat(new Decimal(value).times(100).toPrecision(15)));
}

export function toSharesDb(value: number): number {
  return Math.round(parseFloat(new Decimal(value).times(1e8).toPrecision(15)));
}

// ─── xact_unit emission (mirrors transaction.service.ts buildUnits) ───

// FEE/TAX units, attached to the source xact. Per-type matrix mirrors
// buildUnits() in transaction.service.ts. Standalone FEES/TAXES/etc. are
// intentionally absent — the gross amount lives in xact.amount and emitting
// a duplicate FEE/TAX unit would double-count.
//
// `fx` is only passed for BUY/SELL when the row is cross-currency. The FOREX
// decoration mirrors transaction.service.ts:247-270 byte-identically:
//   totalFeesDeposit = (fees in deposit ccy) + (feesFx / fxRate)
//   feesDepHecto     = round(totalFeesDeposit * 100)  ← single round, not two
//   forex_amount     = round(feesFx * 100)
// CSV-specific: `feesCurrency`/`taxesCurrency` allow per-column override;
// fallback chain is feesCurrency → currencyGrossAmount → securityCurrency
// (richer than the JSON path, which resolves a single `fxCurrencyCode`).
function emitFeeTaxUnits(
  xactId: string,
  type: TransactionType,
  feesDepUnits: number,   // deposit-ccy, in original units (not hecto)
  taxesDepUnits: number,  // deposit-ccy, in original units (not hecto)
  depositCurrency: string,
  fx?: {
    feesFx?: number;
    taxesFx?: number;
    feesCurrency?: string;  // resolved security-ccy override for fees
    taxesCurrency?: string; // resolved security-ccy override for taxes
    rate: string;           // qv-convention string, security-per-deposit
    securityCurrency: string;
  },
): UnitInsert[] {
  const out: UnitInsert[] = [];

  // Mirrors transaction.service.ts:247-270 for BUY/SELL.
  // Sum in deposit units, round once to hecto — avoids double-rounding drift.
  const buildFxUnit = (
    kind: 'FEE' | 'TAX',
    sameDepUnits: number,
    fxAmount: number | undefined,
    fxCurrency: string | undefined,
  ): UnitInsert | null => {
    if (fxAmount && fxAmount > 0 && fx) {
      const rateDec = new Decimal(fx.rate);
      const totalDepUnits = sameDepUnits +
        new Decimal(fxAmount).div(rateDec).toNumber();
      const totalDepHecto = Math.round(
        parseFloat(new Decimal(totalDepUnits).times(100).toPrecision(15)),
      );
      const fxHecto = Math.round(
        parseFloat(new Decimal(fxAmount).times(100).toPrecision(15)),
      );
      return makeUnit(xactId, kind, totalDepHecto, depositCurrency, {
        amount: fxHecto,
        currency: fxCurrency ?? fx.securityCurrency,
        rate: fx.rate,
      });
    }
    const depHecto = Math.round(
      parseFloat(new Decimal(sameDepUnits).times(100).toPrecision(15)),
    );
    if (depHecto > 0) {
      return makeUnit(xactId, kind, depHecto, depositCurrency);
    }
    return null;
  };

  switch (type) {
    case TransactionType.BUY:
    case TransactionType.SELL: {
      const fee = buildFxUnit('FEE', feesDepUnits, fx?.feesFx, fx?.feesCurrency);
      if (fee) out.push(fee);
      const tax = buildFxUnit('TAX', taxesDepUnits, fx?.taxesFx, fx?.taxesCurrency);
      if (tax) out.push(tax);
      break;
    }
    case TransactionType.DELIVERY_INBOUND:
    case TransactionType.DELIVERY_OUTBOUND: {
      const depHecto = toHecto(feesDepUnits);
      if (depHecto > 0) out.push(makeUnit(xactId, 'FEE', depHecto, depositCurrency));
      break;
    }
    case TransactionType.DIVIDEND: {
      const tDepHecto = toHecto(taxesDepUnits);
      const fDepHecto = toHecto(feesDepUnits);
      if (tDepHecto > 0) out.push(makeUnit(xactId, 'TAX', tDepHecto, depositCurrency));
      if (fDepHecto > 0) out.push(makeUnit(xactId, 'FEE', fDepHecto, depositCurrency));
      break;
    }
    case TransactionType.SECURITY_TRANSFER: {
      const depHecto = toHecto(feesDepUnits);
      if (depHecto > 0) out.push(makeUnit(xactId, 'FEE', depHecto, depositCurrency));
      break;
    }
    case TransactionType.INTEREST:
    case TransactionType.INTEREST_CHARGE: {
      const tDepHecto = toHecto(taxesDepUnits);
      const fDepHecto = toHecto(feesDepUnits);
      if (tDepHecto > 0) out.push(makeUnit(xactId, 'TAX', tDepHecto, depositCurrency));
      if (fDepHecto > 0) out.push(makeUnit(xactId, 'FEE', fDepHecto, depositCurrency));
      break;
    }
    case TransactionType.DEPOSIT:
    case TransactionType.REMOVAL: {
      const fDepHecto = toHecto(feesDepUnits);
      const tDepHecto = toHecto(taxesDepUnits);
      if (fDepHecto > 0) out.push(makeUnit(xactId, 'FEE', fDepHecto, depositCurrency));
      if (tDepHecto > 0) out.push(makeUnit(xactId, 'TAX', tDepHecto, depositCurrency));
      break;
    }
    default:
      break;
  }
  return out;
}

function makeUnit(
  xact: string,
  type: 'FEE' | 'TAX' | 'FOREX',
  amount: number,
  currency: string,
  forex?: { amount: number; currency: string; rate: string },
): UnitInsert {
  return {
    xact,
    type,
    amount,
    currency,
    forex_amount: forex?.amount ?? null,
    forex_currency: forex?.currency ?? null,
    exchangeRate: forex?.rate ?? null,
  };
}

// ─── Mapper ───────────────────────────────────────

export function mapTradeRows(
  rows: NormalizedTradeRow[],
  ctx: TradeMapperContext,
): TradeMapResult {
  const transactions: XactInsert[] = [];
  const crossEntries: CrossEntryInsert[] = [];
  const units: UnitInsert[] = [];
  const errors: RowError[] = [];

  for (const row of rows) {
    const txType = row.type as TransactionType;

    // Validate: shares required for Group A + C
    if (SHARE_REQUIRED_TYPES.has(txType) && (row.shares == null || row.shares <= 0)) {
      errors.push({
        row: row.rowNumber,
        column: 'shares',
        code: 'MISSING_SHARES',
        message: 'csvImport.errors.missingShares',
      });
      continue;
    }

    // Resolve security
    const securityId = row.securityName ? (ctx.securityMap.get(row.securityName) ?? null) : null;

    // Validate: security required for dividend + buy/sell + delivery
    if (SECURITY_REQUIRED_TYPES.has(txType) && !securityId) {
      errors.push({
        row: row.rowNumber,
        column: 'security',
        value: row.securityName,
        code: 'MISSING_SECURITY',
        message: 'csvImport.errors.missingSecurity',
      });
      continue;
    }

    // Cross-currency gate: BUY/SELL/TRANSFER_BETWEEN_ACCOUNTS must carry
    // an explicit fxRate when the row's two relevant currencies differ.
    // The mapper sees only what the service has already resolved into
    // `securityCurrencyMap` / `accountCurrencyMap`; pending-new
    // securities are absent from securityCurrencyMap on preview and
    // therefore skip the gate (caught at execute time after the new
    // securities exist).
    if (CROSS_CURRENCY_FX_TYPES.has(txType)) {
      const cross = resolveCrossCurrency(row, securityId, txType, ctx);
      if (cross && cross.isCrossCurrency && row.fxRate == null) {
        errors.push({
          row: row.rowNumber,
          column: 'fxRate',
          code: 'FX_RATE_REQUIRED',
          message: 'csvImport.errors.fxRateRequired',
        });
        continue;
      }
    }

    const grossAmount = new Decimal(Math.abs(row.amount));
    const fees = new Decimal(row.fees ?? 0);
    const taxes = new Decimal(row.taxes ?? 0);
    const currency = row.currency ?? ctx.portfolioCurrency;

    const netAmount = computeNetAmountHecto(txType, grossAmount, fees, taxes);
    const sharesDb = row.shares != null ? toSharesDb(row.shares) : 0;
    const feesDb = toHecto(row.fees ?? 0);
    const taxesDb = toHecto(row.taxes ?? 0);

    if (GROUP_A_DUAL_ENTRY.has(txType)) {
      // Securities-side row (source — owns the units)
      const secXactId = uuidv4();
      transactions.push({
        id: secXactId,
        type: txType,
        date: row.date,
        currency,
        amount: netAmount,
        shares: sharesDb,
        note: row.note ?? null,
        securityId,
        accountId: ctx.portfolioId,
        acctype: 'portfolio',
        source: 'CSV_IMPORT',
        fees: feesDb,
        taxes: taxesDb,
      });

      // Cash-side shadow row
      const cashXactId = uuidv4();
      transactions.push({
        id: cashXactId,
        type: txType,
        date: row.date,
        currency,
        amount: netAmount,
        shares: 0,
        note: row.note ?? null,
        securityId,
        accountId: ctx.depositAccountId,
        acctype: 'account',
        source: 'CSV_IMPORT',
        fees: 0,
        taxes: 0,
      });

      // Cross-entry
      crossEntries.push({
        fromXact: secXactId,
        fromAcc: ctx.portfolioId,
        toXact: cashXactId,
        toAcc: ctx.depositAccountId,
        type: 'buysell',
      });

      // FEE/TAX units on the source row. Pass the `fx` bag when cross-currency
      // so emitFeeTaxUnits can apply FOREX decoration mirroring
      // transaction.service.ts:247-270. Fallback chain for fee/tax currency:
      // per-column override → currencyGrossAmount column → resolved security ccy.
      const securityCurrency = securityId
        ? (ctx.securityCurrencyMap?.get(securityId) ?? currency)
        : currency;
      units.push(...emitFeeTaxUnits(
        secXactId, txType,
        row.fees ?? 0, row.taxes ?? 0,
        currency,
        row.fxRate != null && securityCurrency !== currency
          ? {
              feesFx: row.feesFx,
              taxesFx: row.taxesFx,
              feesCurrency: row.feesCurrency ?? row.currencyGrossAmount ?? securityCurrency,
              taxesCurrency: row.taxesCurrency ?? row.currencyGrossAmount ?? securityCurrency,
              rate: String(row.fxRate),
              securityCurrency,
            }
          : undefined,
      ));

      // FOREX unit when cross-currency. Mirrors transaction.service.ts
      // buildUnits 256-265:
      //   amount       = deposit-ccy gross hecto (row.amount × 100)
      //   forex_amount = security-ccy gross hecto = deposit × qvRate × 100
      //   exchangeRate = String(qvFxRate)
      // Prefer the user-supplied `grossAmount` over a back-computed value to
      // avoid the rate-rounding drift (PP rates are typically 4-decimal).
      if (row.fxRate != null && securityId) {
        const secCcy = ctx.securityCurrencyMap?.get(securityId);
        if (secCcy && secCcy !== currency) {
          const grossDepHecto = toHecto(Math.abs(row.amount));
          const grossSecHecto = row.grossAmount != null
            ? toHecto(row.grossAmount)
            : Math.round(parseFloat(
                new Decimal(Math.abs(row.amount)).times(row.fxRate).times(100).toPrecision(15),
              ));
          units.push(makeUnit(secXactId, 'FOREX', grossDepHecto, currency, {
            amount: grossSecHecto,
            currency: secCcy,
            rate: String(row.fxRate),
          }));
        }
      }
    } else if (GROUP_B_CASH_ONLY.has(txType)) {
      const xactId = uuidv4();
      transactions.push({
        id: xactId,
        type: txType,
        date: row.date,
        currency,
        amount: netAmount,
        shares: 0,
        note: row.note ?? null,
        securityId,
        accountId: ctx.depositAccountId,
        acctype: 'account',
        source: 'CSV_IMPORT',
        fees: feesDb,
        taxes: taxesDb,
      });
      units.push(...emitFeeTaxUnits(xactId, txType, row.fees ?? 0, row.taxes ?? 0, currency));
    } else if (GROUP_C_SHARES_ONLY.has(txType)) {
      const xactId = uuidv4();
      transactions.push({
        id: xactId,
        type: txType,
        date: row.date,
        currency,
        amount: netAmount,
        shares: sharesDb,
        note: row.note ?? null,
        securityId,
        accountId: ctx.portfolioId,
        acctype: 'portfolio',
        source: 'CSV_IMPORT',
        fees: feesDb,
        taxes: taxesDb,
      });
      units.push(...emitFeeTaxUnits(xactId, txType, row.fees ?? 0, row.taxes ?? 0, currency));
    } else if (GROUP_D_SECURITY_TRANSFER.has(txType)) {
      // SECURITY_TRANSFER: 2 xact rows (portfolio→portfolio) + 1 cross-entry
      if (!row.crossAccountId) {
        errors.push({
          row: row.rowNumber,
          column: 'crossAccountId',
          code: 'MISSING_CROSS_ACCOUNT',
          message: 'csvImport.errors.missingCrossAccount',
        });
        continue;
      }

      // Source row: TRANSFER_OUT on source portfolio
      const srcXactId = uuidv4();
      transactions.push({
        id: srcXactId,
        type: 'TRANSFER_OUT',
        date: row.date,
        currency,
        amount: netAmount,
        shares: sharesDb,
        note: row.note ?? null,
        securityId,
        accountId: ctx.portfolioId,
        acctype: 'portfolio',
        source: 'CSV_IMPORT',
        fees: feesDb,
        taxes: taxesDb,
      });

      // Destination row: TRANSFER_IN on destination portfolio
      const destXactId = uuidv4();
      transactions.push({
        id: destXactId,
        type: 'TRANSFER_IN',
        date: row.date,
        currency,
        amount: netAmount,
        shares: sharesDb,
        note: row.note ?? null,
        securityId,
        accountId: row.crossAccountId,
        acctype: 'portfolio',
        source: 'CSV_IMPORT',
        fees: 0,
        taxes: 0,
      });

      // Cross-entry: portfolio-transfer
      crossEntries.push({
        fromXact: srcXactId,
        fromAcc: ctx.portfolioId,
        toXact: destXactId,
        toAcc: row.crossAccountId,
        type: 'portfolio-transfer',
      });

      // FEE units on source (SECURITY_TRANSFER per buildUnits 290-292)
      units.push(...emitFeeTaxUnits(srcXactId, txType, row.fees ?? 0, row.taxes ?? 0, currency));
    } else if (GROUP_E_ACCOUNT_TRANSFER.has(txType)) {
      // TRANSFER_BETWEEN_ACCOUNTS: 2 xact rows (deposit→deposit) + 1 cross-entry
      if (!row.crossAccountId) {
        errors.push({
          row: row.rowNumber,
          column: 'crossAccountId',
          code: 'MISSING_CROSS_ACCOUNT',
          message: 'csvImport.errors.missingCrossAccount',
        });
        continue;
      }

      // Source row: TRANSFER_OUT on source deposit account.
      // NOTE: both legs carry the source-side currency, mirroring
      // transaction.service.ts:549,560. Cross-currency information lives
      // on the FOREX xact_unit (amount = src-ccy hecto, forex_amount =
      // dst-ccy hecto). Keep CSV/JSON paths byte-identical.
      const srcXactId = uuidv4();
      transactions.push({
        id: srcXactId,
        type: 'TRANSFER_OUT',
        date: row.date,
        currency,
        amount: netAmount,
        shares: 0,
        note: row.note ?? null,
        securityId: null,
        accountId: ctx.depositAccountId,
        acctype: 'account',
        source: 'CSV_IMPORT',
        fees: feesDb,
        taxes: taxesDb,
      });

      const destXactId = uuidv4();
      transactions.push({
        id: destXactId,
        type: 'TRANSFER_IN',
        date: row.date,
        currency,
        amount: netAmount,
        shares: 0,
        note: row.note ?? null,
        securityId: null,
        accountId: row.crossAccountId,
        acctype: 'account',
        source: 'CSV_IMPORT',
        fees: 0,
        taxes: 0,
      });

      crossEntries.push({
        fromXact: srcXactId,
        fromAcc: ctx.depositAccountId,
        toXact: destXactId,
        toAcc: row.crossAccountId,
        type: 'account-transfer',
      });

      // FOREX unit when cross-currency transfer. Mirrors buildUnits 293-301:
      //   amount  = src-ccy gross hecto (row.amount × 100)
      //   forex_amount = dst-ccy gross hecto
      if (row.fxRate != null) {
        const dstCcy = ctx.accountCurrencyMap?.get(row.crossAccountId);
        if (dstCcy && dstCcy !== currency) {
          const grossSrcHecto = toHecto(Math.abs(row.amount));
          // forex_amount = src-ccy amount × qvFxRate (mirrors buildUnits 295)
          const grossDstHecto = Math.round(parseFloat(
            new Decimal(Math.abs(row.amount)).times(row.fxRate).times(100).toPrecision(15),
          ));
          units.push(makeUnit(srcXactId, 'FOREX', grossSrcHecto, currency, {
            amount: grossDstHecto,
            currency: dstCcy,
            rate: String(row.fxRate),
          }));
        }
      }
    }
  }

  return { transactions, crossEntries, units, errors };
}

// Resolve the two currencies relevant to a cross-currency check for the
// given row + type. Returns null for types outside CROSS_CURRENCY_FX_TYPES.
function resolveCrossCurrency(
  row: NormalizedTradeRow,
  securityId: string | null,
  txType: TransactionType,
  ctx: TradeMapperContext,
): { isCrossCurrency: boolean; depositCurrency: string; otherCurrency: string | null } | null {
  if (txType === TransactionType.BUY || txType === TransactionType.SELL) {
    if (!securityId) return null;
    const secCcy = ctx.securityCurrencyMap?.get(securityId) ?? null;
    return {
      isCrossCurrency: !!(secCcy && secCcy !== ctx.portfolioCurrency),
      depositCurrency: ctx.portfolioCurrency,
      otherCurrency: secCcy,
    };
  }
  if (txType === TransactionType.TRANSFER_BETWEEN_ACCOUNTS) {
    if (!row.crossAccountId) return null;
    const dstCcy = ctx.accountCurrencyMap?.get(row.crossAccountId) ?? null;
    return {
      isCrossCurrency: !!(dstCcy && dstCcy !== ctx.portfolioCurrency),
      depositCurrency: ctx.portfolioCurrency,
      otherCurrency: dstCcy,
    };
  }
  return null;
}
