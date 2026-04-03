# Calculation Engine Algorithms

The `engine` package is pure TypeScript without I/O dependencies, testable with Vitest. Uses `decimal.js` for financial precision.

## FIFO (First In, First Out)

Maintains a lot queue. Each BUY/DELIVERY_INBOUND creates a new lot. Each SELL/DELIVERY_OUTBOUND consumes lots from the oldest first.

- **Lot cost**: `pricePerShare = (grossAmount + fees) / shares` — taxes excluded
- **Realized gain on sell**: `soldShares × (sellPrice - lotCostPerShare)`
- **Purchase value**: sum of remaining lot costs

> Source: `packages/engine/src/cost/fifo.ts`

## Moving Average

Maintains a running average cost. BUY increases total cost. SELL does NOT change the average — it locks in the gain vs the average.

- **Average price**: `totalCost / totalShares` (recalculated after each buy)
- **Realized gain on sell**: `sellRevenue - (shares × avgPrice)`

> Source: `packages/engine/src/cost/moving-average.ts`

**Invariant**: Total gain (realized + unrealized) is identical across FIFO and Moving Average for the same set of transactions.

## Stock Split Adjustment

Lots with `date < split.date` are adjusted: `shares *= ratio`, `pricePerShare /= ratio`, `totalCost` unchanged.

Historical prices are NOT modified — it's the lot costs that are adjusted.

> Source: `packages/engine/src/cost/split.ts`

## TTWROR (True Time-Weighted Rate of Return)

Daily holding periods following standard TTWROR methodology.

**Eq 3**: `1 + r = (MVE + CFout) / (MVB + CFin)`

Where:
- MVE = market value at end of day
- MVB = market value at start of day (= MVE of previous day)
- CFin = inflow cashflow (start of day), ≥ 0
- CFout = outflow cashflow (end of day), ≥ 0

**Cumulative (Eq 2)**: `r_cum = [(1 + r_1) × (1 + r_2) × ... × (1 + r_n)] - 1`

**Annualized**: `(1 + r_cum) ^ (365 / periodDays) - 1`

**Price carrying**: days without price (weekends, holidays) use the last known price. Days before the first known price have market value 0.

**Performance optimization**: cumulative product loop uses native float internally, converts to Decimal only for the final result.

> Source: `packages/engine/src/performance/ttwror.ts`

## IRR (Money-Weighted Return)

Solves: `MVE = MVB × (1+IRR)^(RD₁/365) + Σ CFₜ × (1+IRR)^(RDₜ/365)`

Where RDₜ = remaining days in the period for cashflow t.

**Convergence strategy**:
1. Newton-Raphson with guess = 0.1 (100 iterations, tolerance 1e-10)
2. Fallback: Brent's method with bounds [-0.999, 10.0]
3. If neither converges: returns `null`

**API response**: `{ "irr": "0.0823", "irrConverged": true }` or `{ "irr": null, "irrConverged": false }`. Frontend shows "N/A" when not converged.

**Performance**: internal loop uses native float, Decimal only for final result.

> Source: `packages/engine/src/performance/irr.ts`

## Purchase Value (Reporting Period)

Purchase value calculation rule:
- Purchase WITHIN the period → use the real purchase price (fees+taxes included)
- Purchase BEFORE the period → use the market value at period start (revaluation)
- Purchase AFTER the period → Purchase Value = 0

Implementation:
1. Compute lots from pre-period transactions (to determine remaining shares)
2. Create a "synthetic lot" at period start with `shares × priceAtPeriodStart`
3. Combine synthetic lot with in-period transactions
4. Apply FIFO or Moving Average

> Source: `packages/engine/src/valuation/purchase-value.ts`

## Capital Gains (Period-Relative)

Gains in the Calculation panel are RELATIVE to the period start, not to the original purchase price.

- **Realized**: `sell_price - value_at_period_start`
- **Unrealized**: `current_value - value_at_period_start`

Do NOT confuse with FIFO/MA `realizedGain` which is the gain from original purchase.

> Source: `packages/engine/src/valuation/period-gains.ts`

## Annualization

Converts periodic return to per-annum: `(1 + r) ^ (365 / days) - 1`

> Source: `packages/engine/src/performance/annualize.ts`
