# Frontend Pages

## Route map

```
/                              → Dashboard (KPIs, portfolio value chart, widgets)
/accounts                      → AccountsHub: brokerage unit cards, standalone deposits, summary strip
/accounts/:id                  → AccountDetail: brokerage header, inner tabs (Cash Account/Transactions)
/investments                   → Investments: unified securities list + statement + holdings + performance
/investments/:id               → SecurityDetail: info + price chart + transactions + performance
/transactions                  → All Transactions, filterable by type/account/security/date + free-text search
/transactions/new              → New transaction form (selectable type, dynamic fields)
/analytics                     → Analytics parent shell (redirects to /analytics/calculation)
/analytics/calculation         → Complete Calculation panel (7 tabs)
/analytics/chart               → Time-series performance chart (sampling: daily/weekly/monthly)
/analytics/income              → Payments overview (dividends, interest, fees, taxes)
/analytics/data-series         → Taxonomy slice performance (TTWROR, IRR, MVE per slice)
/allocation                    → Asset Allocation (Definition + Rebalancing views, with taxonomy sub-items)
/settings                      → Settings (4 tabs: portfolio, presentation, dataSources, advanced)
/import                        → Import page (standalone, no Shell/sidebar)
```

Legacy redirects (kept for URL compatibility):
```
/securities                    → /investments
/securities/:id                → /investments/:id
/performance                   → /analytics/calculation
/performance/calculation       → /analytics/calculation
/performance/chart             → /analytics/chart
/performance/securities        → /investments?view=performance
/performance/taxonomy-series   → /analytics/data-series
/reports/payments              → /analytics/income
/reports/statement             → /investments
/reports/holdings              → /investments
/reports/asset-allocation      → /allocation
/reports/dividends             → /analytics/income
```

Notes:
- `/import` is standalone: rendered outside the Shell layout (no sidebar/topbar)
- Transactions are edited via per-type `Edit*Dialog` modals, not a separate route
- Taxonomy management is integrated into `/allocation`; taxonomy sub-items expand in the sidebar nav
- Account management (create/rename/retire/delete) lives in `/accounts` (Accounts Hub)
- `/investments` includes a `SecurityDrawer` side panel triggered from table rows
- Security editing uses `SecurityEditor` (Sheet, right-side panel): container changed from Dialog to Sheet, horizontal tabs replaced with 4 scrollable sections (Master Data, Price Feed, Attributes, Taxonomies), completeness indicator system added (no-taxonomy, no-feed, no-isin, retired)
- `/accounts/:id` uses inner tabs (`AccountDetailTabs`) for Cash Account / Transactions views
- `AccountsHub` groups accounts into brokerage units (portfolio + linked deposit) and standalone deposits

## Security Information Architecture

Three surfaces provide security information, connected via `initialSection` deep-linking:

```
SecurityDrawer (read) → "Edit Security" → SecurityEditor (write, optional initialSection)
SecurityDrawer (read) → "Add ISIN →"    → SecurityEditor (write, masterData section)
SecurityDetail (read) → "Edit" button   → SecurityEditor (write, optional initialSection)
SecurityDetail (read) → "Configure feed" → SecurityEditor (write, priceFeed section)
Completeness dot      → SecurityEditor (write, focused section)
AddInstrumentDialog   → create → toast action → SecurityEditor (write)
```

Cache invalidation chain after SecurityEditor save:
- `['securities']` + `['securities', id]` — refreshes list + detail
- `['taxonomies']` + `['rebalancing']` — refreshes allocation views
- `['reports']` + `['performance']` + `['holdings']` — refreshes all value/perf displays

## Feature matrix

| Category | Feature | Notes |
|---|---|---|
| **Portfolio** | Open portfolio from SQLite (ppxml2db) | Read/write on the same file |
| **Accounts** | Deposit, Securities, Reference account | With calculated balance |
| **Securities** | List, detail, price chart | TanStack Table, SecurityEditor (Sheet, scrollable sections, completeness indicators) |
| **Security search** | Yahoo Finance search + preview | AddInstrumentDialog (spotlight search) |
| **Stock splits** | Corporate events, split ratio | CorporateEventDialog |
| **Transactions** | All 15 types | Adaptive form, per-type Edit*Dialog |
| **Cost** | FIFO and Moving Average | Global switch in settings |
| **Performance** | IRR, TTWROR (cumulative + p.a.) | Per portfolio and per security |
| **Calculation** | Complete calculation panel | 7 tabs |
| **Returns heatmap** | Daily/monthly/annual returns | Dashboard widget (not a standalone page) |
| **Reports** | Statement of Assets, Performance per security | Configurable columns |
| **Taxonomies** | Full CRUD with templates | 7 templates, 16-color palette |
| **Asset allocation** | Definition + Rebalancing views | Drag-and-drop, metric cards |
| **Rebalancing** | Actual vs target, delta, weights | Standard rebalancing formula |
| **Taxonomy series** | Performance by taxonomy slice | TaxonomySeries page |
| **Payments** | Dividends, interest, fees, taxes | With breakdown tooltip |
| **Period** | 1Y, 2Y, 3Y, 5Y, YTD, ALL, Custom | Pills in TopBar, overflow menu, persisted to sidecar |
| **Prices** | Fetch from Yahoo Finance | Background job, rate limiting |
| **Currencies** | Multi-currency with ECB rates | Automatic conversion |
| **Dashboard** | KPIs + portfolio value chart | Configurable widgets, drag-and-drop reorder, multi-tab, per-widget period override |
| **Import/Export** | XML import, SQLite export | WAL-safe backup, atomic swap |
| **i18n** | 8 languages, 11 namespaces | Standard financial terminology |
| **Privacy mode** | Blur amounts and percentages | Toggle in TopBar toggle group |
| **Responsive** | Desktop sidebar, tablet rail, mobile bottom nav + drawer | 3 breakpoints (lg, md, mobile) |
| **Micro-interactions** | Page fade-in, count-up KPIs, staggered reveals, surface transitions | CSS animations + `use-count-up` hook |
| **Theme** | Light, Dark, System | Toggle group in TopBar, persisted to sidecar settings |
| **Version badge** | Clickable version linking to GitHub releases | Sidebar footer, drawer, mobile nav |

## TransactionForm — type → fields → units mapping

| Type | Required fields | xact_unit types | Cross entries |
|------|----------------|-----------------|---------------|
| BUY | security, shares, price, deposit account | GROSS_VALUE, FEE?, TAX?, FOREX? | securities + deposit |
| SELL | security, shares, price, deposit account | GROSS_VALUE, FEE?, TAX? | securities + deposit |
| DELIVERY_INBOUND | security, shares, price | GROSS_VALUE, FEE? | securities only |
| DELIVERY_OUTBOUND | security, shares, price | GROSS_VALUE | securities only |
| DEPOSIT | deposit account, amount | — | deposit only |
| REMOVAL | deposit account, amount | — | deposit only |
| DIVIDEND | deposit account, amount, security? | GROSS_VALUE, TAX?, FEE? | deposit + securities? |
| INTEREST | deposit account, amount | GROSS_VALUE | deposit |
| INTEREST_CHARGE | deposit account, amount | GROSS_VALUE | deposit |
| FEES | deposit account, amount, security? | FEE | deposit |
| FEES_REFUND | deposit account, amount | FEE | deposit |
| TAXES | deposit account, amount | TAX | deposit |
| TAX_REFUND | deposit account, amount | TAX | deposit |
| SECURITY_TRANSFER | security, shares, from/to account | FEE? | two securities accounts |
| TRANSFER_BETWEEN_ACCOUNTS | from/to account, amount | FOREX? | two deposit accounts |

> Source: `packages/web/src/components/domain/TransactionForm.tsx`

## Layout

Responsive portfolio management layout with three sidebar modes:

- **Desktop (≥ lg)**: Full 264px sidebar with logo, sectioned navigation (Main / Data / Analysis / System), taxonomy sub-items, and version badge
- **Tablet (md–lg)**: Collapsed 56px icon-only rail with tooltips
- **Mobile (< md)**: Fixed bottom nav bar (Dashboard, Investments, Transactions, Analytics) + "More" sheet for the full nav; hamburger button in TopBar opens a left SidebarDrawer
- **Keyboard shortcut**: `Ctrl+B` / `⌘+B` toggles the SidebarDrawer at any viewport

Navigation sections:
| Section | Items |
|---------|-------|
| Main | Dashboard |
| Data | Accounts, Investments, Transactions |
| Analysis | Analytics (expandable sub-routes), Allocation (expandable taxonomy sub-items) |
| System | Settings |

- **Top bar**: Reporting period pills (1Y/2Y/3Y/5Y/YTD/ALL + custom periods) with overflow menu, "+" button for new periods, language switcher, and toggle group (privacy + light/system/dark theme)
- **Main pane**: Main content area with responsive padding
- **Version badge**: Clickable version number linking to GitHub releases, shown in sidebar footer, drawer footer, and mobile nav sheet

> Source: `packages/web/src/components/layout/Shell.tsx`, `Sidebar.tsx`, `TopBar.tsx`

## Reporting Period

Managed as URL search params (`periodStart`, `periodEnd`), not React Context:
- `useSearchParams()` to read/write
- TanStack Query hooks include period in `queryKey` for automatic invalidation
- State survives refresh and is shareable via URL
- Period params are preserved across navigation for period-sensitive pages (Dashboard, Analytics, Allocation, Investments, Accounts)
- Active period ID is persisted to sidecar settings and restored on page load when URL params are absent
- Default periods: 1Y, 2Y, 3Y, 5Y, YTD, ALL; custom periods can be created and are stored in the sidecar

> Source: `packages/web/src/api/use-performance.ts` — `useReportingPeriod()`, `packages/web/src/lib/period-utils.ts`
