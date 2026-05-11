// packages/api/src/providers/yahoo-client.ts
//
// Thin wrapper around yahoo-finance2 that applies our standard config.
//
// `validation.logErrors: false` silences the library's built-in schema
// validator. Yahoo returns partial/malformed response shapes routinely for
// ETFs, indices, low-liquidity tickers, and delisted securities (e.g.
// `meta.currency = null`, missing `regularMarketPrice`). The validator
// prints a multi-line JSON warning per mismatch but the library still
// returns the usable data — so the warnings are pure noise in our logs.
// Disable them globally; real errors still surface via thrown exceptions.

type YahooFinanceCtor = new () => unknown;
interface YahooInstance {
  setGlobalConfig?: (cfg: { validation?: { logErrors?: boolean } }) => void;
  [key: string]: unknown;
}

// quovibe:allow-module-state — HTTP client singleton for Yahoo Finance; portfolio-agnostic (ADR-016).
let cached: YahooInstance | null = null;

export function getYahoo(): YahooInstance {
  if (cached) return cached;

  const mod = require('yahoo-finance2');
  const YahooFinance = (mod.default ?? mod) as YahooFinanceCtor;
  const yf = new YahooFinance() as YahooInstance;
  yf.setGlobalConfig?.({ validation: { logErrors: false } });
  cached = yf;
  return yf;
}
