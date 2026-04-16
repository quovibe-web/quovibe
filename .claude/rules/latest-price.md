globs: packages/api/src/services/performance.*,packages/api/src/services/reports.service.*,packages/api/src/services/rebalancing.service.*,packages/api/src/routes/securities.*
---
# Market Value and latest_price Rules (CRITICAL)

## How the two price feeds work

There are two **independent** feeds per security:

1. **Historical Quotes feed** → writes to the `price` timeseries (one row per date, close price). Updated via "Update Quotes". Used in performance calculations.
2. **Latest Quote feed** → a scalar value `{price, timestamp}` on the security itself. **NOT a new row in the timeseries**. Overwritten on every fetch during the day. Shows only the most recently available price.

**Rule**: `latest_price` is used for **current portfolio value** (display) when it is more
up-to-date than the last historical close. It is **never written as a historical row**.
The `latest_price` table in ppxml2db stores this scalar (one row per security, overwritten
on every fetch).

**Same-date rule**: `yf.chart()` writes an intraday snapshot to `price` on the first fetch
of a trading day. If the price moves during the day, subsequent same-day fetches skip
`yf.chart()` (already up to date) and only update `latest_price` via `yf.quote()`. The
`latest_price` value is therefore always more current than the same-day historical snapshot
and **must win** for live display and MVE, even when both share the same date.

→ **Never INSERT into `price` from `latest_price`**. They are two separate pipelines.

## Implementation Rule

**Rule**: every calculation that produces a final Market Value (MVE, Statement of Assets, Dashboard)
**must** use the most up-to-date available quote.

## ppxml2db price schema
- `price` — daily historical (can be stale by days/weeks)
- `latest_price` — last known quote (also has `tstamp` = quote date)

## Injection Rule

When building the `priceMap` for a security, inject `latest_price` **before** the
carry-forward, with these mandatory guards:

```
latestPrice.gt(0)                          // valid price
latestPriceDate !== null                   // date known
latestPriceDate <= period.end              // do not inject future prices in historical views
latestPriceDate >= period.start            // within the period
!mergedPriceMap.has(latestPriceDate)       // do not overwrite real data from the price table
  || latestPriceDate === period.end        // EXCEPT at period-end: latest_price always wins
                                           // (same-date intraday beats historical snapshot)
```

For `getStatementOfAssets` the equivalent guard is:
```
!existingPrices.has(`${secId}|${latest.date}`) || latest.date === date
```

## Effective price for securities list / detail (`securities.ts`)

`listSecurities` and `getSecurity` compute `effectiveLatestPrice` by comparing the last
historical close (`price` table) with `latest_price`:

```
if (hist && (!lpDate || hist.date > lpDate)) {   // NOTE: strict >
  use historical close
} else {
  use latest_price
}
```

**`>`  not `>=`**: when both have the same date, `latest_price` wins (same-date intraday rule).

## Where to apply
- `computeSecurityPerfInternal` — MVE for TTWROR/IRR/Securities table
- `getStatementOfAssets` — value for Statement of Assets / Dashboard MV
- `listSecurities` / `getSecurity` — latest price display column
- Any other function that calculates current market value

## Recommended signature
`fetchLatestPrices` must return `Map<string, { price: Decimal; date: string | null }>`
(not just `Decimal`) so that consumers can apply the date guard.
