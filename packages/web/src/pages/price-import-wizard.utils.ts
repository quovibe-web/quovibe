import type { CsvParseResult } from '@quovibe/shared';

export type PriceWizardStep = 'security' | 'upload' | 'map' | 'confirm';

export const PRICE_COLUMN_KEYS = ['date', 'close', 'open', 'high', 'low', 'volume'] as const;
export type PriceColumnKey = (typeof PRICE_COLUMN_KEYS)[number];

export type PriceColumnMapping = Partial<Record<PriceColumnKey, number>>;

export interface PriceWizardState {
  step: PriceWizardStep;
  securityId: string | null;
  securityName: string | null;
  parseResult: CsvParseResult | null;
  dateFormat: string;
  decimalSeparator: '.' | ',';
  thousandSeparator: '' | '.' | ',' | ' ';
  columnMapping: PriceColumnMapping;
}

export const initialPriceWizardState: PriceWizardState = {
  step: 'security',
  securityId: null,
  securityName: null,
  parseResult: null,
  dateFormat: 'yyyy-MM-dd',
  decimalSeparator: '.',
  thousandSeparator: '',
  columnMapping: {},
};

export function buildInitialPriceWizardState(
  preselect?: { securityId: string; securityName: string },
): PriceWizardState {
  if (preselect) {
    return {
      ...initialPriceWizardState,
      step: 'upload',
      securityId: preselect.securityId,
      securityName: preselect.securityName,
    };
  }
  return initialPriceWizardState;
}

export type PriceWizardAction =
  | { type: 'pickSecurity'; securityId: string; securityName: string }
  | {
      type: 'setParseResult';
      parseResult: CsvParseResult;
      columnMapping: PriceColumnMapping;
    }
  | { type: 'setColumnMapping'; columnMapping: PriceColumnMapping }
  | {
      type: 'setFormat';
      dateFormat?: string;
      decimalSeparator?: '.' | ',';
      thousandSeparator?: '' | '.' | ',' | ' ';
    }
  | { type: 'next' }
  | { type: 'back' }
  | { type: 'clearParseResult' };

const STEP_ORDER: PriceWizardStep[] = ['security', 'upload', 'map', 'confirm'];

function neighborStep(current: PriceWizardStep, dir: 1 | -1): PriceWizardStep {
  const i = STEP_ORDER.indexOf(current); // native-ok
  const next = i + dir; // native-ok
  if (next < 0 || next >= STEP_ORDER.length) return current;
  return STEP_ORDER[next];
}

export function priceWizardReducer(
  state: PriceWizardState,
  action: PriceWizardAction,
): PriceWizardState {
  switch (action.type) {
    case 'pickSecurity':
      return { ...state, securityId: action.securityId, securityName: action.securityName };
    case 'setParseResult':
      return {
        ...state,
        parseResult: action.parseResult,
        columnMapping: action.columnMapping,
      };
    case 'setColumnMapping':
      return { ...state, columnMapping: action.columnMapping };
    case 'setFormat':
      return {
        ...state,
        dateFormat: action.dateFormat ?? state.dateFormat,
        decimalSeparator: action.decimalSeparator ?? state.decimalSeparator,
        thousandSeparator: action.thousandSeparator ?? state.thousandSeparator,
      };
    case 'next':
      return { ...state, step: neighborStep(state.step, 1) };
    case 'back':
      return { ...state, step: neighborStep(state.step, -1) };
    case 'clearParseResult':
      return { ...state, parseResult: null, columnMapping: {} };
  }
}

export function canAdvance(state: PriceWizardState): boolean {
  switch (state.step) {
    case 'security':
      return state.securityId !== null;
    case 'upload':
      return state.parseResult !== null;
    case 'map':
      return state.columnMapping.date != null && state.columnMapping.close != null;
    case 'confirm':
      return true;
  }
}
