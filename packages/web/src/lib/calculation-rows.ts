import Decimal from 'decimal.js';
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
    extractItems: (d) => {
      const items: RowItem[] = d.performanceNeutralTransfers.items.map((item) => ({
        label: item.name,
        amount: item.amount,
        subLabel: item.date,
      }));
      const taxes = parseFloat(d.performanceNeutralTransfers.taxes);
      if (taxes !== 0) {
        items.push({
          label: '',
          i18nKey: 'calculation.taxesInTransfers',
          amount: (-taxes).toString(),
        });
      }
      return items;
    },
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

// ---------------------------------------------------------------------------
// Categorized shape — consumed by CalculationPremiumView (Phase 11+).
// The flat CALCULATION_ROWS above remains the single source for ClassicView.
// ---------------------------------------------------------------------------

export type CategoryId = 'drivers' | 'frictions' | 'flows' | 'anchors';

export interface CategorySubRow {
  labelKey: string;
  total: string;
  colorize: boolean;
}

export interface DrillDownColumn {
  /** Field name on the row object. */
  id: string;
  /** i18n key for column header. */
  labelKey: string;
  /** How to render the cell value. */
  format: 'currency' | 'date' | 'text';
  /** Right-align for numbers; left-align for text. */
  align: 'left' | 'right';
  /** When true, the cell is colorized per sign. */
  colorize?: boolean;
}

export interface DrillDownTable {
  titleKey: string;
  columns: DrillDownColumn[];
  rows: Record<string, string>[];
  /** Pseudo-content marker — when set, the table renders this i18n key as italic text instead of a table body. */
  placeholderKey?: string;
}

export interface CategoryDef {
  id: CategoryId;
  eyebrowKey: string;
  descriptionKey: string;
  extractTotal: (d: CalculationBreakdownResponse) => string;
  /** True when the category total should colorize per its sign (drivers / flows). False when always neutral or always negative (frictions). */
  colorize: boolean;
  /** Overrides the natural sign when the magnitude must render negative even if stored positive (frictions). */
  colorSign?: 1 | -1;
  extractSubRows: (d: CalculationBreakdownResponse) => CategorySubRow[];
  extractDrillDownTables: (d: CalculationBreakdownResponse) => DrillDownTable[];
}

const driversCategory: CategoryDef = {
  id: 'drivers',
  eyebrowKey: 'calculation.categories.drivers',
  descriptionKey: 'calculation.categories.descriptions.drivers',
  colorize: true,
  extractTotal: (d) => new Decimal(d.capitalGains.total)
    .plus(d.earnings.total)
    .plus(d.cashCurrencyGains.total)
    .toString(),
  extractSubRows: (d) => [
    { labelKey: 'calculation.unrealizedGains',      total: d.capitalGains.unrealized,            colorize: true },
    { labelKey: 'calculation.realizedGains',        total: d.capitalGains.realized,              colorize: true },
    { labelKey: 'calculation.dividends',            total: d.earnings.dividends,                 colorize: true },
    { labelKey: 'calculation.interest',             total: d.earnings.interest,                  colorize: true },
    { labelKey: 'calculation.foreignCurrencyGains', total: d.capitalGains.foreignCurrencyGains,  colorize: true },
    { labelKey: 'calculation.currencyGainsOnCash',  total: d.cashCurrencyGains.total,            colorize: true },
  ],
  extractDrillDownTables: (d) => [
    {
      titleKey: 'calculation.unrealizedGains',
      columns: [
        { id: 'name',                 labelKey: 'calculation.columnName',   format: 'text',     align: 'left' },
        { id: 'unrealizedGain',       labelKey: 'calculation.columnAmount', format: 'currency', align: 'right', colorize: true },
        { id: 'foreignCurrencyGains', labelKey: 'calculation.thereofFx',    format: 'currency', align: 'right', colorize: true },
      ],
      rows: d.capitalGains.items.map((it) => ({
        name: it.name,
        unrealizedGain: it.unrealizedGain,
        foreignCurrencyGains: it.foreignCurrencyGains,
      })),
    },
    {
      titleKey: 'calculation.realizedGains',
      columns: [
        { id: 'name',         labelKey: 'calculation.columnName',   format: 'text',     align: 'left' },
        { id: 'realizedGain', labelKey: 'calculation.columnAmount', format: 'currency', align: 'right', colorize: true },
      ],
      rows: d.realizedGains.items.map((it) => ({
        name: it.name,
        realizedGain: it.realizedGain,
      })),
    },
    {
      titleKey: 'calculation.dividends',
      columns: [
        { id: 'name',      labelKey: 'calculation.columnName',   format: 'text',     align: 'left' },
        { id: 'dividends', labelKey: 'calculation.columnAmount', format: 'currency', align: 'right', colorize: true },
      ],
      rows: d.earnings.dividendItems.map((it) => ({
        name: it.name,
        dividends: it.dividends,
      })),
    },
    {
      titleKey: 'calculation.interest',
      columns: [
        { id: 'name',   labelKey: 'calculation.columnName',   format: 'text',     align: 'left' },
        { id: 'amount', labelKey: 'calculation.columnAmount', format: 'currency', align: 'right', colorize: true },
      ],
      rows: parseFloat(d.earnings.interest) !== 0
        ? [{ name: '', amount: d.earnings.interest }]
        : [],
      placeholderKey: parseFloat(d.earnings.interest) !== 0
        ? 'calculation.interestNotItemized'
        : undefined,
    },
    {
      titleKey: 'calculation.cashCurrencyGains',
      columns: [
        { id: 'name', labelKey: 'calculation.columnName',   format: 'text',     align: 'left' },
        { id: 'gain', labelKey: 'calculation.columnAmount', format: 'currency', align: 'right', colorize: true },
      ],
      rows: d.cashCurrencyGains.items.map((it) => ({
        name: `${it.name} (${it.currency})`,
        gain: it.gain,
      })),
    },
  ],
};

const frictionsCategory: CategoryDef = {
  id: 'frictions',
  eyebrowKey: 'calculation.categories.frictions',
  descriptionKey: 'calculation.categories.descriptions.frictions',
  colorize: true,
  colorSign: -1,
  extractTotal: (d) => new Decimal(d.fees.total).plus(d.taxes.total).toString(),
  extractSubRows: (d) => [
    { labelKey: 'calculation.fees',  total: d.fees.total,  colorize: true },
    { labelKey: 'calculation.taxes', total: d.taxes.total, colorize: true },
  ],
  extractDrillDownTables: (d) => [
    {
      titleKey: 'calculation.fees',
      columns: [
        { id: 'name', labelKey: 'calculation.columnName',   format: 'text',     align: 'left' },
        { id: 'fees', labelKey: 'calculation.columnAmount', format: 'currency', align: 'right', colorize: true },
      ],
      rows: d.fees.items.map((it) => ({ name: it.name, fees: it.fees })),
    },
    {
      titleKey: 'calculation.taxes',
      columns: [
        { id: 'name',  labelKey: 'calculation.columnName',   format: 'text',     align: 'left' },
        { id: 'taxes', labelKey: 'calculation.columnAmount', format: 'currency', align: 'right', colorize: true },
      ],
      rows: d.taxes.items.map((it) => ({ name: it.name, taxes: it.taxes })),
    },
  ],
};

const flowsCategory: CategoryDef = {
  id: 'flows',
  eyebrowKey: 'calculation.categories.flows',
  descriptionKey: 'calculation.categories.descriptions.flows',
  colorize: false,
  extractTotal: (d) => d.performanceNeutralTransfers.total,
  extractSubRows: (d) => {
    const rows: CategorySubRow[] = [
      { labelKey: 'calculation.deposits',         total: d.performanceNeutralTransfers.deposits,         colorize: false },
      { labelKey: 'calculation.removals',         total: d.performanceNeutralTransfers.removals,         colorize: false },
      { labelKey: 'calculation.deliveryInbound',  total: d.performanceNeutralTransfers.deliveryInbound,  colorize: false },
      { labelKey: 'calculation.deliveryOutbound', total: d.performanceNeutralTransfers.deliveryOutbound, colorize: false },
    ];
    if (parseFloat(d.performanceNeutralTransfers.taxes) !== 0) {
      rows.push({ labelKey: 'calculation.taxesInTransfers', total: d.performanceNeutralTransfers.taxes, colorize: true });
    }
    return rows;
  },
  extractDrillDownTables: (d) => [
    {
      titleKey: 'calculation.pnTransfers',
      columns: [
        { id: 'date',   labelKey: 'calculation.columnDate',   format: 'date',     align: 'left' },
        { id: 'name',   labelKey: 'calculation.columnName',   format: 'text',     align: 'left' },
        { id: 'amount', labelKey: 'calculation.columnAmount', format: 'currency', align: 'right', colorize: true },
      ],
      rows: d.performanceNeutralTransfers.items.map((it) => ({
        date: it.date,
        name: it.name,
        amount: it.amount,
      })),
    },
  ],
};

const anchorsCategory: CategoryDef = {
  id: 'anchors',
  eyebrowKey: 'calculation.categories.anchorsIdentity',
  descriptionKey: 'calculation.categories.descriptions.anchorsIdentity',
  colorize: false,
  extractTotal: (d) => d.finalValue,
  extractSubRows: (d) => [
    { labelKey: 'calculation.initialValue', total: d.initialValue, colorize: false },
    { labelKey: 'calculation.finalValue',   total: d.finalValue,   colorize: false },
  ],
  // Anchors renders the identity equation in place of drill-down tables;
  // the dedicated AnchorsSection (Phase 9.2) handles that, so this returns [].
  extractDrillDownTables: () => [],
};

export const CALCULATION_CATEGORIES: CategoryDef[] = [
  driversCategory,
  frictionsCategory,
  flowsCategory,
  anchorsCategory,
];
