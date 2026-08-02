import Decimal from 'decimal.js';

/**
 * Split ratio in `new:old` orientation — the number of shares held AFTER the
 * split for every `oldShares` held BEFORE it. A 20-for-1 forward split is
 * `{newShares: 20, oldShares: 1}`; a 1-for-25 reverse split is
 * `{newShares: 1, oldShares: 25}`.
 */
export interface SplitRatio {
  newShares: Decimal;
  oldShares: Decimal;
}

/**
 * Division context for the rescale: 10 significant digits, half-up. This is
 * the reference implementation's arithmetic context and is deliberately NOT
 * the library default — a local clone keeps global Decimal config untouched.
 */
const DivisionCtx = Decimal.clone({ precision: 10, rounding: Decimal.ROUND_HALF_UP });

/**
 * Multiplication context. The reference implementation multiplies exactly
 * (arbitrary precision) and applies the rounding context only to the division,
 * so the product must not be pre-rounded. 50 significant digits is exact for
 * every realistic operand: a 64-bit scaled share count is at most 19 digits and
 * a ratio side carries at most a handful more.
 */
const ProductCtx = Decimal.clone({ precision: 50, rounding: Decimal.ROUND_HALF_UP });

const RATIO_RE = /^\s*(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)\s*$/;

/**
 * Parse a `"new:old"` ratio string. Returns null on any malformed or
 * non-positive input. `1:1` is well-formed here — rejecting a no-op split is
 * the schema's job, so the wizard gate and the server route share one source
 * of truth.
 */
export function parseSplitRatio(input: string): SplitRatio | null {
  const match = RATIO_RE.exec(input);
  if (!match) return null;
  const newShares = new Decimal(match[1]);
  const oldShares = new Decimal(match[2]);
  if (!newShares.isFinite() || !oldShares.isFinite()) return null;
  if (newShares.lte(0) || oldShares.lte(0)) return null;
  return { newShares, oldShares };
}

/** Render a ratio in the `"new:old"` storage format. */
export function formatSplitRatio(ratio: SplitRatio): string {
  return `${ratio.newShares.toString()}:${ratio.oldShares.toString()}`;
}

/** Swap the two sides — the ratio that undoes `ratio`. */
export function invertRatio(ratio: SplitRatio): SplitRatio {
  return { newShares: ratio.oldShares, oldShares: ratio.newShares };
}

/** Exact multiply, then divide under the 10-digit context, then snap to the integer grid. */
function rescale(value: number, multiplier: Decimal, divisor: Decimal): number {
  const product = new ProductCtx(value).mul(multiplier);
  return new DivisionCtx(product.toString())
    .div(divisor)
    .toDecimalPlaces(0, Decimal.ROUND_HALF_EVEN)
    .toNumber();
}

/**
 * Rescale a stored share count (integer x 1e8). Shares move WITH the ratio:
 * a forward split increases them.
 */
export function splitSharesDb(sharesDb: number, ratio: SplitRatio): number {
  return rescale(sharesDb, ratio.newShares, ratio.oldShares);
}

/**
 * Rescale a stored quote (integer x 1e8). Quotes move AGAINST the ratio:
 * a forward split decreases them, keeping market value invariant.
 */
export function splitQuoteDb(quoteDb: number, ratio: SplitRatio): number {
  return rescale(quoteDb, ratio.oldShares, ratio.newShares);
}

/**
 * Read a ratio out of a stored event's `details` column. Tries the plain
 * `"new:old"` storage format first, then the legacy `{"splitRatio":"…"}` object
 * written before splits were implemented. Returns null for anything else —
 * callers render the raw string rather than throwing.
 */
export function readSplitDetails(details: string): SplitRatio | null {
  const direct = parseSplitRatio(details);
  if (direct) return direct;
  try {
    const parsed: unknown = JSON.parse(details);
    if (parsed && typeof parsed === 'object' && 'splitRatio' in parsed) {
      const raw = (parsed as { splitRatio: unknown }).splitRatio;
      if (typeof raw === 'string') return parseSplitRatio(raw);
    }
  } catch {
    // Not JSON either.
  }
  return null;
}
