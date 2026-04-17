import { v4 as uuidv4 } from 'uuid';
import Decimal from 'decimal.js';
import type BetterSqlite3 from 'better-sqlite3';
import { TransactionType } from '@quovibe/shared';
import type { CreateTransactionInput } from '@quovibe/shared';
import { convertTransactionToDb } from './unit-conversion';
import { getRate } from './fx.service';

type UnitType = 'FEE' | 'TAX' | 'FOREX';

// ppxml2db convention (see docs/pp-reference/calculation-model.md Section 2):
//   Outflow/debit types: amount = gross + fees + taxes
//   Inflow/credit types: amount = gross - fees - taxes
const OUTFLOW_TX_TYPES: ReadonlySet<string> = new Set([
  TransactionType.BUY,
  TransactionType.DELIVERY_INBOUND,
  TransactionType.REMOVAL,
  TransactionType.INTEREST_CHARGE,
  TransactionType.FEES,
  TransactionType.TAXES,
  TransactionType.TRANSFER_BETWEEN_ACCOUNTS,
]);
const INFLOW_TX_TYPES: ReadonlySet<string> = new Set([
  TransactionType.SELL,
  TransactionType.DIVIDEND,
  TransactionType.DELIVERY_OUTBOUND,
  TransactionType.DEPOSIT,
  TransactionType.INTEREST,
  TransactionType.FEES_REFUND,
  TransactionType.TAX_REFUND,
  TransactionType.SECURITY_TRANSFER,
]);

function computeNetAmountDb(
  type: TransactionType,
  grossAmount: number,
  fees: number,
  taxes: number,
): number {
  const g = new Decimal(grossAmount);
  const f = new Decimal(fees);
  const t = new Decimal(taxes);
  let net: Decimal;
  if (OUTFLOW_TX_TYPES.has(type)) {
    net = g.plus(f).plus(t);
  } else if (INFLOW_TX_TYPES.has(type)) {
    net = g.minus(f).minus(t);
  } else {
    net = g;
  }
  return Math.round(parseFloat(net.times(100).toPrecision(15)));
}

// Maps quovibe enum values back to ppxml2db DB type strings
const TYPE_MAP_TO_PPXML2DB: Record<string, string> = {
  TRANSFER_BETWEEN_ACCOUNTS: 'TRANSFER_OUT',
  DELIVERY_INBOUND: 'TRANSFER_IN',
  DELIVERY_OUTBOUND: 'TRANSFER_OUT',
  SECURITY_TRANSFER: 'TRANSFER_OUT',   // GAP-02: source row maps to TRANSFER_OUT
  DIVIDEND: 'DIVIDENDS',
};

function toDbType(type: string): string {
  return TYPE_MAP_TO_PPXML2DB[type] ?? type;
}

// P2: mappa il tipo transazione alla convenzione ppxml2db per xact_cross_entry.type
function toCrossEntryType(txType: string): string {
  switch (txType) {
    case 'BUY':
    case 'SELL':
    case 'DIVIDEND':
      return 'buysell';
    case 'TRANSFER_BETWEEN_ACCOUNTS':
      return 'account-transfer';
    case 'SECURITY_TRANSFER':
      return 'portfolio-transfer';
    default:
      return 'buysell'; // fallback sicuro
  }
}

const CASH_ONLY_TYPES = new Set<TransactionType>([
  TransactionType.DEPOSIT, TransactionType.REMOVAL, TransactionType.DIVIDEND,
  TransactionType.INTEREST, TransactionType.INTEREST_CHARGE,
  TransactionType.FEES, TransactionType.FEES_REFUND,
  TransactionType.TAXES, TransactionType.TAX_REFUND,
]);

// These types create a second "destination" xact row linked via xact_cross_entry
const DUAL_ENTRY_TYPES = new Set<TransactionType>([
  TransactionType.BUY,
  TransactionType.SELL,
  TransactionType.SECURITY_TRANSFER,
  TransactionType.TRANSFER_BETWEEN_ACCOUNTS,
]);

const BUY_SELL_TYPES = new Set<TransactionType>([TransactionType.BUY, TransactionType.SELL]);

// BUG-50: short-window natural-key dedupe for POST /transactions.
// Catches in-flight races (5-parallel POST, double-click, multi-tab resubmit,
// browser-back resubmit) without blocking legitimate duplicates entered more
// than DEDUPE_WINDOW_MS apart. The window is intentionally small — the goal is
// to absorb network/UI races, not to prevent a user from entering two real
// identical deposits minutes apart. CSV import has its own direct-insert path
// in csv-import.service.ts and is intentionally not affected — broker
// statements legitimately ingest identical rows.
export const DEDUPE_WINDOW_MS = 2000;

interface CrossEntry {
  fromAcc: string;
  toAcc: string | null;
}

interface ResolvedAccount {
  effectiveAccountId: string;
  acctype: string | null;
  currency: string | null;
}

function resolveAccountTarget(
  sqlite: BetterSqlite3.Database,
  accountId: string,
  type: TransactionType,
  acctRow: { type: string; currency: string | null; referenceAccount: string | null } | undefined,
): ResolvedAccount {
  if (acctRow?.type === 'portfolio' && CASH_ONLY_TYPES.has(type)) {
    if (!acctRow.referenceAccount) {
      throw Object.assign(
        new Error('Securities account has no linked deposit account'),
        { statusCode: 400 },
      );
    }
    const refRow = sqlite
      .prepare('SELECT type, currency FROM account WHERE uuid = ?')
      .get(acctRow.referenceAccount) as { type: string; currency: string | null } | undefined;
    return {
      effectiveAccountId: acctRow.referenceAccount,
      acctype: refRow?.type ?? 'account',
      currency: refRow?.currency ?? null,
    };
  }
  return {
    effectiveAccountId: accountId,
    acctype: acctRow?.type ?? null,
    currency: acctRow?.currency ?? null,
  };
}

interface UnitRow {
  xact: string;
  type: UnitType;
  amount: number;
  currency: string | null;
  forex_amount: number | null;
  forex_currency: string | null;
  exchangeRate: string | null;
}

function getCrossEntries(
  sqlite: BetterSqlite3.Database,
  input: CreateTransactionInput,
): CrossEntry[] {
  const { type, accountId, crossAccountId } = input;

  const fromAcc = accountId!;
  switch (type) {
    case TransactionType.BUY:
    case TransactionType.SELL: {
      if (crossAccountId) {
        return [{ fromAcc, toAcc: crossAccountId }];
      }
      const acct = sqlite
        .prepare('SELECT referenceAccount FROM account WHERE uuid = ?')
        .get(accountId!) as { referenceAccount: string | null } | undefined;
      return [{ fromAcc, toAcc: acct?.referenceAccount ?? fromAcc }];
    }
    case TransactionType.SECURITY_TRANSFER:
    case TransactionType.TRANSFER_BETWEEN_ACCOUNTS:
      return [{ fromAcc, toAcc: crossAccountId ?? fromAcc }];
    default:
      return []; // standalone transactions do not need cross_entry rows
  }
}

function buildUnits(xactId: string, input: CreateTransactionInput): UnitRow[] {
  const units: UnitRow[] = [];
  const { type, amount, fees, taxes, currencyCode, fxRate, fxCurrencyCode } = input;
  const amt = Math.round(parseFloat(new Decimal(amount).times(100).toPrecision(15)));

  const addUnit = (unitType: UnitType, value: number, extra?: Partial<UnitRow>): void => {
    units.push({
      xact: xactId,
      type: unitType,
      amount: value,
      currency: currencyCode ?? null,
      forex_amount: null,
      forex_currency: null,
      exchangeRate: null,
      ...extra,
    });
  };

  const toDb = (n: number) => Math.round(parseFloat(new Decimal(n).times(100).toPrecision(15)));

  switch (type) {
    case TransactionType.BUY:
    case TransactionType.SELL: {
      // FEE unit — with forex fields if feesFx provided
      const totalFeesDeposit = (fees ?? 0) + (input.feesFx && fxRate
        ? new Decimal(input.feesFx).div(new Decimal(fxRate)).toNumber() : 0);
      if (totalFeesDeposit > 0) {
        const feeExtra: Partial<UnitRow> = {};
        if (input.feesFx && fxRate) {
          feeExtra.forex_amount = toDb(input.feesFx);
          feeExtra.forex_currency = fxCurrencyCode ?? null;
          feeExtra.exchangeRate = String(fxRate);
        }
        addUnit('FEE', toDb(totalFeesDeposit), feeExtra);
      }
      // TAX unit — with forex fields if taxesFx provided
      const totalTaxesDeposit = (taxes ?? 0) + (input.taxesFx && fxRate
        ? new Decimal(input.taxesFx).div(new Decimal(fxRate)).toNumber() : 0);
      if (totalTaxesDeposit > 0) {
        const taxExtra: Partial<UnitRow> = {};
        if (input.taxesFx && fxRate) {
          taxExtra.forex_amount = toDb(input.taxesFx);
          taxExtra.forex_currency = fxCurrencyCode ?? null;
          taxExtra.exchangeRate = String(fxRate);
        }
        addUnit('TAX', toDb(totalTaxesDeposit), taxExtra);
      }
      // FOREX unit — ppxml2db convention:
      //   amount = gross in deposit currency, forex_amount = gross in security currency
      //   exchangeRate = deposit→security, forex_currency = security currency
      if (fxRate) {
        const grossSecurityHecto = Math.round(
          parseFloat(new Decimal(amount).times(new Decimal(fxRate)).times(100).toPrecision(15))
        );
        addUnit('FOREX', amt, {
          forex_amount: grossSecurityHecto,
          forex_currency: fxCurrencyCode ?? null,
          exchangeRate: String(fxRate),
        });
      }
      break;
    }
    case TransactionType.DELIVERY_INBOUND:
      if (fees && fees > 0) addUnit('FEE', toDb(fees));
      break;
    case TransactionType.DELIVERY_OUTBOUND:
      if (fees && fees > 0) addUnit('FEE', toDb(fees));
      break;
    case TransactionType.DIVIDEND:
      if (taxes && taxes > 0) addUnit('TAX', toDb(taxes));
      if (fees && fees > 0) addUnit('FEE', toDb(fees));
      break;
    case TransactionType.FEES:
    case TransactionType.FEES_REFUND:
      // ppxml2db: standalone fee transactions do NOT create a FEE xact_unit;
      // the fee amount is solely in xact.amount. Only add TAX if taxes present.
      if (taxes && taxes > 0) addUnit('TAX', toDb(taxes));
      break;
    case TransactionType.TAXES:
    case TransactionType.TAX_REFUND:
      // ppxml2db: standalone tax transactions do NOT create a TAX xact_unit;
      // the tax amount is solely in xact.amount. Only add FEE if fees present.
      if (fees && fees > 0) addUnit('FEE', toDb(fees));
      break;
    case TransactionType.SECURITY_TRANSFER:
      if (fees && fees > 0) addUnit('FEE', toDb(fees));
      break;
    case TransactionType.TRANSFER_BETWEEN_ACCOUNTS:
      if (fxRate) {
        const forexAmtTransfer = Math.round(parseFloat(new Decimal(amount).times(fxRate).times(100).toPrecision(15)));
        addUnit('FOREX', amt, {
          forex_amount: forexAmtTransfer,
          forex_currency: fxCurrencyCode ?? null,
          exchangeRate: String(fxRate),
        });
      }
      break;
    case TransactionType.INTEREST:
    case TransactionType.INTEREST_CHARGE:
      if (taxes && taxes > 0) addUnit('TAX', toDb(taxes));
      if (fees && fees > 0) addUnit('FEE', toDb(fees));
      break;
    case TransactionType.DEPOSIT:
    case TransactionType.REMOVAL:
      if (fees && fees > 0) addUnit('FEE', toDb(fees));
      if (taxes && taxes > 0) addUnit('TAX', toDb(taxes));
      break;
    default:
      break;
  }

  return units;
}

function deleteTransactionDeps(sqlite: BetterSqlite3.Database, id: string): void {
  // For BUY/SELL double-entry: find cash-side xact (to_xact != from_xact) before deleting cross_entry
  const cashCounterRows = sqlite
    .prepare('SELECT to_xact FROM xact_cross_entry WHERE from_xact = ? AND to_xact != ?')
    .all(id, id) as { to_xact: string }[];

  sqlite.prepare('DELETE FROM xact_unit WHERE xact = ?').run(id);
  sqlite.prepare('DELETE FROM xact_cross_entry WHERE from_xact = ?').run(id);

  for (const { to_xact } of cashCounterRows) {
    sqlite.prepare('DELETE FROM xact_unit WHERE xact = ?').run(to_xact);
    sqlite.prepare('DELETE FROM xact WHERE uuid = ?').run(to_xact);
  }
}

function insertTransactionDeps(
  sqlite: BetterSqlite3.Database,
  xactId: string,
  input: CreateTransactionInput,
  resolvedCurrency?: string | null,
  cashXactId?: string | null,
): void {
  const insertCrossEntry = sqlite.prepare(
    'INSERT INTO xact_cross_entry (from_xact, from_acc, to_xact, to_acc, type) VALUES (?, ?, ?, ?, ?)',
  );
  const insertUnit = sqlite.prepare(
    'INSERT INTO xact_unit (xact, type, amount, currency, forex_amount, forex_currency, exchangeRate) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );

  for (const entry of getCrossEntries(sqlite, input)) {
    // BUY/SELL: to_xact points to the cash counter-entry xact; others: self-referential
    const toXact = cashXactId ?? xactId;
    insertCrossEntry.run(xactId, entry.fromAcc, toXact, entry.toAcc, toCrossEntryType(input.type));
  }

  const inputForUnits = { ...input, currencyCode: resolvedCurrency ?? input.currencyCode ?? 'EUR' };
  for (const unit of buildUnits(xactId, inputForUnits)) {
    insertUnit.run(
      unit.xact,
      unit.type,
      unit.amount,
      unit.currency,
      unit.forex_amount,
      unit.forex_currency,
      unit.exchangeRate,
    );
  }
}

export function createTransaction(
  _db: unknown,
  sqlite: BetterSqlite3.Database,
  input: CreateTransactionInput,
): string {
  const xactId = uuidv4();

  const doCreate = sqlite.transaction(() => {
    const { shares: sharesDb } = convertTransactionToDb({
      shares: input.shares != null ? new Decimal(input.shares) : null,
    });

    const acctRow = input.accountId
      ? (sqlite.prepare('SELECT type, currency, referenceAccount FROM account WHERE uuid = ?').get(input.accountId) as { type: string; currency: string | null; referenceAccount: string | null } | undefined)
      : undefined;

    const resolved = input.accountId
      ? resolveAccountTarget(sqlite, input.accountId, input.type, acctRow)
      : { effectiveAccountId: input.accountId ?? null, acctype: null, currency: null };

    const acctype = resolved.acctype ?? 'account';

    // Resolve currency for BUY/SELL: use the cash (deposit) account's currency.
    // Priority: explicit currencyCode > crossAccountId currency > referenceAccount currency > EUR
    let currency = input.currencyCode ?? resolved.currency ?? null;
    if (!currency && BUY_SELL_TYPES.has(input.type)) {
      const cashAccountId = input.crossAccountId ?? acctRow?.referenceAccount ?? null;
      if (cashAccountId) {
        const cashRow = sqlite.prepare('SELECT currency FROM account WHERE uuid = ?').get(cashAccountId) as { currency: string | null } | undefined;
        currency = cashRow?.currency ?? null;
      }
    }
    if (!currency && acctRow?.referenceAccount) {
      const refRow = sqlite.prepare('SELECT currency FROM account WHERE uuid = ?').get(acctRow.referenceAccount) as { currency: string | null } | undefined;
      currency = refRow?.currency ?? null;
    }
    if (!currency) currency = 'EUR';

    // For BUY/SELL: look up security currency for FX detection
    let securityCurrency: string | null = null;
    if (BUY_SELL_TYPES.has(input.type) && input.securityId) {
      const secRow = sqlite.prepare('SELECT currency FROM security WHERE uuid = ?').get(input.securityId) as { currency: string | null } | undefined;
      securityCurrency = secRow?.currency ?? null;
    }
    const isCrossCurrency = !!(securityCurrency && securityCurrency !== currency);

    // Cross-currency BUY/SELL: resolve exchange rate and convert amounts
    let fxInput = input;
    let grossDeposit = input.amount;
    if (isCrossCurrency && BUY_SELL_TYPES.has(input.type)) {
      const exchangeRate = input.fxRate
        ? new Decimal(input.fxRate)
        : getRate(sqlite, currency, securityCurrency!, input.date);

      if (exchangeRate && !exchangeRate.isZero()) {
        grossDeposit = new Decimal(input.amount).div(exchangeRate).toNumber();
        fxInput = {
          ...input,
          amount: grossDeposit,
          fxRate: exchangeRate.toNumber(),
          fxCurrencyCode: securityCurrency!,
        };
      }
    }

    // Compute amounts in deposit currency (after FX conversion)
    const feesFxDeposit = isCrossCurrency && input.feesFx && fxInput.fxRate
      ? new Decimal(input.feesFx).div(new Decimal(fxInput.fxRate)).toNumber()
      : 0;
    const taxesFxDeposit = isCrossCurrency && input.taxesFx && fxInput.fxRate
      ? new Decimal(input.taxesFx).div(new Decimal(fxInput.fxRate)).toNumber()
      : 0;
    const totalFees = (input.fees ?? 0) + feesFxDeposit;
    const totalTaxes = (input.taxes ?? 0) + taxesFxDeposit;

    const nextXmlid = ((sqlite.prepare('SELECT COALESCE(MAX(_xmlid), 0) + 1 AS n FROM xact').get() as { n: number }).n);
    const nextOrder = ((sqlite.prepare('SELECT COALESCE(MAX(_order), 0) + 1 AS n FROM xact').get() as { n: number }).n);

    const fromAmount = computeNetAmountDb(input.type, grossDeposit, totalFees, totalTaxes);
    const fromShares = sharesDb ?? 0;
    const feesDb = Math.round(parseFloat(new Decimal(totalFees).times(100).toPrecision(15)));
    const taxesDb = Math.round(parseFloat(new Decimal(totalTaxes).times(100).toPrecision(15)));

    // BUG-50: natural-key dedupe. If an identical row was persisted within the
    // last DEDUPE_WINDOW_MS, short-circuit and return its uuid instead of
    // inserting a second copy. SQLite `IS` is NULL-safe, so a null security
    // matches another null-security row. Dual-entry side effects (cash-side
    // row, cross_entry, units) are skipped because the earlier create already
    // produced them; the caller reads back the existing source row and sees a
    // byte-identical 201 response.
    const windowCutoff = new Date(Date.now() - DEDUPE_WINDOW_MS).toISOString();
    const dupe = sqlite
      .prepare(
        `SELECT uuid FROM xact
         WHERE account = ?
           AND date = ?
           AND type = ?
           AND amount = ?
           AND shares = ?
           AND security IS ?
           AND updatedAt >= ?
         LIMIT 1`,
      )
      .get(
        resolved.effectiveAccountId ?? null,
        input.date,
        toDbType(input.type),
        fromAmount,
        fromShares,
        input.securityId ?? null,
        windowCutoff,
      ) as { uuid: string } | undefined;
    if (dupe) return dupe.uuid;

    sqlite
      .prepare(
        'INSERT INTO xact (uuid, type, date, currency, amount, shares, note, security, account, acctype, source, updatedAt, fees, taxes, _xmlid, _order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        xactId,
        toDbType(input.type),
        input.date,
        currency,
        fromAmount,
        fromShares,
        input.note ?? null,
        input.securityId ?? null,
        resolved.effectiveAccountId ?? null,
        acctype,
        'MANUAL',
        new Date().toISOString(),
        feesDb,
        taxesDb,
        nextXmlid,
        nextOrder,
      );

    // Dual-entry: create destination row for BUY/SELL (cash side) and transfer types (dest side)
    let destXactId: string | null = null;
    if (DUAL_ENTRY_TYPES.has(input.type)) {
      if (!BUY_SELL_TYPES.has(input.type) && !input.crossAccountId) {
        const err = new Error('crossAccountId is required for transfer types') as Error & { statusCode: number };
        err.statusCode = 400;
        throw err;
      }

      // ADD: destination row type — TRANSFER_IN for account/security transfers, otherwise same as source
      const destDbType = (
        input.type === TransactionType.TRANSFER_BETWEEN_ACCOUNTS ||
        input.type === TransactionType.SECURITY_TRANSFER
      )
        ? 'TRANSFER_IN'
        : toDbType(input.type);
      // (GAP-02 extends this const for SECURITY_TRANSFER in this same block)

      // BUY/SELL → crossAccountId overrides referenceAccount; transfers → dest is crossAccountId
      const destAccountId = BUY_SELL_TYPES.has(input.type)
        ? (input.crossAccountId ?? acctRow?.referenceAccount ?? null)
        : (input.crossAccountId ?? null);

      if (destAccountId) {
        destXactId = uuidv4();
        const destAccRow = sqlite
          .prepare('SELECT type FROM account WHERE uuid = ?')
          .get(destAccountId) as { type: string } | undefined;

        const destXmlid = ((sqlite.prepare('SELECT COALESCE(MAX(_xmlid), 0) + 1 AS n FROM xact').get() as { n: number }).n);
        const destOrder = ((sqlite.prepare('SELECT COALESCE(MAX(_order), 0) + 1 AS n FROM xact').get() as { n: number }).n);

        // Destination row values:
        // BUY/SELL: shares=0, same amount in deposit currency (cash counter-entry)
        // SECURITY_TRANSFER: positive shares (inbound), amount=0, same security
        // TRANSFER_BETWEEN_ACCOUNTS: shares=0, positive amount (inbound cash)
        const destShares = input.type === TransactionType.SECURITY_TRANSFER ? (sharesDb ?? 0) : 0;
        const destAmount = fromAmount; // Both rows in deposit currency
        // D4 fix: ppxml2db stores security UUID on the cash-side row for BUY/SELL
        const destSecurity = (BUY_SELL_TYPES.has(input.type) || input.type === TransactionType.SECURITY_TRANSFER)
          ? (input.securityId ?? null) : null;

        sqlite
          .prepare('INSERT INTO xact (uuid, type, date, currency, amount, shares, note, security, account, acctype, source, updatedAt, fees, taxes, _xmlid, _order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .run(
            destXactId,
            destDbType,
            input.date,
            currency,
            destAmount,
            destShares,
            input.note ?? null,
            destSecurity,
            destAccountId,
            destAccRow?.type ?? 'account',
            'MANUAL',
            new Date().toISOString(),
            0,
            0,
            destXmlid,
            destOrder,
          );
      }
    }

    const resolvedInput = resolved.effectiveAccountId !== fxInput.accountId
      ? { ...fxInput, accountId: resolved.effectiveAccountId ?? undefined }
      : fxInput;
    insertTransactionDeps(sqlite, xactId, resolvedInput, currency, destXactId);
    return xactId;
  });

  return doCreate() as string;
}

export function updateTransaction(
  _db: unknown,
  sqlite: BetterSqlite3.Database,
  id: string,
  input: CreateTransactionInput,
): string {
  const doUpdate = sqlite.transaction(() => {
    const { shares: sharesDb } = convertTransactionToDb({
      shares: input.shares != null ? new Decimal(input.shares) : null,
    });

    const acctRow = input.accountId
      ? (sqlite.prepare('SELECT type, currency, referenceAccount FROM account WHERE uuid = ?').get(input.accountId) as { type: string; currency: string | null; referenceAccount: string | null } | undefined)
      : undefined;

    const resolved = input.accountId
      ? resolveAccountTarget(sqlite, input.accountId, input.type, acctRow)
      : { effectiveAccountId: input.accountId ?? null, acctype: null, currency: null };

    const acctype = resolved.acctype ?? 'account';

    // Resolve currency for BUY/SELL: use the cash (deposit) account's currency.
    // Priority: explicit currencyCode > crossAccountId currency > referenceAccount currency > EUR
    let currency = input.currencyCode ?? resolved.currency ?? null;
    if (!currency && BUY_SELL_TYPES.has(input.type)) {
      const cashAccountId = input.crossAccountId ?? acctRow?.referenceAccount ?? null;
      if (cashAccountId) {
        const cashRow = sqlite.prepare('SELECT currency FROM account WHERE uuid = ?').get(cashAccountId) as { currency: string | null } | undefined;
        currency = cashRow?.currency ?? null;
      }
    }
    if (!currency && acctRow?.referenceAccount) {
      const refRow = sqlite.prepare('SELECT currency FROM account WHERE uuid = ?').get(acctRow.referenceAccount) as { currency: string | null } | undefined;
      currency = refRow?.currency ?? null;
    }
    if (!currency) currency = 'EUR';

    // For BUY/SELL: look up security currency for FX detection
    let securityCurrency: string | null = null;
    if (BUY_SELL_TYPES.has(input.type) && input.securityId) {
      const secRow = sqlite.prepare('SELECT currency FROM security WHERE uuid = ?').get(input.securityId) as { currency: string | null } | undefined;
      securityCurrency = secRow?.currency ?? null;
    }
    const isCrossCurrency = !!(securityCurrency && securityCurrency !== currency);

    // Cross-currency BUY/SELL: resolve exchange rate and convert amounts
    let fxInput = input;
    let grossDeposit = input.amount;
    if (isCrossCurrency && BUY_SELL_TYPES.has(input.type)) {
      const exchangeRate = input.fxRate
        ? new Decimal(input.fxRate)
        : getRate(sqlite, currency, securityCurrency!, input.date);

      if (exchangeRate && !exchangeRate.isZero()) {
        grossDeposit = new Decimal(input.amount).div(exchangeRate).toNumber();
        fxInput = {
          ...input,
          amount: grossDeposit,
          fxRate: exchangeRate.toNumber(),
          fxCurrencyCode: securityCurrency!,
        };
      }
    }

    // Compute amounts in deposit currency (after FX conversion)
    const feesFxDeposit = isCrossCurrency && input.feesFx && fxInput.fxRate
      ? new Decimal(input.feesFx).div(new Decimal(fxInput.fxRate)).toNumber()
      : 0;
    const taxesFxDeposit = isCrossCurrency && input.taxesFx && fxInput.fxRate
      ? new Decimal(input.taxesFx).div(new Decimal(fxInput.fxRate)).toNumber()
      : 0;
    const totalFees = (input.fees ?? 0) + feesFxDeposit;
    const totalTaxes = (input.taxes ?? 0) + taxesFxDeposit;

    const fromAmountUpdate = computeNetAmountDb(input.type, grossDeposit, totalFees, totalTaxes);
    const fromSharesUpdate = sharesDb ?? 0;
    const feesDbUpdate = Math.round(parseFloat(new Decimal(totalFees).times(100).toPrecision(15)));
    const taxesDbUpdate = Math.round(parseFloat(new Decimal(totalTaxes).times(100).toPrecision(15)));

    sqlite
      .prepare(
        'UPDATE xact SET type=?, date=?, currency=?, amount=?, shares=?, note=?, security=?, account=?, acctype=?, updatedAt=?, fees=?, taxes=? WHERE uuid=?',
      )
      .run(
        toDbType(input.type),
        input.date,
        currency,
        fromAmountUpdate,
        fromSharesUpdate,
        input.note ?? null,
        input.securityId ?? null,
        resolved.effectiveAccountId ?? null,
        acctype,
        new Date().toISOString(),
        feesDbUpdate,
        taxesDbUpdate,
        id,
      );

    deleteTransactionDeps(sqlite, id);
    // Dual-entry: create destination row for BUY/SELL (cash side) and transfer types (dest side)
    let destXactId: string | null = null;
    if (DUAL_ENTRY_TYPES.has(input.type)) {
      // ADD: destination row type — TRANSFER_IN for account/security transfers, otherwise same as source
      const destDbType = (
        input.type === TransactionType.TRANSFER_BETWEEN_ACCOUNTS ||
        input.type === TransactionType.SECURITY_TRANSFER
      )
        ? 'TRANSFER_IN'
        : toDbType(input.type);

      // BUY/SELL → crossAccountId overrides referenceAccount; transfers → dest is crossAccountId
      const destAccountId = BUY_SELL_TYPES.has(input.type)
        ? (input.crossAccountId ?? acctRow?.referenceAccount ?? null)
        : (input.crossAccountId ?? null);

      if (DUAL_ENTRY_TYPES.has(input.type) && !BUY_SELL_TYPES.has(input.type) && !destAccountId) {
        const err = new Error('crossAccountId is required for transfer types') as Error & { statusCode: number };
        err.statusCode = 400;
        throw err;
      }

      if (destAccountId) {
        destXactId = uuidv4();
        const destAccRow = sqlite
          .prepare('SELECT type FROM account WHERE uuid = ?')
          .get(destAccountId) as { type: string } | undefined;

        const destXmlid = ((sqlite.prepare('SELECT COALESCE(MAX(_xmlid), 0) + 1 AS n FROM xact').get() as { n: number }).n);
        const destOrder = ((sqlite.prepare('SELECT COALESCE(MAX(_order), 0) + 1 AS n FROM xact').get() as { n: number }).n);

        // Destination row values:
        // BUY/SELL: shares=0, same amount in deposit currency (cash counter-entry)
        // SECURITY_TRANSFER: positive shares (inbound), amount=0, same security
        // TRANSFER_BETWEEN_ACCOUNTS: shares=0, positive amount (inbound cash)
        const destShares = input.type === TransactionType.SECURITY_TRANSFER ? (sharesDb ?? 0) : 0;
        const destAmount = fromAmountUpdate; // Both rows in deposit currency
        // D4 fix: ppxml2db stores security UUID on the cash-side row for BUY/SELL
        const destSecurity = (BUY_SELL_TYPES.has(input.type) || input.type === TransactionType.SECURITY_TRANSFER)
          ? (input.securityId ?? null) : null;

        sqlite
          .prepare('INSERT INTO xact (uuid, type, date, currency, amount, shares, note, security, account, acctype, source, updatedAt, fees, taxes, _xmlid, _order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .run(
            destXactId,
            destDbType,
            input.date,
            currency,
            destAmount,
            destShares,
            input.note ?? null,
            destSecurity,
            destAccountId,
            destAccRow?.type ?? 'account',
            'MANUAL',
            new Date().toISOString(),
            0,
            0,
            destXmlid,
            destOrder,
          );
      }
    }

    const resolvedInput = resolved.effectiveAccountId !== fxInput.accountId
      ? { ...fxInput, accountId: resolved.effectiveAccountId ?? undefined }
      : fxInput;
    insertTransactionDeps(sqlite, id, resolvedInput, currency, destXactId);
    return id;
  });

  return doUpdate() as string;
}

export function deleteTransaction(
  _db: unknown,
  sqlite: BetterSqlite3.Database,
  id: string,
): void {
  sqlite.transaction(() => {
    deleteTransactionDeps(sqlite, id);
    sqlite.prepare('DELETE FROM xact WHERE uuid = ?').run(id);
  })();
}
