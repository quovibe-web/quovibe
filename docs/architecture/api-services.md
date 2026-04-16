# API Services

## Anti-N+1 for `/api/performance/securities`

1. Single query for all transactions in the period
2. Single query for all prices at period end (latest price per security)
3. In-memory grouping by security UUID
4. Parallel engine calculation per security (CPU-bound, no additional I/O)

DO NOT loop over securities with a query for each one.

> Source: `packages/api/src/services/performance.service.ts`

## Price Fetching (`prices.service.ts`)

Library: **yahoo-finance2** (npm). DO NOT use `query1.finance.yahoo.com` directly.
- Handles cookies and authentication automatically
- Supports `historical()`, `quoteSummary()`, `search()`
- Has configurable built-in rate limiting

### Two price feeds per security

| Table | Source | Written by | Used for |
|-------|--------|-----------|---------|
| `price` | `yf.chart()` | First fetch of each trading day | Historical series, TTWROR intermediate days |
| `latest_price` | `yf.quote()` | Every fetch | Display: "Ultima quotazione", MVE at period-end |

**Same-date intraday rule**: on the first fetch of a trading day `yf.chart()` writes today's
current price to `price`. If the price moves, subsequent same-day fetches skip `yf.chart()`
(already have today's row) and only update `latest_price`. `latest_price` is therefore
always more current than the same-day `price` entry and wins for live MVE and display.

### Effective price resolution

`listSecurities` and `getSecurity` pick the displayed price as:

```
if (hist.date > lpDate)   → historical close (strictly newer)
else                      → latest_price     (same date or newer)
```

`computeSecurityPerfInternal` and `getStatementOfAssets` inject `latest_price` into the
price map unless a historical close exists for an intermediate date — but at the
**period-end / statement date** `latest_price` always overrides the same-day snapshot:

```
!mergedPriceMap.has(latestPriceDate) || latestPriceDate === period.end
```

See `.claude/rules/api.md` → "Market Value and latest_price" for the full rule.

## Price Fetching (manual)

- Concurrency: max 5 parallel fetches (`PRICE_FETCH_MAX_CONCURRENT`)
- Rate limiting: `PRICE_FETCH_INTERVAL_MS` between calls
- Manual trigger only: `POST /api/prices/fetch-all` and
  `POST /api/securities/:id/refresh-prices`
- ADR-015: the background `node-cron` scheduler and `worker_threads`-based
  worker pool were removed. Under the per-portfolio model, each portfolio
  owns its own DB and the previous single-threaded, single-DB, server-wide
  cron schedule no longer makes sense. Scheduled fetching will return in a
  future ADR as a per-portfolio preference.

## Taxonomy Write Layer (`taxonomy.service.ts`)

Operations:
- **createTaxonomy**(name, templateKey?) — creates root + child categories from template
- **deleteTaxonomy**(id) — cascade delete: categories + assignments + data
- **renameTaxonomy**, **reorderTaxonomy** (swap sortOrder)
- **createCategory**, **updateCategory**, **deleteCategory** (cascade children)
- **createAssignment**, **updateAssignment**, **deleteAssignment**

Templates: 7 built-in (asset-classes, industries-gics-sectors, industry, asset-allocation, regions, regions-msci, type-of-security). 16-color palette for auto-coloring.

> Source: `packages/api/src/services/taxonomy.service.ts`, `packages/api/src/data/taxonomy-templates.ts`

## Rebalancing Logic

- Allocation weights stored as integer on `taxonomy_category.weight` (0-10000 = 0%-100%)
- Delta formula: `delta% = (actual% / target%) - 1`
- Positive = overweight, negative = underweight
- Target formula: subtract direct assignment actuals before distributing remaining target to children by weight

> Source: `packages/api/src/routes/rebalancing.ts`

## Taxonomy Performance (`taxonomy-performance.service.ts`, `performance.service.ts`)

Taxonomy-scoped TTWROR/IRR follows PP's `ClientClassificationFilter` algorithm.
PP creates a pseudo-client with transformed transactions, then runs the standard
portfolio TTWROR. QuoVibe replicates this in two code paths:

### Two code paths (must stay aligned)

| Path | Entry point | Used by |
|------|------------|---------|
| `getPortfolioCalc` + `CalcScope` | Dashboard widgets (`/api/performance/calculation?taxonomyId=...`) |
| `computeSlicePerformance` | Data series page (`/api/performance/taxonomy-series`) |

### CalcScope for taxonomy

`buildCalcScope(sqlite, filter, withRef, taxonomyId, categoryId)` returns a `CalcScope` with:
- `securityIds` / `depositAccIds` — item Sets for filtering
- `securityWeights` / `accountWeights` — per-item Decimal weights (0–1) from `taxonomy_assignment`
- `isTaxonomyScope: true` — activates deposit-level cashflow handling

### Transaction transformation rules (PP §3.4 / §3.5)

All amounts are scaled by the item's taxonomy weight.

| Tx Type | Context | Transferal? |
|---------|---------|-------------|
| DEPOSIT / REMOVAL | On classified account | Yes (cfIn / cfOut) |
| BUY (non-classified security) | On classified account | Yes → REMOVAL (cash leaves scope) |
| SELL (non-classified security) | On classified account | Yes → DEPOSIT (cash enters scope) |
| BUY/SELL (classified security) | Both sides in scope | No (internal) |
| DIVIDEND (non-classified security) | On classified account | Yes → DEPOSIT (external income) |
| DIVIDEND (classified security) | On classified account | No (return) |
| TAXES | On classified account | Yes → REMOVAL (always) |
| TAX_REFUND | On classified account | Yes → DEPOSIT (always) |
| INTEREST | On classified account | No (return) — taxes create REMOVAL |
| INTEREST_CHARGE | On classified account | No (cost) — taxes create REMOVAL |
| FEES (no security / classified sec) | On classified account | No (cost) |
| FEES (non-classified security) | On classified account | Yes → REMOVAL |
| TRANSFER_BETWEEN_ACCOUNTS | On classified account | Yes (direction via `isTransferOut`) |
| §3.5 FEES | Non-classified account, classified security | Yes → DEPOSIT |
| §3.5 DIVIDENDS | Non-classified account, classified security | Yes → REMOVAL (gross − fees pre-tax; gross − fees − taxes post-tax) |

### Key implementation details

- `PerfTransaction.isTransferOut` preserves transfer direction lost during TRANSFER_IN/OUT → TRANSFER_BETWEEN_ACCOUNTS normalization
- INTEREST taxes are added as cfOut (REMOVAL) to make TTWROR use gross interest (PP's gross-up pattern)
- §3.5 DIVIDEND REMOVAL must use `getGrossAmount(tx) − getFees(tx)` (pre-tax) or `− getTaxes(tx)` additionally (post-tax), matching `resolveSecurityCashflows`. Using raw `tx.amount` (net) under-compensates in pre-tax mode by the withholding tax amount, reducing TTWROR incorrectly.
- Partial weight support: all amounts scaled by `weight / 10000`. Full BUY/SELL split for unequal security/account weights is a future enhancement.

> Source: `packages/api/src/services/performance.service.ts`, `packages/api/src/services/taxonomy-performance.service.ts`
> Reference: `docs/pp-reference/classification-ttwror-algorithm.md`

## Performance Chart Sampling (server-side)

- Periods ≤ 1 year: daily (max ~365 points)
- Periods 1-3 years: weekly (max ~156 points)
- Periods > 3 years: monthly (max ~120 points)
- `interval=auto` applies the logic automatically

> Source: `packages/api/src/routes/performance.ts`
