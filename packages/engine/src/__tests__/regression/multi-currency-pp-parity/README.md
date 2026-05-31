# Multi-Currency PP-Parity Regression Suite

Pins quovibe's multi-currency math against Portfolio Performance's
emitted values for 5 representative scenarios. Drift fails CI.

## Refresh protocol

Every `.expected.json` file is **manually captured** from PP. Re-baseline
only when (a) fixture trade dates change, (b) ECB rate snapshot changes,
or (c) PP version changes a calculation convention.

### Per fixture

1. Open the matching `<id>-<scenario>.xml` in Portfolio Performance
   (File → Open).
2. In PP, configure:
   - Reporting period: ALL (or the fixture's declared period if specified).
   - Display currency: the fixture's base currency.
   - Date: PP "today" set to `_captured_at` in the JSON.
3. Open Reports → Performance → Securities. For each security, copy:
   - Market Value (native + base ccy variants)
   - Purchase Value (native + base ccy)
   - Realized / Unrealized Gain (native + base)
   - TTWROR / TTWROR p.a. / IRR (at native and base computation modes)
4. Open Reports → Statement of Assets. Copy portfolio totals.
5. Write the values into `<id>-<scenario>.expected.json` with the
   schema below. Use PP's displayed precision (typically 2dp on
   amounts, 4dp on FX rates, 2dp on percentages — copy the string PP
   shows, do not re-round).
6. Record the exact PP version string in `_pp_version`.
7. Record every trade date + period boundary in `_ecb_snapshot_dates`
   so the test runner can verify the pinned ECB snapshot covers them.

### `.expected.json` schema

```jsonc
{
  "_pp_version": "<exact PP version, e.g. 0.69.1>",
  "_captured_at": "YYYY-MM-DD",
  "_ecb_snapshot_dates": ["2025-01-15", "2025-06-30"], // all trade dates + period boundaries
  "portfolio": {
    "baseCurrency": "EUR", // varies per fixture — copy from PP display currency setting
    "totalMVE": "1018.77",
    "totalMVB": "904.50",
    "ttwror": "0.0196",
    "ttwrorPa": "0.0312",
    "irr": "0.0345"
  },
  "securities": [
    {
      "name": "Tesla Inc",
      "currency": "USD",
      "marketValueNative": "1448.10",
      "marketValueBase": "1340.55",
      "costNative": "1284.34",      // PP "Purchase Value" (native)
      "costBase": "1173.20",        // PP "Purchase Value" (base)
      "unrealizedNative": "163.76",
      "unrealizedBase": "167.35",
      "realizedNative": "0.00",
      "realizedBase": "0.00",
      "ttwror": "0.1234",
      "ttwrorPa": "0.1234",
      "irr": "0.1289"
    }
  ]
}
```

## ECB snapshot

`ecb-snapshot-2026-05-20.csv` is a frozen subset of
`https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist.zip`.

Refresh by:

1. Download fresh `eurofxref-hist.csv` from ECB.
2. Filter rows to dates referenced by any fixture's `_ecb_snapshot_dates`
   plus ±30 days for forward-fill seeding.
3. Save as `ecb-snapshot-<YYYY-MM-DD>.csv`. Update the test loader to
   point at the new filename.

## Coverage matrix

| # | Scenario | Tests | Currencies |
|---|---|---|---|
| 01 | Zegona, 1 BUY GBP, hold | Hero MV, row MV, TTWROR/IRR | EUR base + GBP sec |
| 02 | Tesla, 2 BUYs USD, hold | Cost native + base | EUR base + USD sec |
| 03 | Partial-sell FIFO USD | Per-lot FIFO, decomposition | EUR base + USD sec |
| ~~04~~ | ~~Non-EUR base + triangulation~~ — **deferred** 2026-05-20 (no GBP-base PP file). Gap #2 covered by `getRate` unit tests in `fx-service.test.ts`. | n/a |
| 05 | Multi-deposit + dividend | Per-account cash conv, dividend FX | EUR base + EUR/USD deposits + USD dividend |
