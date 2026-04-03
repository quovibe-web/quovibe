# API Routes (Express 5)

All performance routes accept `periodStart` and `periodEnd` as query params.

```
# ─── Portfolio ─────────────────────────────────────
GET  /api/portfolio                      → portfolio info, base currency, config
PUT  /api/portfolio/settings             → update cost method, currency, etc.

# ─── Accounts ──────────────────────────────────────
GET  /api/accounts                       → account list (deposit + securities)
GET  /api/accounts/:id                   → account detail + balance
GET  /api/accounts/:id/holdings          → holdings (AccountHoldingItem[]) for the account
GET  /api/accounts/:id/transactions      → transactions for an account
POST /api/accounts                       → create account
PUT  /api/accounts/:id                   → edit account
DEL  /api/accounts/:id                   → deactivate account (soft delete)

# ─── Securities ────────────────────────────────────
GET  /api/securities                     → securities list + quotes
GET  /api/securities/:id                 → detail + historical prices + chart data
POST /api/securities                     → add security (manual)
PUT  /api/securities/:id                 → edit security
PUT  /api/securities/:id/prices/fetch    → update prices from provider
GET  /api/securities/:id/performance     → IRR, TTWROR, capital gains per security
    ?periodStart=...&periodEnd=...&costMethod=FIFO

# ─── Transactions ──────────────────────────────────
GET  /api/transactions                   → paginated list
    ?account=...&security=...&type=...&from=...&to=...
    ?search=...                          → free-text search across all columns (case-insensitive substring)
POST /api/transactions                   → create transaction (with validation)
PUT  /api/transactions/:id               → edit
DEL  /api/transactions/:id               → delete

# ─── Performance (portfolio level) ─────────────────
GET  /api/performance/calculation        → complete Calculation panel
    ?periodStart=...&periodEnd=...&costMethod=FIFO&filter=...&preTax=true
    → { initialValue, capitalGains: { unrealized, realized, foreignCurrencyGains },
        earnings: { dividends, interest, total }, fees, taxes,
        cashCurrencyGains, performanceNeutralTransfers, finalValue,
        irr, ttwror, ttwrorPa, absoluteChange, delta }

GET  /api/performance/securities         → performance per security
    ?periodStart=...&periodEnd=...&costMethod=FIFO
    → per security: { irr, irrConverged, ttwror, ttwrorPa,
                       purchaseValue, purchasePrice,
                       marketValue, unrealizedGain, realizedGain,
                       dividends, fees, taxes }

GET  /api/performance/returns            → returns heatmap data
    ?periodStart=...&periodEnd=...&interval=daily|monthly|annual

GET  /api/performance/taxonomy-series   → taxonomy slice performance
    ?periodStart=...&periodEnd=...&taxonomyId=...&categoryIds=...
    &costMethod=MOVING_AVERAGE|FIFO&preTax=true|false&interval=auto

GET  /api/performance/chart              → data for performance chart
    ?periodStart=...&periodEnd=...&interval=auto|daily|weekly|monthly
    → Array<{ date, marketValue, transfersAccumulated,
              ttwrorCumulative, delta }>

# ─── Reports ──────────────────────────────────────
GET  /api/reports/statement-of-assets    → snapshot at a date
    ?date=...&filter=...
GET  /api/reports/holdings               → portfolio % composition
    ?date=...&taxonomy=...
GET  /api/reports/dividends              → dividend payments
    ?periodStart=...&periodEnd=...&groupBy=month|quarter|year

# ─── Prices & FX ──────────────────────────────────
GET  /api/prices/exchange-rates          → exchange rates
    ?from=USD&to=EUR&date=...
POST /api/prices/fetch-all               → manual trigger for price update

GET  /api/portfolio/export               → stream the SQLite file as-is
    Content-Type: application/x-sqlite3

# ─── Taxonomies (read) ────────────────────────────
GET  /api/taxonomies                     → taxonomies list
GET  /api/taxonomies/:id                 → detail with category tree + assignments

# ─── Taxonomy CRUD ────────────────────────────────
POST   /api/taxonomies                              → create taxonomy (with optional template)
PATCH  /api/taxonomies/:id                           → rename taxonomy
DELETE /api/taxonomies/:id                           → delete taxonomy + cascade
PATCH  /api/taxonomies/:id/reorder                   → move taxonomy up/down in sort order

POST   /api/taxonomies/:id/categories                → create category under parent
PATCH  /api/taxonomies/:id/categories/:catId         → update category (name, color, parent, rank, weight)
DELETE /api/taxonomies/:id/categories/:catId          → delete category + cascade

POST   /api/taxonomies/:id/assignments               → assign security/account to category
PATCH  /api/taxonomies/:id/assignments/:assignId      → update assignment (category, weight)
DELETE /api/taxonomies/:id/assignments/:assignId       → delete assignment

# ─── Rebalancing ──────────────────────────────────
GET  /api/rebalancing/:taxonomyId       → rebalancing data (actual vs target, delta)
    ?date=YYYY-MM-DD

# ─── Security Search ─────────────────────────────
GET  /api/securities/search              → Yahoo search for securities
    ?q=...

# ─── Security Events ─────────────────────────────
GET    /api/securities/:id/events        → list events for a security
POST   /api/securities/:id/events        → create event (stock split, note)
DELETE /api/securities/:id/events/:eventId → delete event

# ─── Attribute Types ──────────────────────────────
GET  /api/attribute-types               → list all attribute types

# ─── Calendars ────────────────────────────────────
GET  /api/calendars                      → list available trading calendars
GET  /api/calendars/:id/holidays         → holidays for a calendar
    ?year=YYYY

# ─── Import ──────────────────────────────────────
POST /api/import                         → upload XML file
    Content-Type: multipart/form-data
    → triggers reloadApp() with atomic file swap

# ─── Settings ─────────────────────────────────────
GET    /api/settings/reporting-periods         → list custom reporting periods
POST   /api/settings/reporting-periods         → add a reporting period
PUT    /api/settings/reporting-periods         → replace all reporting periods
DELETE /api/settings/reporting-periods/:index  → delete a reporting period by index
GET    /api/settings/investments-view          → get column visibility / view config
PUT    /api/settings/investments-view          → save column visibility / view config

# ─── Dashboard ────────────────────────────────────
GET  /api/dashboard   → get dashboard layout (widgets, activeDashboard)
PUT  /api/dashboard   → save dashboard layout
```

## Key design notes

- **preTax toggle**: `preTax=true` (default) excludes taxes from performance, moves them to "Performance Neutral Transfers"
- **Period-relative Capital Gains**: gains calculated from value at period start, not original purchase price
- **Server-side sampling**: performance chart uses auto/daily/weekly/monthly based on period length
- **Calculation panel**: capital gains are relative to reporting period (see `engine-algorithms.md`)

> Source: `packages/api/src/routes/`
