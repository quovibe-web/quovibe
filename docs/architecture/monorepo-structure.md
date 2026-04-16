# Monorepo Structure

```
quovibe/
├── docker-compose.yml
├── Dockerfile
├── .env.example
├── pnpm-workspace.yaml
├── package.json                    # root scripts
│
├── packages/
│   ├── shared/                     # Types, Zod schemas, shared constants
│   │   ├── src/
│   │   │   ├── types/
│   │   │   │   ├── account.ts
│   │   │   │   ├── benchmark.ts          # BenchmarkSeriesResponse (API response types)
│   │   │   │   ├── calculation.ts        # CalculationBreakdownResponse
│   │   │   │   ├── dashboard.ts          # Dashboard config types
│   │   │   │   ├── price.ts
│   │   │   │   ├── security.ts
│   │   │   │   ├── taxonomy.ts
│   │   │   │   ├── transaction.ts
│   │   │   │   └── index.ts
│   │   │   ├── schemas/            # Zod schemas (front+back validation)
│   │   │   │   ├── account.schema.ts
│   │   │   │   ├── benchmark.schema.ts   # BenchmarkConfig, ChartConfig (sidecar)
│   │   │   │   ├── data-series.schema.ts # Data series filter definitions
│   │   │   │   ├── prices.schema.ts
│   │   │   │   ├── reports.schema.ts
│   │   │   │   ├── security.schema.ts
│   │   │   │   ├── security-event.schema.ts
│   │   │   │   ├── security-search.schema.ts
│   │   │   │   ├── settings.schema.ts
│   │   │   │   ├── taxonomy.schema.ts    # CRUD: create/update taxonomy, category, assignment
│   │   │   │   ├── transaction.schema.ts
│   │   │   │   └── index.ts
│   │   │   ├── calendars/          # Trading calendars (holidays, Easter)
│   │   │   │   ├── definitions/    # Americas, Asia-Pacific, Europe, Generic
│   │   │   │   ├── calendar-utils.ts
│   │   │   │   ├── easter.ts       # Computus algorithm
│   │   │   │   ├── registry.ts
│   │   │   │   ├── resolve.ts
│   │   │   │   ├── rules.ts
│   │   │   │   ├── types.ts
│   │   │   │   └── index.ts
│   │   │   ├── enums.ts            # TransactionType, CostMethod, AccountType, InstrumentType
│   │   │   ├── instrument-type.ts  # normalizeInstrumentType (Yahoo quoteType → InstrumentType)
│   │   │   ├── cashflow.ts         # Cashflow definition per level (portfolio/account/security)
│   │   │   ├── constants.ts
│   │   │   ├── reporting-period-resolver.ts  # Shared period resolution logic
│   │   │   └── transaction-gating.ts  # Transaction type validation rules
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── engine/                     # Pure financial logic (zero I/O dependencies)
│   │   ├── src/
│   │   │   ├── cost/
│   │   │   │   ├── fifo.ts
│   │   │   │   ├── moving-average.ts
│   │   │   │   ├── split.ts              # Stock split adjustment
│   │   │   │   └── index.ts
│   │   │   ├── performance/
│   │   │   │   ├── irr.ts              # Money-Weighted Return (Newton-Raphson)
│   │   │   │   ├── ttwror.ts           # True Time-Weighted Rate of Return
│   │   │   │   ├── benchmark.ts        # Benchmark cumulative return series (PP-compliant)
│   │   │   │   ├── simple-return.ts    # r = MVE/MVB - 1
│   │   │   │   ├── annualize.ts        # Periodic → p.a. conversion
│   │   │   │   └── index.ts
│   │   │   ├── cashflow/
│   │   │   │   ├── resolver.ts         # Determines cashflow per level
│   │   │   │   ├── portfolio-level.ts  # Only deposit, removal, delivery in/out
│   │   │   │   ├── account-level.ts    # All except security transfer
│   │   │   │   └── security-level.ts   # Buy, sell, dividend, delivery in/out
│   │   │   ├── valuation/
│   │   │   │   ├── market-value.ts     # Market value calculation at a date
│   │   │   │   ├── purchase-value.ts   # Purchase Value for reporting period
│   │   │   │   └── statement.ts        # Statement of Assets snapshot
│   │   │   ├── fx/
│   │   │   │   └── converter.ts        # Multi-currency conversion
│   │   │   └── index.ts
│   │   ├── __tests__/
│   │   │   ├── cost/
│   │   │   │   ├── cost-methods.test.ts   # FIFO + Moving Average tests
│   │   │   │   └── split.test.ts
│   │   │   ├── helpers/
│   │   │   │   └── transaction-amounts.test.ts
│   │   │   ├── irr.test.ts
│   │   │   ├── ttwror.test.ts
│   │   │   ├── purchase-value.test.ts
│   │   │   └── cashflow-resolver.test.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── api/                        # Express 5 Backend
│   │   ├── src/
│   │   │   ├── index.ts            # Entry point + reloadApp (drain guard, atomic swap)
│   │   │   ├── create-app.ts       # Express app factory (all route mounts)
│   │   │   ├── config.ts           # QUOVIBE_DATA_DIR, QUOVIBE_DEMO_SOURCE, env vars
│   │   │   ├── db/
│   │   │   │   ├── client.ts       # SQLite connection (better-sqlite3) + backupDb
│   │   │   │   ├── open-db.ts      # Open + verify + apply extensions
│   │   │   │   ├── schema.ts       # Complete Drizzle schema (ppxml2db spec)
│   │   │   │   ├── verify.ts       # ppxml2db schema compatibility verification
│   │   │   │   └── extensions.ts   # Additional tables (non-destructive)
│   │   │   ├── routes/
│   │   │   │   ├── accounts.ts
│   │   │   │   ├── attribute-types.ts
│   │   │   │   ├── calendars.ts
│   │   │   │   ├── csv-import.ts          # CSV trade/price import endpoints
│   │   │   │   ├── debug.ts
│   │   │   │   ├── dashboard.ts           # Dashboard layout config (GET/PUT)
│   │   │   │   ├── import.ts
│   │   │   │   ├── performance.ts
│   │   │   │   ├── portfolio.ts
│   │   │   │   ├── prices.ts
│   │   │   │   ├── rebalancing.ts
│   │   │   │   ├── reports.ts
│   │   │   │   ├── securities.ts
│   │   │   │   ├── security-events.ts
│   │   │   │   ├── security-search.ts
│   │   │   │   ├── settings.ts            # Reporting periods + investments-view sidecar
│   │   │   │   ├── taxonomies.ts          # Taxonomy read + PATCH allocation weight
│   │   │   │   ├── taxonomy-write.ts      # Taxonomy/category/assignment CRUD
│   │   │   │   └── transactions.ts
│   │   │   ├── services/
│   │   │   │   ├── accounts.service.ts      # Account balance and logic
│   │   │   │   ├── benchmark.service.ts     # Benchmark series computation (FX + sampling)
│   │   │   │   ├── csv/                     # CSV import subsystem
│   │   │   │   │   ├── csv-config.service.ts   # CRUD for saved CSV column mappings
│   │   │   │   │   ├── csv-import.service.ts   # CSV → transaction insert orchestrator
│   │   │   │   │   ├── csv-price-mapper.ts     # Map CSV columns to price fields
│   │   │   │   │   ├── csv-reader.ts           # Parse CSV with configurable delimiters
│   │   │   │   │   └── csv-trade-mapper.ts     # Map CSV columns to trade fields
│   │   │   │   ├── data-series.service.ts   # Taxonomy slice data series
│   │   │   │   ├── fx.service.ts            # ECB exchange rates
│   │   │   │   ├── fx-fetcher.service.ts    # FX rate fetching
│   │   │   │   ├── import.service.ts        # ppxml2db validation + temp DB
│   │   │   │   ├── movers.service.ts        # Top/bottom performers with sparklines
│   │   │   │   ├── performance.service.ts   # Engine orchestrator
│   │   │   │   ├── prices.service.ts        # Yahoo Finance fetch
│   │   │   │   ├── rebalancing.service.ts   # Portfolio rebalancing logic
│   │   │   │   ├── reports.service.ts       # Report generation logic
│   │   │   │   ├── security-search-import.service.ts  # Import prices into DB (from search preview)
│   │   │   │   ├── settings.service.ts      # Sidecar settings load/save + chart-config
│   │   │   │   ├── statement-cache.ts       # Statement of Assets caching
│   │   │   │   ├── taxonomy.service.ts      # Taxonomy/category/assignment CRUD logic
│   │   │   │   ├── taxonomy-performance.service.ts  # Taxonomy slice performance
│   │   │   │   ├── transaction.service.ts   # CRUD logic with double-entry
│   │   │   │   ├── unit-conversion.ts       # shares/10^8, amount/10^2
│   │   │   │   └── yahoo-search.service.ts  # Yahoo securities search
│   │   │   ├── data/
│   │   │   │   └── taxonomy-templates.ts    # 7 pre-built templates (asset classes, GICS, regions...)
│   │   │   └── middleware/
│   │   │       ├── error-handler.ts
│   │   │       └── reporting-period.ts      # Parse period from query params
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── web/                        # React Frontend
│       ├── src/
│       │   ├── main.tsx
│       │   ├── router.tsx              # React Router v7 config
│       │   ├── api/                     # TanStack Query hooks
│       │   │   ├── fetch.ts             # apiFetch wrapper
│       │   │   ├── query-client.ts
│       │   │   ├── types.ts             # API response types
│       │   │   ├── use-accounts.ts
│       │   │   ├── use-attribute-types.ts
│       │   │   ├── use-benchmark-series.ts     # Benchmark TTWROR series
│       │   │   ├── use-chart-config.ts         # Chart config sidecar (benchmarks)
│       │   │   ├── use-chart-series.ts         # Unified multi-series data (portfolio, security, benchmark)
│       │   │   ├── use-csv-import.ts           # CSV import mutations + config hooks
│       │   │   ├── use-dashboard-config.ts
│       │   │   ├── use-import.ts
│       │   │   ├── use-init-portfolio.ts
│       │   │   ├── use-investments-view.ts     # Column visibility sidecar
│       │   │   ├── use-movers.ts               # Top/bottom performers query
│       │   │   ├── use-performance.ts
│       │   │   ├── use-portfolio.ts
│       │   │   ├── use-rebalancing.ts
│       │   │   ├── use-reporting-periods.ts
│       │   │   ├── use-reports.ts
│       │   │   ├── use-securities.ts
│       │   │   ├── use-security-events.ts
│       │   │   ├── use-table-layout.ts         # Persisted column widths / sort state
│       │   │   ├── use-taxonomies.ts
│       │   │   ├── use-taxonomy-mutations.ts   # CRUD mutations + cache invalidation
│       │   │   ├── use-taxonomy-series.ts      # Taxonomy slice performance
│       │   │   ├── use-taxonomy-tree.ts
│       │   │   └── use-transactions.ts
│       │   ├── components/
│       │   │   ├── ui/                  # shadcn/ui primitives (do not touch)
│       │   │   ├── layout/
│       │   │   │   ├── Shell.tsx              # App shell (sidebar + topbar + outlet)
│       │   │   │   ├── Sidebar.tsx            # DesktopSidebar, CollapsedSidebar, MobileNav, SidebarDrawer
│       │   │   │   ├── TopBar.tsx             # Period pills, toggle group (privacy + theme), language
│       │   │   │   └── ExpandableNavItem.tsx  # Expandable nav section (taxonomies)
│       │   │   ├── domain/
│       │   │   │   ├── TransactionForm.tsx
│       │   │   │   ├── PriceChart.tsx
│       │   │   │   ├── TaxonomyChart.tsx       # Donut/bar chart (bidirectional hover)
│       │   │   │   ├── RebalancingTable.tsx     # Actual vs target, delta, weights
│       │   │   │   ├── CreateTaxonomyDialog.tsx # Create with template picker
│       │   │   │   ├── DeleteTaxonomyDialog.tsx
│       │   │   │   ├── AssignCategoryDialog.tsx # Assign security/account to category
│       │   │   │   ├── CategoryColorPicker.tsx
│       │   │   │   ├── TaxonomyNodePicker.tsx
│       │   │   │   ├── CreateAccountDialog.tsx
│       │   │   │   ├── AddInstrumentDialog/      # Spotlight search + detail sheet
│       │   │   │   │   ├── index.tsx             # Dialog orchestrator (state, keyboard nav, create flow)
│       │   │   │   │   ├── InstrumentSearch.tsx  # Search input + filter chips
│       │   │   │   │   ├── InstrumentResultsList.tsx  # Results listbox with keyboard nav
│       │   │   │   │   ├── InstrumentResultCard.tsx   # Individual result card
│       │   │   │   │   ├── InstrumentDetail.tsx  # Detail panel + price preview + CTA
│       │   │   │   │   ├── InstrumentTypeBadge.tsx    # Colored type badge
│       │   │   │   │   ├── CreateEmptyInstrument.tsx  # Manual creation link
│       │   │   │   │   └── types.ts              # Local types (DialogView)
│       │   │   │   ├── SecurityEditor/          # Sheet-based security editor (scrollable sections)
│       │   │   │   │   ├── index.tsx
│       │   │   │   │   ├── MasterDataSection.tsx
│       │   │   │   │   ├── PriceFeedSection.tsx
│       │   │   │   │   ├── AttributesSection.tsx
│       │   │   │   │   ├── TaxonomiesSection.tsx
│       │   │   │   │   ├── SectionHeader.tsx
│       │   │   │   ├── csv-import/              # CSV import wizard steps
│       │   │   │   │   ├── CsvUploadStep.tsx        # File upload + delimiter config
│       │   │   │   │   ├── CsvColumnMapStep.tsx     # Column mapping UI
│       │   │   │   │   ├── CsvPreviewStep.tsx       # Preview parsed transactions
│       │   │   │   │   ├── CsvSecurityMatchStep.tsx # Match CSV securities to DB
│       │   │   │   │   └── CsvPriceImportDialog.tsx # Historical price import from CSV
│       │   │   │   ├── widgets/                 # Individual dashboard widget components
│       │   │   │   │   ├── WidgetAbsoluteChange.tsx
│       │   │   │   │   ├── WidgetAbsolutePerformance.tsx
│       │   │   │   │   ├── WidgetBenchmarkComparison.tsx
│       │   │   │   │   ├── WidgetCalculationCompact.tsx
│       │   │   │   │   ├── WidgetCashDrag.tsx          # Cash drag donut + liquidity ratio
│       │   │   │   │   ├── WidgetCostTaxDrag.tsx       # Fee/tax drag metrics
│       │   │   │   │   ├── WidgetCurrentDrawdown.tsx
│       │   │   │   │   ├── WidgetDelta.tsx
│       │   │   │   │   ├── WidgetDrawdownChart.tsx
│       │   │   │   │   ├── WidgetIrr.tsx
│       │   │   │   │   ├── WidgetMarketValue.tsx
│       │   │   │   │   ├── WidgetMaxDrawdown.tsx
│       │   │   │   │   ├── WidgetMaxDrawdownDuration.tsx
│       │   │   │   │   ├── WidgetMovers.tsx            # Top/bottom performers with sparklines
│       │   │   │   │   ├── WidgetPerfChart.tsx
│       │   │   │   │   ├── WidgetReturnsHeatmap.tsx
│       │   │   │   │   ├── WidgetSemivariance.tsx
│       │   │   │   │   ├── WidgetSharpeRatio.tsx
│       │   │   │   │   ├── WidgetTtwror.tsx
│       │   │   │   │   ├── WidgetTtwrorPa.tsx
│       │   │   │   │   └── WidgetVolatility.tsx
│       │   │   │   ├── PriceFeedConfig.tsx
│       │   │   │   ├── CorporateEventDialog.tsx
│       │   │   │   ├── StockSplitDialog.tsx
│       │   │   │   ├── BenchmarkConfigDialog.tsx      # Benchmark selection (gear icon on chart)
│       │   │   │   ├── BenchmarkWidgetConfigDialog.tsx # Benchmark widget security picker
│       │   │   │   ├── HolidayTable.tsx
│       │   │   │   ├── PaymentBreakdownTooltip.tsx
│       │   │   │   ├── AccountDetailTabs.tsx    # Inner tabs (Cash Account / Transactions) for AccountDetail
│       │   │   │   ├── AccountSummaryStrip.tsx  # KPI strip shown on Investments when filtered by account
│       │   │   │   ├── BrokerageUnitCard.tsx    # Collapsed brokerage card with split bar
│       │   │   │   ├── BrokerageUnitExpanded.tsx # Expanded brokerage: security chips + cash details
│       │   │   │   ├── StandaloneDepositCard.tsx # Card for deposit accounts not linked to a portfolio
│       │   │   │   ├── CashAccountView.tsx      # Cash balance + history view inside AccountDetail
│       │   │   │   ├── PeriodOverrideDialog.tsx # Per-widget period override (pills + custom range)
│       │   │   │   ├── WidgetShell.tsx          # Widget container with kebab menu + period badge
│       │   │   │   ├── WidgetCatalogDialog.tsx  # Catalog for adding widgets to a dashboard tab
│       │   │   │   ├── SecurityDrawer.tsx        # Side drawer with security detail (from Investments table)
│       │   │   │   ├── CalculationBreakdownCard.tsx
│       │   │   │   ├── CalculationDetail.tsx
│       │   │   │   ├── DataSeriesDialog.tsx
│       │   │   │   ├── DataSeriesPickerDialog.tsx  # Data series picker for widget config
│       │   │   │   ├── DataSeriesSelector.tsx
│       │   │   │   ├── CategoryNameDialog.tsx
│       │   │   │   ├── MoveCategoryDialog.tsx
│       │   │   │   ├── NewPeriodDialog.tsx
│       │   │   │   └── WeightEditDialog.tsx
│       │   │   └── shared/
│       │   │       ├── DataTable.tsx             # TanStack Table wrapper (persistence, sort, resize, reorder, export, virtualization)
│       │   │       ├── TableToolbar.tsx          # Unified toolbar (search, custom filters, reset)
│       │   │       ├── CurrencyDisplay.tsx       # Privacy-aware + colorSign prop
│       │   │       ├── DateRangePicker.tsx
│       │   │       ├── MetricCard.tsx            # KPI display card
│       │   │       ├── KpiCard.tsx               # KPI card variant
│       │   │       ├── LazySection.tsx           # IntersectionObserver deferred mounting
│       │   │       ├── FadeIn.tsx                # Fade-in animation
│       │   │       ├── LanguageSwitcher.tsx
│       │   │       ├── ChartExportButton.tsx     # Export chart as PNG
│       │   │       ├── ChartSkeleton.tsx
│       │   │       ├── ChartTooltip.tsx          # Frosted glass tooltip + ChartTooltipRow
│       │   │       ├── MetricCardSkeleton.tsx
│       │   │       ├── SectionSkeleton.tsx
│       │   │       ├── TableSkeleton.tsx
│       │   │       ├── ColumnVisibilityToggle.tsx
│       │   │       ├── EmptyState.tsx
│       │   │       ├── PageHeader.tsx
│       │   │       ├── SharesDisplay.tsx         # Privacy-aware shares display
│       │   │       ├── SidecarSync.tsx           # Syncs sidecar settings to/from server
│       │   │       ├── SummaryStrip.tsx          # Generic KPI summary strip
│       │   │       ├── TypeBadge.tsx             # Transaction type badge
│       │   │       └── UnsavedChangesAlert.tsx   # Dirty-state alert for unsaved form changes
│       │   ├── pages/
│       │   │   ├── Dashboard.tsx
│       │   │   ├── AccountsHub.tsx            # Accounts Hub: brokerage unit cards + standalone deposits
│       │   │   ├── Investments.tsx            # Unified: securities list + statement + holdings + performance
│       │   │   ├── SecurityDetail.tsx
│       │   │   ├── Transactions.tsx
│       │   │   ├── TransactionNew.tsx
│       │   │   ├── AccountDetail.tsx
│       │   │   ├── Analytics.tsx              # Parent shell for analytics sub-routes
│       │   │   ├── Calculation.tsx
│       │   │   ├── PerformanceChart.tsx
│       │   │   ├── Payments.tsx               # Dividends, interest, fees, taxes
│       │   │   ├── TaxonomySeries.tsx         # Taxonomy slice performance
│       │   │   ├── AssetAllocation.tsx        # Definition + Rebalancing views
│       │   │   ├── CsvImportPage.tsx          # CSV trade import wizard (standalone)
│       │   │   ├── Settings.tsx               # 4 tabs: portfolio, presentation, dataSources, advanced
│       │   │   └── ImportPage.tsx             # Standalone (no sidebar)
│       │   ├── i18n/                   # Internationalization
│       │   │   ├── index.ts            # i18next config
│       │   │   └── locales/            # 8 languages × 11 namespaces
│       │   │       ├── en/             # common, navigation, dashboard, securities, investments,
│       │   │       ├── it/             # transactions, accounts, performance, reports, settings, errors
│       │   │       ├── de/
│       │   │       ├── fr/
│       │   │       ├── es/
│       │   │       ├── nl/
│       │   │       ├── pl/
│       │   │       └── pt/
│       │   ├── context/
│       │   │   ├── privacy-context.tsx         # Privacy mode (blur amounts)
│       │   │   └── widget-config-context.tsx   # Widget period overrides + dashboard state
│       │   ├── hooks/
│       │   │   ├── use-theme.ts
│       │   │   ├── use-chart-colors.ts         # Theme-aware chart palette (reads CSS vars at runtime)
│       │   │   ├── use-chart-theme.ts          # Centralized chart grid/axis/cursor styling tokens
│       │   │   ├── useColumnDnd.ts              # Column drag-and-drop reordering (@dnd-kit)
│       │   │   ├── useColumnVisibility.ts
│       │   │   ├── use-debounce.ts             # Generic debounce hook (used by search)
│       │   │   ├── use-display-preferences.ts
│       │   │   ├── useInvestmentsColumns.tsx   # Column definitions + performance columns
│       │   │   ├── useSecurityDrawerData.ts    # Data fetching for SecurityDrawer
│       │   │   ├── use-language.ts
│       │   │   ├── use-widget-calculation.ts
│       │   │   ├── use-widget-chart-calculation.ts
│       │   │   ├── use-unsaved-changes-guard.ts # Dirty-state guard: intercepts Sheet close when isDirty
│       │   │   └── use-widget-kpi-meta.ts
│       │   └── lib/
│       │       ├── formatters.ts           # Currency, dates, percentages (uses i18n.language)
│       │       ├── colors.ts              # getColor(), getValueColorStyle(), COLORS proxy (reads CSS vars)
│       │       ├── utils.ts               # cn(), txTypeKey(), helpers
│       │       ├── privacy.ts             # maskCurrency(), maskShares()
│       │       ├── transaction-display.ts # getTransactionCashflowSign() (context-aware)
│       │       ├── transaction-payload.ts # Build transaction payloads for API mutations
│       │       ├── period-utils.ts        # DEFAULT_PERIODS, formatPeriodLabel, getPeriodId, ALL_PERIOD_ID
│       │       ├── calculation-rows.ts    # Calculation tab row helpers
│       │       ├── chart-formatters.ts    # Chart axis/tooltip formatters
│       │       ├── currencies.ts
│       │       ├── data-series-utils.ts   # Resolve data series to API query params
│       │       ├── drag-utils.ts          # Drag-and-drop utility helpers
│       │       ├── enums.ts
│       │       ├── metric-registry.ts
│       │       ├── widget-registry.ts     # Widget type registry for dashboard
│       │       ├── pagination.ts
│       │       ├── image-utils.ts
│       │       ├── table-sort-functions.ts # Sort functions with nulls-last (numeric, date, string, boolean, decimalJs)
│       │       ├── column-factories.tsx    # Column type factories (numeric, currency, percent, date, shares, text, boolean)
│       │       ├── table-export.ts        # CSV export utility (buildCsvContent, exportTableToCSV)
│       │       └── security-completeness.ts # Completeness indicator rules (no-taxonomy, no-feed, no-isin, retired)
│       ├── package.json
│       └── tsconfig.json
│
├── scripts/                        # Governance & automation scripts
│   ├── check-architecture.ts       # Dependency boundaries, export check
│   ├── check-docs-alignment.sh     # Verify doc↔code alignment
│   ├── check-governance.ts         # Doc↔code consistency, reference enforcement
│   ├── ci.sh                       # CI pipeline script
│   ├── preflight.sh                # Session start checks
│   ├── postflight.sh               # Session end checks + CHANGELOG
│   └── generate-changelog-entry.sh
│
├── data/                           # Mounted as Docker volume (portfolio.db not committed)
│
└── docs/                           # Project documentation
    ├── architecture/               # Architecture documentation (this directory)
    └── adr/                        # Architecture Decision Records
```
