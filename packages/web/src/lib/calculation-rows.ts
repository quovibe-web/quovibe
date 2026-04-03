import type { CalculationBreakdownResponse } from '@quovibe/shared';

export interface RowItem {
  label: string;
  amount: string;
  subLabel?: string;
  /** If set, the component translates this key instead of using label directly */
  i18nKey?: string;
}

export interface RowDef {
  key: string;
  i18nKey: string;
  sign: '+' | '-' | '=' | '+/-';
  extractTotal: (data: CalculationBreakdownResponse) => string | null;
  extractItems?: (data: CalculationBreakdownResponse) => RowItem[];
  colorSign: boolean;
  isExpandable: boolean;
  /** Display the amount negated (e.g. fees/taxes shown as negative in red) */
  negate?: boolean;
}

export const CALCULATION_ROWS: RowDef[] = [
  {
    key: 'initialValue',
    i18nKey: 'calculation.initialValue',
    sign: '=',
    extractTotal: (d) => d.initialValue,
    colorSign: false,
    isExpandable: false,
  },
  {
    key: 'capitalGains',
    i18nKey: 'calculation.capitalGains',
    sign: '+',
    extractTotal: (d) => d.capitalGains.total,
    extractItems: (d) => d.capitalGains.items.map((item) => ({
      label: item.name,
      amount: item.unrealizedGain,
      subLabel: item.foreignCurrencyGains,
    })),
    colorSign: true,
    isExpandable: true,
  },
  {
    key: 'realizedGains',
    i18nKey: 'calculation.realizedGains',
    sign: '+',
    extractTotal: (d) => d.realizedGains.total,
    extractItems: (d) => d.realizedGains.items.map((item) => ({
      label: item.name,
      amount: item.realizedGain,
    })),
    colorSign: true,
    isExpandable: true,
  },
  {
    key: 'earnings',
    i18nKey: 'calculation.earnings',
    sign: '+',
    extractTotal: (d) => d.earnings.total,
    extractItems: (d) => {
      const items: RowItem[] = d.earnings.dividendItems.map((item) => ({
        label: item.name,
        amount: item.dividends,
      }));
      // Interest as a sub-item (single aggregate line)
      if (d.earnings.interest && parseFloat(d.earnings.interest) !== 0) {
        items.push({ label: 'Interest', i18nKey: 'calculation.interest', amount: d.earnings.interest });
      }
      return items;
    },
    colorSign: true,
    isExpandable: true,
  },
  {
    key: 'fees',
    i18nKey: 'calculation.fees',
    sign: '-',
    extractTotal: (d) => d.fees.total,
    extractItems: (d) => d.fees.items.map((item) => ({
      label: item.name,
      amount: item.fees,
    })),
    colorSign: true,
    isExpandable: true,
    negate: true,
  },
  {
    key: 'taxes',
    i18nKey: 'calculation.taxes',
    sign: '-',
    extractTotal: (d) => d.taxes.total,
    extractItems: (d) => d.taxes.items.map((item) => ({
      label: item.name,
      amount: item.taxes,
    })),
    colorSign: true,
    isExpandable: true,
    negate: true,
  },
  {
    key: 'cashCurrencyGains',
    i18nKey: 'calculation.cashCurrencyGains',
    sign: '+/-',
    extractTotal: (d) => d.cashCurrencyGains.total,
    extractItems: (d) => d.cashCurrencyGains.items.map((item) => ({
      label: `${item.name} (${item.currency})`,
      amount: item.gain,
    })),
    colorSign: true,
    isExpandable: true,
  },
  {
    key: 'pnt',
    i18nKey: 'calculation.pnTransfers',
    sign: '+',
    extractTotal: (d) => d.performanceNeutralTransfers.total,
    extractItems: (d) => d.performanceNeutralTransfers.items.map((item) => ({
      label: item.name,
      amount: item.amount,
      subLabel: item.date,
    })),
    colorSign: false,
    isExpandable: true,
  },
  {
    key: 'finalValue',
    i18nKey: 'calculation.finalValue',
    sign: '=',
    extractTotal: (d) => d.finalValue,
    colorSign: false,
    isExpandable: false,
  },
];
