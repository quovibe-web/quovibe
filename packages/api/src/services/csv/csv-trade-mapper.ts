// packages/api/src/services/csv/csv-trade-mapper.ts
import Decimal from 'decimal.js';
import { v4 as uuidv4 } from 'uuid';
import { TransactionType } from '@quovibe/shared';
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
  securityMap: Map<string, string>;   // csvName → securityId
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

export interface TradeMapResult {
  transactions: XactInsert[];
  crossEntries: CrossEntryInsert[];
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

function toHecto(value: number): number {
  return Math.round(parseFloat(new Decimal(value).times(100).toPrecision(15)));
}

function toSharesDb(value: number): number {
  return Math.round(parseFloat(new Decimal(value).times(1e8).toPrecision(15)));
}

// ─── Mapper ───────────────────────────────────────

export function mapTradeRows(
  rows: NormalizedTradeRow[],
  ctx: TradeMapperContext,
): TradeMapResult {
  const transactions: XactInsert[] = [];
  const crossEntries: CrossEntryInsert[] = [];
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

    const grossAmount = new Decimal(Math.abs(row.amount));
    const fees = new Decimal(row.fees ?? 0);
    const taxes = new Decimal(row.taxes ?? 0);
    const currency = row.currency ?? ctx.portfolioCurrency;

    const netAmount = computeNetAmountHecto(txType, grossAmount, fees, taxes);
    const sharesDb = row.shares != null ? toSharesDb(row.shares) : 0;
    const feesDb = toHecto(row.fees ?? 0);
    const taxesDb = toHecto(row.taxes ?? 0);

    if (GROUP_A_DUAL_ENTRY.has(txType)) {
      // Securities-side row
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
        securityId,          // D4 fix: security UUID on cash-side
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
    } else if (GROUP_B_CASH_ONLY.has(txType)) {
      transactions.push({
        id: uuidv4(),
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
    } else if (GROUP_C_SHARES_ONLY.has(txType)) {
      transactions.push({
        id: uuidv4(),
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

      // Source row: TRANSFER_OUT on source deposit account
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

      // Destination row: TRANSFER_IN on destination deposit account
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

      // Cross-entry: account-transfer
      crossEntries.push({
        fromXact: srcXactId,
        fromAcc: ctx.depositAccountId,
        toXact: destXactId,
        toAcc: row.crossAccountId,
        type: 'account-transfer',
      });
    }
  }

  return { transactions, crossEntries, errors };
}
