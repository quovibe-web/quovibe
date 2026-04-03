import { InstrumentType } from './enums';

const YAHOO_QUOTE_TYPE_MAP: Record<string, InstrumentType> = {
  EQUITY: InstrumentType.EQUITY,
  ETF: InstrumentType.ETF,
  BOND: InstrumentType.BOND,
  CRYPTOCURRENCY: InstrumentType.CRYPTO,
  MUTUALFUND: InstrumentType.FUND,
  FUTURE: InstrumentType.COMMODITY,
  COMMODITY: InstrumentType.COMMODITY,
  INDEX: InstrumentType.INDEX,
  CURRENCY: InstrumentType.CURRENCY,
  OPTION: InstrumentType.EQUITY, // Options are not a distinct instrument class; displayed as equity
};

const UNKNOWN = InstrumentType.UNKNOWN;

/**
 * Converts a Yahoo Finance `quoteType` string to a normalized InstrumentType.
 *
 * @param yahooQuoteType - Raw `quoteType` value from the Yahoo Finance API (e.g. `"EQUITY"`, `"MUTUALFUND"`).
 * @returns The matching `InstrumentType`, or `InstrumentType.UNKNOWN` for unrecognized values.
 */
export function normalizeInstrumentType(yahooQuoteType: string): InstrumentType {
  return YAHOO_QUOTE_TYPE_MAP[yahooQuoteType.toUpperCase()] ?? UNKNOWN;
}
