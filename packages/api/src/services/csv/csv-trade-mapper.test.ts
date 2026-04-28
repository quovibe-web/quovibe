// packages/api/src/services/csv/csv-trade-mapper.test.ts
import { describe, it, expect } from 'vitest';
import { mapTradeRows, type TradeMapperContext } from './csv-trade-mapper';
import { TransactionType } from '@quovibe/shared';
import type { NormalizedTradeRow } from '@quovibe/shared';

const ctx: TradeMapperContext = {
  portfolioId: 'port-1',
  depositAccountId: 'dep-1',
  portfolioCurrency: 'EUR',
  securityMap: new Map([
    ['Apple Inc', 'sec-apple'],
    ['BASF', 'sec-basf'],
  ]),
  // Same-currency by default — cross-ccy tests below override per-test.
  securityCurrencyMap: new Map([
    ['sec-apple', 'EUR'],
    ['sec-basf', 'EUR'],
  ]),
  accountCurrencyMap: new Map(),
};

describe('mapTradeRows', () => {
  describe('Group A — BUY/SELL (dual-entry)', () => {
    it('BUY produces 2 xact rows + 1 cross-entry', () => {
      const rows: NormalizedTradeRow[] = [{
        rowNumber: 1,
        date: '2024-01-15',
        type: TransactionType.BUY,
        securityName: 'Apple Inc',
        shares: 10,
        amount: 1500,
        fees: 5,
        taxes: 2,
      }];

      const result = mapTradeRows(rows, ctx);
      expect(result.errors).toHaveLength(0);
      expect(result.transactions).toHaveLength(2);
      expect(result.crossEntries).toHaveLength(1);

      // Securities-side row
      const secRow = result.transactions[0];
      expect(secRow.type).toBe('BUY');
      expect(secRow.accountId).toBe('port-1');
      expect(secRow.securityId).toBe('sec-apple');
      expect(secRow.shares).toBe(1000000000); // 10 * 10^8
      // Net amount for BUY = (gross + fees + taxes) * 100 = (1500 + 5 + 2) * 100
      expect(secRow.amount).toBe(150700);
      expect(secRow.acctype).toBe('portfolio');
      expect(secRow.fees).toBe(500); // 5 * 100
      expect(secRow.taxes).toBe(200); // 2 * 100

      // Cash-side row (shadow)
      const cashRow = result.transactions[1];
      expect(cashRow.type).toBe('BUY');
      expect(cashRow.accountId).toBe('dep-1');
      expect(cashRow.securityId).toBe('sec-apple'); // D4 fix: security on cash-side
      expect(cashRow.shares).toBe(0);
      expect(cashRow.amount).toBe(150700); // same net amount
      expect(cashRow.acctype).toBe('account');
      expect(cashRow.fees).toBe(0); // no fees on cash-side
      expect(cashRow.taxes).toBe(0);

      // Cross-entry
      const ce = result.crossEntries[0];
      expect(ce.fromXact).toBe(secRow.id);
      expect(ce.fromAcc).toBe('port-1');
      expect(ce.toXact).toBe(cashRow.id);
      expect(ce.toAcc).toBe('dep-1');
      expect(ce.type).toBe('buysell');
    });

    it('SELL produces 2 xact rows with inflow net amount', () => {
      const rows: NormalizedTradeRow[] = [{
        rowNumber: 1,
        date: '2024-02-01',
        type: TransactionType.SELL,
        securityName: 'BASF',
        shares: 5,
        amount: 800,
        fees: 10,
        taxes: 3,
      }];

      const result = mapTradeRows(rows, ctx);
      expect(result.transactions).toHaveLength(2);

      // SELL inflow: net = (gross - fees - taxes) * 100 = (800 - 10 - 3) * 100
      expect(result.transactions[0].amount).toBe(78700);
    });

    it('BUY without shares produces a row error', () => {
      const rows: NormalizedTradeRow[] = [{
        rowNumber: 3,
        date: '2024-01-15',
        type: TransactionType.BUY,
        securityName: 'Apple Inc',
        amount: 1500,
        // shares is missing
      }];

      const result = mapTradeRows(rows, ctx);
      expect(result.transactions).toHaveLength(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].code).toBe('MISSING_SHARES');
      expect(result.errors[0].row).toBe(3);
    });
  });

  describe('Group B — cash-only (deposit account)', () => {
    it('DEPOSIT produces 1 xact row on deposit account', () => {
      const rows: NormalizedTradeRow[] = [{
        rowNumber: 1,
        date: '2024-01-10',
        type: TransactionType.DEPOSIT,
        securityName: '',
        amount: 5000,
      }];

      const result = mapTradeRows(rows, ctx);
      expect(result.transactions).toHaveLength(1);
      expect(result.crossEntries).toHaveLength(0);

      const row = result.transactions[0];
      expect(row.type).toBe('DEPOSIT');
      expect(row.accountId).toBe('dep-1');
      expect(row.amount).toBe(500000); // 5000 * 100
      expect(row.shares).toBe(0);
      expect(row.acctype).toBe('account');
    });

    it('DIVIDEND requires securityId', () => {
      const rows: NormalizedTradeRow[] = [{
        rowNumber: 5,
        date: '2024-03-15',
        type: TransactionType.DIVIDEND,
        securityName: 'Unknown Corp',
        amount: 50,
      }];

      const result = mapTradeRows(rows, ctx);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].code).toBe('MISSING_SECURITY');
    });

    it('DIVIDEND with known security maps to deposit', () => {
      const rows: NormalizedTradeRow[] = [{
        rowNumber: 1,
        date: '2024-03-15',
        type: TransactionType.DIVIDEND,
        securityName: 'Apple Inc',
        amount: 50,
      }];

      const result = mapTradeRows(rows, ctx);
      expect(result.transactions).toHaveLength(1);
      expect(result.transactions[0].accountId).toBe('dep-1');
      expect(result.transactions[0].securityId).toBe('sec-apple');
    });
  });

  describe('Group C — shares-only (portfolio account)', () => {
    it('DELIVERY_INBOUND produces 1 xact row on portfolio account', () => {
      const rows: NormalizedTradeRow[] = [{
        rowNumber: 1,
        date: '2024-04-01',
        type: TransactionType.DELIVERY_INBOUND,
        securityName: 'Apple Inc',
        shares: 20,
        amount: 3000,
      }];

      const result = mapTradeRows(rows, ctx);
      expect(result.transactions).toHaveLength(1);
      expect(result.crossEntries).toHaveLength(0);

      const row = result.transactions[0];
      expect(row.type).toBe('DELIVERY_INBOUND');
      expect(row.accountId).toBe('port-1');
      expect(row.shares).toBe(2000000000); // 20 * 10^8
      expect(row.acctype).toBe('portfolio');
    });
  });

  describe('Amount sign normalization', () => {
    it('takes absolute value of negative amounts', () => {
      const rows: NormalizedTradeRow[] = [{
        rowNumber: 1,
        date: '2024-01-15',
        type: TransactionType.BUY,
        securityName: 'Apple Inc',
        shares: 10,
        amount: -1500, // negative = cash outflow convention
      }];

      const result = mapTradeRows(rows, ctx);
      expect(result.transactions[0].amount).toBe(150000); // abs(1500) * 100
    });
  });

  describe('Net amount convention — ppxml2db alignment', () => {
    it('DELIVERY_INBOUND with fees/taxes: outflow → net = (gross + fees + taxes) * 100', () => {
      const rows: NormalizedTradeRow[] = [{
        rowNumber: 1,
        date: '2024-04-01',
        type: TransactionType.DELIVERY_INBOUND,
        securityName: 'Apple Inc',
        shares: 20,
        amount: 3000,
        fees: 15,
        taxes: 5,
      }];

      const result = mapTradeRows(rows, ctx);
      expect(result.errors).toHaveLength(0);
      expect(result.transactions).toHaveLength(1);
      // Outflow: net = (3000 + 15 + 5) * 100 = 302000
      expect(result.transactions[0].amount).toBe(302000);
    });

    it('DELIVERY_OUTBOUND with fees/taxes: inflow → net = (gross - fees - taxes) * 100', () => {
      const rows: NormalizedTradeRow[] = [{
        rowNumber: 1,
        date: '2024-04-01',
        type: TransactionType.DELIVERY_OUTBOUND,
        securityName: 'Apple Inc',
        shares: 20,
        amount: 3000,
        fees: 15,
        taxes: 5,
      }];

      const result = mapTradeRows(rows, ctx);
      expect(result.errors).toHaveLength(0);
      expect(result.transactions).toHaveLength(1);
      // Inflow: net = (3000 - 15 - 5) * 100 = 298000
      expect(result.transactions[0].amount).toBe(298000);
    });

    it('INTEREST_CHARGE with fees/taxes: outflow → net = (gross + fees + taxes) * 100', () => {
      const rows: NormalizedTradeRow[] = [{
        rowNumber: 1,
        date: '2024-04-01',
        type: TransactionType.INTEREST_CHARGE,
        securityName: '',
        amount: 200,
        fees: 10,
        taxes: 3,
      }];

      const result = mapTradeRows(rows, ctx);
      expect(result.errors).toHaveLength(0);
      expect(result.transactions).toHaveLength(1);
      // Outflow: net = (200 + 10 + 3) * 100 = 21300
      expect(result.transactions[0].amount).toBe(21300);
    });

    it('INTEREST with fees/taxes: inflow → net = (gross - fees - taxes) * 100', () => {
      const rows: NormalizedTradeRow[] = [{
        rowNumber: 1,
        date: '2024-04-01',
        type: TransactionType.INTEREST,
        securityName: '',
        amount: 200,
        fees: 10,
        taxes: 3,
      }];

      const result = mapTradeRows(rows, ctx);
      expect(result.errors).toHaveLength(0);
      expect(result.transactions).toHaveLength(1);
      // Inflow: net = (200 - 10 - 3) * 100 = 18700
      expect(result.transactions[0].amount).toBe(18700);
    });

    it('FEES with taxes: outflow → net = (gross + 0 + taxes) * 100', () => {
      const rows: NormalizedTradeRow[] = [{
        rowNumber: 1,
        date: '2024-04-01',
        type: TransactionType.FEES,
        securityName: '',
        amount: 50,
        fees: 0,
        taxes: 8,
      }];

      const result = mapTradeRows(rows, ctx);
      expect(result.errors).toHaveLength(0);
      expect(result.transactions).toHaveLength(1);
      // Outflow: net = (50 + 0 + 8) * 100 = 5800
      expect(result.transactions[0].amount).toBe(5800);
    });

    it('DEPOSIT with fees: inflow → net = (gross - fees - 0) * 100', () => {
      const rows: NormalizedTradeRow[] = [{
        rowNumber: 1,
        date: '2024-04-01',
        type: TransactionType.DEPOSIT,
        securityName: '',
        amount: 5000,
        fees: 25,
        taxes: 0,
      }];

      const result = mapTradeRows(rows, ctx);
      expect(result.errors).toHaveLength(0);
      expect(result.transactions).toHaveLength(1);
      // Inflow: net = (5000 - 25 - 0) * 100 = 497500
      expect(result.transactions[0].amount).toBe(497500);
    });

    it('REMOVAL with fees: outflow → net = (gross + fees + 0) * 100', () => {
      const rows: NormalizedTradeRow[] = [{
        rowNumber: 1,
        date: '2024-04-01',
        type: TransactionType.REMOVAL,
        securityName: '',
        amount: 5000,
        fees: 25,
        taxes: 0,
      }];

      const result = mapTradeRows(rows, ctx);
      expect(result.errors).toHaveLength(0);
      expect(result.transactions).toHaveLength(1);
      // Outflow: net = (5000 + 25 + 0) * 100 = 502500
      expect(result.transactions[0].amount).toBe(502500);
    });
  });

  describe('Group D — SECURITY_TRANSFER (dual portfolio-transfer)', () => {
    it('produces 2 xact rows + 1 portfolio-transfer cross-entry', () => {
      const rows: NormalizedTradeRow[] = [{
        rowNumber: 1,
        date: '2024-05-01',
        type: TransactionType.SECURITY_TRANSFER,
        securityName: 'Apple Inc',
        shares: 15,
        amount: 2000,
        fees: 10,
        taxes: 0,
        crossAccountId: 'port-dest',
      }];

      const result = mapTradeRows(rows, ctx);
      expect(result.errors).toHaveLength(0);
      expect(result.transactions).toHaveLength(2);
      expect(result.crossEntries).toHaveLength(1);

      // Source row: TRANSFER_OUT on source portfolio
      const srcRow = result.transactions[0];
      expect(srcRow.type).toBe('TRANSFER_OUT');
      expect(srcRow.accountId).toBe('port-1');
      expect(srcRow.acctype).toBe('portfolio');
      expect(srcRow.securityId).toBe('sec-apple');
      expect(srcRow.shares).toBe(1500000000); // 15 * 10^8
      // SECURITY_TRANSFER is INFLOW: net = (gross - fees - taxes) * 100 = (2000 - 10 - 0) * 100
      expect(srcRow.amount).toBe(199000);
      expect(srcRow.fees).toBe(1000); // 10 * 100
      expect(srcRow.taxes).toBe(0);

      // Destination row: TRANSFER_IN on destination portfolio
      const destRow = result.transactions[1];
      expect(destRow.type).toBe('TRANSFER_IN');
      expect(destRow.accountId).toBe('port-dest');
      expect(destRow.acctype).toBe('portfolio');
      expect(destRow.securityId).toBe('sec-apple');
      expect(destRow.shares).toBe(1500000000); // same shares
      expect(destRow.amount).toBe(199000); // same net amount as source
      expect(destRow.fees).toBe(0);  // no fees on destination
      expect(destRow.taxes).toBe(0);

      // Cross-entry: portfolio-transfer
      const ce = result.crossEntries[0];
      expect(ce.fromXact).toBe(srcRow.id);
      expect(ce.fromAcc).toBe('port-1');
      expect(ce.toXact).toBe(destRow.id);
      expect(ce.toAcc).toBe('port-dest');
      expect(ce.type).toBe('portfolio-transfer');
    });

    it('without crossAccountId produces MISSING_CROSS_ACCOUNT error', () => {
      const rows: NormalizedTradeRow[] = [{
        rowNumber: 7,
        date: '2024-05-01',
        type: TransactionType.SECURITY_TRANSFER,
        securityName: 'Apple Inc',
        shares: 15,
        amount: 2000,
        // no crossAccountId
      }];

      const result = mapTradeRows(rows, ctx);
      expect(result.transactions).toHaveLength(0);
      expect(result.crossEntries).toHaveLength(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].code).toBe('MISSING_CROSS_ACCOUNT');
      expect(result.errors[0].row).toBe(7);
    });
  });

  describe('Group E — TRANSFER_BETWEEN_ACCOUNTS (dual account-transfer)', () => {
    it('produces 2 xact rows + 1 account-transfer cross-entry', () => {
      const rows: NormalizedTradeRow[] = [{
        rowNumber: 1,
        date: '2024-06-01',
        type: TransactionType.TRANSFER_BETWEEN_ACCOUNTS,
        securityName: '',
        amount: 3000,
        fees: 5,
        taxes: 0,
        crossAccountId: 'dep-dest',
      }];

      const result = mapTradeRows(rows, ctx);
      expect(result.errors).toHaveLength(0);
      expect(result.transactions).toHaveLength(2);
      expect(result.crossEntries).toHaveLength(1);

      // Source row: TRANSFER_OUT on source deposit account
      const srcRow = result.transactions[0];
      expect(srcRow.type).toBe('TRANSFER_OUT');
      expect(srcRow.accountId).toBe('dep-1');
      expect(srcRow.acctype).toBe('account');
      expect(srcRow.securityId).toBeNull();
      expect(srcRow.shares).toBe(0);
      expect(srcRow.fees).toBe(500); // 5 * 100

      // Destination row: TRANSFER_IN on destination deposit account
      const destRow = result.transactions[1];
      expect(destRow.type).toBe('TRANSFER_IN');
      expect(destRow.accountId).toBe('dep-dest');
      expect(destRow.acctype).toBe('account');
      expect(destRow.securityId).toBeNull();
      expect(destRow.shares).toBe(0);
      expect(destRow.fees).toBe(0);  // no fees on destination
      expect(destRow.taxes).toBe(0);

      // Cross-entry: account-transfer
      const ce = result.crossEntries[0];
      expect(ce.fromXact).toBe(srcRow.id);
      expect(ce.fromAcc).toBe('dep-1');
      expect(ce.toXact).toBe(destRow.id);
      expect(ce.toAcc).toBe('dep-dest');
      expect(ce.type).toBe('account-transfer');
    });

    it('without crossAccountId produces MISSING_CROSS_ACCOUNT error', () => {
      const rows: NormalizedTradeRow[] = [{
        rowNumber: 9,
        date: '2024-06-01',
        type: TransactionType.TRANSFER_BETWEEN_ACCOUNTS,
        securityName: '',
        amount: 3000,
        // no crossAccountId
      }];

      const result = mapTradeRows(rows, ctx);
      expect(result.transactions).toHaveLength(0);
      expect(result.crossEntries).toHaveLength(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].code).toBe('MISSING_CROSS_ACCOUNT');
      expect(result.errors[0].row).toBe(9);
    });
  });

  describe('Multiple rows', () => {
    it('processes mixed transaction types', () => {
      const rows: NormalizedTradeRow[] = [
        { rowNumber: 1, date: '2024-01-01', type: TransactionType.DEPOSIT, securityName: '', amount: 10000 },
        { rowNumber: 2, date: '2024-01-02', type: TransactionType.BUY, securityName: 'Apple Inc', shares: 5, amount: 750 },
        { rowNumber: 3, date: '2024-01-03', type: TransactionType.DIVIDEND, securityName: 'Apple Inc', amount: 10 },
      ];

      const result = mapTradeRows(rows, ctx);
      // DEPOSIT=1 + BUY=2 + DIVIDEND=1 = 4 xact rows
      expect(result.transactions).toHaveLength(4);
      // Only BUY has cross-entry
      expect(result.crossEntries).toHaveLength(1);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('FEE/TAX xact_unit emission (parity with transaction.service.ts buildUnits)', () => {
    it('BUY with fees+taxes emits FEE+TAX units on the source row', () => {
      const rows: NormalizedTradeRow[] = [{
        rowNumber: 1,
        date: '2024-01-15',
        type: TransactionType.BUY,
        securityName: 'Apple Inc',
        shares: 10,
        amount: 1500,
        fees: 5,
        taxes: 2,
      }];

      const result = mapTradeRows(rows, ctx);
      expect(result.units).toHaveLength(2);

      const sourceXactId = result.transactions[0].id;
      const fee = result.units.find((u) => u.type === 'FEE');
      const tax = result.units.find((u) => u.type === 'TAX');
      expect(fee).toBeDefined();
      expect(tax).toBeDefined();
      expect(fee!.xact).toBe(sourceXactId);
      expect(fee!.amount).toBe(500); // 5 EUR × 100
      expect(fee!.currency).toBe('EUR');
      expect(fee!.forex_amount).toBeNull();
      expect(tax!.amount).toBe(200); // 2 EUR × 100
    });

    it('DIVIDEND with taxes emits a TAX unit only (per buildUnits matrix)', () => {
      const rows: NormalizedTradeRow[] = [{
        rowNumber: 1,
        date: '2024-03-15',
        type: TransactionType.DIVIDEND,
        securityName: 'Apple Inc',
        amount: 50,
        taxes: 8,
      }];

      const result = mapTradeRows(rows, ctx);
      expect(result.units).toHaveLength(1);
      expect(result.units[0].type).toBe('TAX');
      expect(result.units[0].amount).toBe(800);
    });

    it('SELL with taxes only emits TAX, no FEE', () => {
      const rows: NormalizedTradeRow[] = [{
        rowNumber: 1,
        date: '2024-02-01',
        type: TransactionType.SELL,
        securityName: 'BASF',
        shares: 5,
        amount: 800,
        taxes: 3,
      }];

      const result = mapTradeRows(rows, ctx);
      expect(result.units).toHaveLength(1);
      expect(result.units[0].type).toBe('TAX');
    });

    it('Same-currency BUY without fees/taxes emits zero units', () => {
      const rows: NormalizedTradeRow[] = [{
        rowNumber: 1,
        date: '2024-01-15',
        type: TransactionType.BUY,
        securityName: 'Apple Inc',
        shares: 10,
        amount: 1500,
      }];

      const result = mapTradeRows(rows, ctx);
      expect(result.units).toHaveLength(0);
    });

    it('Standalone FEES emits no FEE unit (gross is in xact.amount)', () => {
      const rows: NormalizedTradeRow[] = [{
        rowNumber: 1,
        date: '2024-04-01',
        type: TransactionType.FEES,
        securityName: '',
        amount: 50,
        fees: 0,
        taxes: 8,
      }];

      const result = mapTradeRows(rows, ctx);
      // Standalone FEES — only TAX unit, no FEE (per buildUnits 278-282)
      // …actually per the mapper's emitFeeTaxUnits switch, FEES is NOT in the
      // matrix at all, so neither FEE nor TAX is emitted from the unit table.
      // The taxes value still lands on xact.taxes per the existing mapper
      // contract — that's the pre-existing wiring this test pins.
      expect(result.units).toHaveLength(0);
    });
  });

  describe('Cross-currency gate', () => {
    const usdSecurityCtx: TradeMapperContext = {
      ...ctx,
      portfolioCurrency: 'EUR',
      securityCurrencyMap: new Map([['sec-apple', 'USD']]),
    };

    it('BUY without fxRate when security and deposit ccy differ → FX_RATE_REQUIRED, no xact', () => {
      const rows: NormalizedTradeRow[] = [{
        rowNumber: 1,
        date: '2024-01-15',
        type: TransactionType.BUY,
        securityName: 'Apple Inc',
        shares: 10,
        amount: 1500,
      }];

      const result = mapTradeRows(rows, usdSecurityCtx);
      expect(result.transactions).toHaveLength(0);
      expect(result.crossEntries).toHaveLength(0);
      expect(result.units).toHaveLength(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].code).toBe('FX_RATE_REQUIRED');
      expect(result.errors[0].column).toBe('fxRate');
    });

    it('SELL without fxRate when security and deposit ccy differ → FX_RATE_REQUIRED', () => {
      const rows: NormalizedTradeRow[] = [{
        rowNumber: 7,
        date: '2024-02-01',
        type: TransactionType.SELL,
        securityName: 'Apple Inc',
        shares: 5,
        amount: 800,
      }];

      const result = mapTradeRows(rows, usdSecurityCtx);
      expect(result.transactions).toHaveLength(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].code).toBe('FX_RATE_REQUIRED');
    });

    it('Same-currency BUY (sec.currency === portfolioCurrency) takes the happy path', () => {
      const rows: NormalizedTradeRow[] = [{
        rowNumber: 1,
        date: '2024-01-15',
        type: TransactionType.BUY,
        securityName: 'Apple Inc',
        shares: 10,
        amount: 1500,
      }];

      // ctx.securityCurrencyMap has 'sec-apple' → 'EUR' (same as portfolio)
      const result = mapTradeRows(rows, ctx);
      expect(result.errors).toHaveLength(0);
      expect(result.transactions).toHaveLength(2);
    });

    it('Cross-ccy BUY with fxRate emits a FOREX unit on the source row', () => {
      // qvFxRate ≈ 0.923 for PP rate 1.0837 (1 USD = 1.0837 EUR per the BUY example)
      const qvFxRate = 1 / 1.0837;
      const rows: NormalizedTradeRow[] = [{
        rowNumber: 1,
        date: '2024-01-13',
        type: TransactionType.BUY,
        securityName: 'Apple Inc',
        shares: 3,
        amount: 1740.98,         // PP "Value" (deposit ccy = EUR)
        grossAmount: 1606.71,    // PP "Gross Amount" (security ccy = USD)
        fxRate: qvFxRate,
      }];

      const result = mapTradeRows(rows, usdSecurityCtx);
      expect(result.errors).toHaveLength(0);
      expect(result.transactions).toHaveLength(2);

      const forex = result.units.find((u) => u.type === 'FOREX');
      expect(forex).toBeDefined();
      expect(forex!.xact).toBe(result.transactions[0].id); // source (portfolio-side)
      expect(forex!.currency).toBe('EUR');                 // deposit ccy
      expect(forex!.amount).toBe(174098);                  // 1740.98 × 100, deposit hecto
      expect(forex!.forex_currency).toBe('USD');           // security ccy
      expect(forex!.forex_amount).toBe(160671);            // 1606.71 × 100, security hecto
      expect(forex!.exchangeRate).toBe(String(qvFxRate));
    });

    it('Cross-ccy DIVIDEND skips the gate (Group B, not in CROSS_CURRENCY_FX_TYPES)', () => {
      // Dividend with USD security on a EUR deposit is allowed; verification of
      // Gross × Rate = Value happens in the service layer, not the mapper.
      const rows: NormalizedTradeRow[] = [{
        rowNumber: 1,
        date: '2024-03-15',
        type: TransactionType.DIVIDEND,
        securityName: 'Apple Inc',
        amount: 7.5,
      }];

      const result = mapTradeRows(rows, usdSecurityCtx);
      expect(result.errors).toHaveLength(0);
      expect(result.transactions).toHaveLength(1);
    });

    it('TRANSFER_BETWEEN_ACCOUNTS without fxRate when src+dst ccy differ → FX_RATE_REQUIRED', () => {
      const transferCtx: TradeMapperContext = {
        ...ctx,
        accountCurrencyMap: new Map([['dep-dest', 'USD']]),
      };
      const rows: NormalizedTradeRow[] = [{
        rowNumber: 1,
        date: '2024-06-01',
        type: TransactionType.TRANSFER_BETWEEN_ACCOUNTS,
        securityName: '',
        amount: 3000,
        crossAccountId: 'dep-dest',
      }];

      const result = mapTradeRows(rows, transferCtx);
      expect(result.transactions).toHaveLength(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].code).toBe('FX_RATE_REQUIRED');
    });

    it('Cross-ccy TRANSFER with fxRate emits a FOREX unit on the source row', () => {
      // qvFxRate = 1.0837 → 1 EUR = 1.0837 USD; src=EUR amount 3000, dst=USD ≈ 3251.10
      const qvFxRate = 1.0837;
      const transferCtx: TradeMapperContext = {
        ...ctx,
        accountCurrencyMap: new Map([['dep-dest', 'USD']]),
      };
      const rows: NormalizedTradeRow[] = [{
        rowNumber: 1,
        date: '2024-06-01',
        type: TransactionType.TRANSFER_BETWEEN_ACCOUNTS,
        securityName: '',
        amount: 3000,
        crossAccountId: 'dep-dest',
        fxRate: qvFxRate,
      }];

      const result = mapTradeRows(rows, transferCtx);
      expect(result.errors).toHaveLength(0);
      expect(result.transactions).toHaveLength(2);
      // Both legs carry the source-side currency (parity with
      // transaction.service.ts:549,560).
      expect(result.transactions[0].currency).toBe('EUR');
      expect(result.transactions[1].currency).toBe('EUR');

      const forex = result.units.find((u) => u.type === 'FOREX');
      expect(forex).toBeDefined();
      expect(forex!.xact).toBe(result.transactions[0].id); // source
      expect(forex!.currency).toBe('EUR');
      expect(forex!.amount).toBe(300000);                   // 3000 × 100
      expect(forex!.forex_currency).toBe('USD');
      // forex_amount = src amount × qvFxRate × 100 = 3000 × 1.0837 × 100 = 325110
      expect(forex!.forex_amount).toBe(325110);
      expect(forex!.exchangeRate).toBe(String(qvFxRate));
    });

    it('Same-currency TRANSFER emits no FOREX unit', () => {
      const transferCtx: TradeMapperContext = {
        ...ctx,
        accountCurrencyMap: new Map([['dep-dest', 'EUR']]),
      };
      const rows: NormalizedTradeRow[] = [{
        rowNumber: 1,
        date: '2024-06-01',
        type: TransactionType.TRANSFER_BETWEEN_ACCOUNTS,
        securityName: '',
        amount: 3000,
        crossAccountId: 'dep-dest',
      }];

      const result = mapTradeRows(rows, transferCtx);
      expect(result.units).toHaveLength(0);
    });
  });

  describe('mapTradeRows — feesFx/taxesFx FOREX emission (BUG-124)', () => {
    // Cross-currency context: EUR portfolio, Apple with USD currency
    const usdSecCtx: TradeMapperContext = {
      ...ctx,
      portfolioCurrency: 'EUR',
      securityCurrencyMap: new Map([['sec-apple', 'USD']]),
    };

    it('emits FOREX-tagged FEE unit when feesFx is set on a cross-currency BUY', () => {
      // qv-convention: fxRate = USD-per-EUR (security-per-deposit)
      // feesFx = 5 USD, fxRate = 0.92
      // totalFeesDeposit = 0 + (5 / 0.92) = 5.4348 EUR
      // feesDepHecto = round(5.4348 * 100) = 543
      // forex_amount = round(5 * 100) = 500
      const rows: NormalizedTradeRow[] = [{
        rowNumber: 1,
        date: '2026-01-15',
        type: TransactionType.BUY,
        securityName: 'Apple Inc',
        shares: 10,
        amount: 1500,         // EUR net (deposit ccy)
        currency: 'EUR',
        feesFx: 5,            // 5 USD broker fee (security ccy)
        fxRate: 0.92,         // qv-convention: USD per EUR
        grossAmount: 1380,    // 1500 * 0.92 USD gross
        currencyGrossAmount: 'USD',
      }];

      const result = mapTradeRows(rows, usdSecCtx);
      expect(result.errors).toHaveLength(0);

      const feeUnit = result.units.find(u => u.type === 'FEE');
      expect(feeUnit).toBeDefined();
      // forex_amount = round(feesFx * 100) = round(5 * 100) = 500
      expect(feeUnit!.forex_amount).toBe(500);
      expect(feeUnit!.forex_currency).toBe('USD');
      expect(feeUnit!.exchangeRate).toBe('0.92');
      // amount = round((0 + 5/0.92) * 100) = round(543.478...) = 543
      expect(feeUnit!.amount).toBe(543);
      expect(feeUnit!.currency).toBe('EUR');
      // FEE must be on the securities-side xact, not the cash-side
      expect(feeUnit!.xact).toBe(result.transactions[0].id);
    });

    it('emits FOREX-tagged TAX unit when taxesFx is set on a cross-currency SELL', () => {
      // taxesFx = 2 USD, fxRate = 0.92
      // totalTaxesDeposit = 0 + (2 / 0.92) = 2.1739 EUR
      // taxesDepHecto = round(2.1739 * 100) = 217
      // forex_amount = round(2 * 100) = 200
      const rows: NormalizedTradeRow[] = [{
        rowNumber: 1,
        date: '2026-01-15',
        type: TransactionType.SELL,
        securityName: 'Apple Inc',
        shares: 10,
        amount: 1500,
        currency: 'EUR',
        taxesFx: 2,           // 2 USD withholding (security ccy)
        fxRate: 0.92,
        currencyGrossAmount: 'USD',
      }];

      const result = mapTradeRows(rows, usdSecCtx);
      expect(result.errors).toHaveLength(0);

      const taxUnit = result.units.find(u => u.type === 'TAX');
      expect(taxUnit).toBeDefined();
      expect(taxUnit!.forex_amount).toBe(200);
      expect(taxUnit!.forex_currency).toBe('USD');
      expect(taxUnit!.exchangeRate).toBe('0.92');
      // amount = round((0 + 2/0.92) * 100) = round(217.391...) = 217
      expect(taxUnit!.amount).toBe(217);
    });

    it('sums deposit fees + feesFx/fxRate correctly when both are provided (rounding parity with transaction.service.ts)', () => {
      // fees = 3 EUR, feesFx = 5 USD, fxRate = 0.92
      // totalFeesDeposit = 3 + (5/0.92) = 3 + 5.4348 = 8.4348 EUR
      // feesDepHecto = round(8.4348 * 100) = 843
      // forex_amount = round(5 * 100) = 500
      const rows: NormalizedTradeRow[] = [{
        rowNumber: 1,
        date: '2026-01-15',
        type: TransactionType.BUY,
        securityName: 'Apple Inc',
        shares: 10,
        amount: 1500,
        currency: 'EUR',
        fees: 3,              // 3 EUR same-currency fees
        feesFx: 5,            // 5 USD broker fee
        fxRate: 0.92,
        grossAmount: 1380,
        currencyGrossAmount: 'USD',
      }];

      const result = mapTradeRows(rows, usdSecCtx);
      expect(result.errors).toHaveLength(0);

      const feeUnit = result.units.find(u => u.type === 'FEE');
      expect(feeUnit).toBeDefined();
      expect(feeUnit!.forex_amount).toBe(500);
      expect(feeUnit!.forex_currency).toBe('USD');
      // amount = round((3 + 5/0.92) * 100) = round(843.478...) = 843
      expect(feeUnit!.amount).toBe(843);
    });

    it('does NOT emit FOREX FEE/TAX on same-currency BUY (regression guard)', () => {
      // Same-currency: VWCE is EUR, portfolio is EUR → no FX decoration
      const rows: NormalizedTradeRow[] = [{
        rowNumber: 1,
        date: '2026-01-15',
        type: TransactionType.BUY,
        securityName: 'Apple Inc',
        shares: 10,
        amount: 1100,
        fees: 5,
        taxes: 1,
        currency: 'EUR',
        // sec-apple is EUR in ctx.securityCurrencyMap, same as portfolio
      }];

      // Use the default ctx (sec-apple → EUR, portfolio → EUR)
      const result = mapTradeRows(rows, ctx);
      expect(result.errors).toHaveLength(0);

      const feeUnit = result.units.find(u => u.type === 'FEE');
      expect(feeUnit).toBeDefined();
      expect(feeUnit!.forex_amount).toBeNull();
      expect(feeUnit!.forex_currency).toBeNull();
      expect(feeUnit!.exchangeRate).toBeNull();

      const taxUnit = result.units.find(u => u.type === 'TAX');
      expect(taxUnit).toBeDefined();
      expect(taxUnit!.forex_amount).toBeNull();
    });
  });
});
