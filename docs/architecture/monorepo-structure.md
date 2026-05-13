# Monorepo Structure

```
quovibe/
├── docker-compose.yml
├── docker-compose.dev.yml
├── Dockerfile
├── Dockerfile.dev
├── package.json                    # root scripts (build, lint, test, governance gates)
├── pnpm-workspace.yaml
├── pnpm-lock.yaml
├── tsconfig.base.json
├── vitest.config.ts                # root test runner (orchestrates all package suites)
├── eslint.config.mjs
├── README.md
├── CONTRIBUTING.md
├── CODE_OF_CONDUCT.md
├── LICENSE
├── CLAUDE.md                       # Lean root memory (links to .claude/rules/*.md)
├── .claude/
│   ├── rules/                      # Glob-scoped Claude rules (auto-load by file context)
│   ├── commands/
│   └── settings.json
│
├── packages/
│   ├── shared/                     # Types, Zod schemas, calendars, CSV/XML helpers, period resolver
│   │   ├── src/
│   │   │   ├── types/                  # Hand-written response types (legacy; new code uses z.infer)
│   │   │   │   ├── account.ts
│   │   │   │   ├── benchmark.ts
│   │   │   │   ├── calculation.ts
│   │   │   │   ├── dashboard.ts
│   │   │   │   ├── price.ts
│   │   │   │   ├── security.ts
│   │   │   │   ├── taxonomy.ts
│   │   │   │   ├── transaction.ts
│   │   │   │   └── index.ts
│   │   │   ├── schemas/                # Zod schemas — single source of truth for validation
│   │   │   │   ├── account.schema.ts
│   │   │   │   ├── benchmark.schema.ts        # BenchmarkConfig, ChartConfig (sidecar)
│   │   │   │   ├── data-series.schema.ts
│   │   │   │   ├── logo.schema.ts
│   │   │   │   ├── portfolio.schema.ts        # createPortfolioSchema (discriminated union), setupPortfolioSchema
│   │   │   │   ├── prices.schema.ts
│   │   │   │   ├── reports.schema.ts
│   │   │   │   ├── security.schema.ts
│   │   │   │   ├── security-event.schema.ts
│   │   │   │   ├── security-search.schema.ts
│   │   │   │   ├── settings.schema.ts          # Sidecar quovibe.settings.json shape
│   │   │   │   ├── taxonomy.schema.ts
│   │   │   │   ├── transaction.schema.ts       # Per-type invariants (BUG-106/111/112/113)
│   │   │   │   ├── watchlist.schema.ts
│   │   │   │   ├── utils.ts
│   │   │   │   └── index.ts
│   │   │   ├── calendars/              # Trading calendars (holidays, Easter)
│   │   │   │   ├── definitions/        # Americas, Asia-Pacific, Europe, Generic
│   │   │   │   ├── calendar-utils.ts
│   │   │   │   ├── easter.ts           # Computus algorithm
│   │   │   │   ├── registry.ts
│   │   │   │   ├── resolve.ts
│   │   │   │   ├── rules.ts
│   │   │   │   ├── types.ts
│   │   │   │   └── index.ts
│   │   │   ├── csv/                    # Pure CSV helpers (parsers, sniff, FX rate inversion)
│   │   │   │   ├── csv-fx.ts           # ppRateToQvRate, verifyGrossRateValue (BUG-121)
│   │   │   │   ├── csv-normalizer.ts
│   │   │   │   ├── csv-sniff.ts        # sniffLikelyTradeCsv (BUG-46 step-1 heuristic)
│   │   │   │   ├── csv-types.ts
│   │   │   │   ├── type-aliases.ts
│   │   │   │   └── index.ts
│   │   │   ├── xml/                    # Pure PP-XML client-side sniff (BUG-09)
│   │   │   │   ├── xml-sniff.ts
│   │   │   │   └── index.ts
│   │   │   ├── enums.ts                # TransactionType, CostMethod, AccountType, InstrumentType
│   │   │   ├── instrument-type.ts
│   │   │   ├── cashflow.ts             # Cashflow definitions per level (portfolio/account/security)
│   │   │   ├── constants.ts
│   │   │   ├── reporting-period-resolver.ts
│   │   │   ├── transaction-gating.ts   # CROSS_CURRENCY_FX_TYPES, AMOUNT_REQUIRED_TYPES, etc.
│   │   │   └── index.ts
│   │   ├── __tests__/
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── engine/                     # Pure financial logic (zero I/O — ESLint-enforced)
│   │   ├── src/
│   │   │   ├── cost/
│   │   │   │   ├── fifo.ts
│   │   │   │   ├── moving-average.ts
│   │   │   │   ├── split.ts
│   │   │   │   ├── types.ts
│   │   │   │   └── index.ts
│   │   │   ├── performance/
│   │   │   │   ├── irr.ts                  # Newton-Raphson + Brent fallback
│   │   │   │   ├── ttwror.ts
│   │   │   │   ├── benchmark.ts            # PP-compliant cumulative return series
│   │   │   │   ├── simple-return.ts
│   │   │   │   ├── absolute-performance.ts
│   │   │   │   ├── monthly-returns.ts
│   │   │   │   ├── annualize.ts
│   │   │   │   ├── risk.ts                 # Volatility, Sharpe, semivariance, drawdown
│   │   │   │   └── index.ts
│   │   │   ├── cashflow/
│   │   │   │   ├── resolver.ts
│   │   │   │   ├── portfolio-level.ts
│   │   │   │   ├── account-level.ts
│   │   │   │   ├── security-level.ts
│   │   │   │   └── index.ts
│   │   │   ├── valuation/
│   │   │   │   ├── market-value.ts
│   │   │   │   ├── period-gains.ts
│   │   │   │   ├── purchase-value.ts
│   │   │   │   ├── statement.ts
│   │   │   │   └── index.ts
│   │   │   ├── fx/
│   │   │   │   ├── converter.ts
│   │   │   │   ├── currency-gains.ts
│   │   │   │   ├── rate-map.ts
│   │   │   │   └── index.ts
│   │   │   ├── helpers/
│   │   │   │   └── transaction-amounts.ts
│   │   │   ├── __tests__/
│   │   │   │   └── regression/             # Calculation regression suite pinned to fixture DBs
│   │   │   │       ├── absolute-perf-regression.test.ts
│   │   │   │       ├── fifo-regression.test.ts
│   │   │   │       ├── fx-regression.test.ts
│   │   │   │       └── ttwror-regression.test.ts
│   │   │   └── index.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── api/                        # Express 5 backend
│   │   ├── src/
│   │   │   ├── index.ts                # Entry + reloadApp (drain guard, atomic swap)
│   │   │   ├── create-app.ts           # Express factory (route mounts, middleware order)
│   │   │   ├── bootstrap.ts            # Boot-time wiring (registry load, recovery, startup tasks)
│   │   │   ├── config.ts               # QUOVIBE_DATA_DIR, QUOVIBE_DEMO_SOURCE, IMPORT_MAX_MB, …
│   │   │   ├── db/
│   │   │   │   ├── bootstrap.sql           # DDL source of truth (ADR-015)
│   │   │   │   ├── apply-bootstrap.ts      # Idempotent apply + VENDOR_COLUMN_PATCHES
│   │   │   │   ├── backup.ts               # backupDb (online .backup API)
│   │   │   │   ├── open-db.ts              # openDatabase + verify + extensions
│   │   │   │   ├── schema.ts               # Drizzle ORM view (parity-checked vs bootstrap.sql)
│   │   │   │   └── verify.ts
│   │   │   ├── helpers/
│   │   │   │   ├── portfolio-cache.ts      # Typed WeakMap<Database, T> per ADR-016
│   │   │   │   └── request.ts
│   │   │   ├── lib/
│   │   │   │   └── atomic-fs.ts            # Crash-safe write via temp + rename
│   │   │   ├── middleware/
│   │   │   │   ├── broadcast-mutations.ts  # Cross-tab BroadcastChannel emission on writes
│   │   │   │   ├── error-handler.ts
│   │   │   │   ├── portfolio-context.ts    # /api/p/:portfolioId/* — opens DB, attaches sqlite to req
│   │   │   │   └── reporting-period.ts
│   │   │   ├── providers/                  # Price-feed providers (registry-dispatched)
│   │   │   │   ├── alphavantage.provider.ts
│   │   │   │   ├── json.provider.ts
│   │   │   │   ├── table.provider.ts
│   │   │   │   ├── yahoo.provider.ts
│   │   │   │   ├── yahoo-client.ts
│   │   │   │   ├── registry.ts
│   │   │   │   ├── types.ts
│   │   │   │   ├── utils.ts
│   │   │   │   └── index.ts
│   │   │   ├── routes/
│   │   │   │   ├── accounts.ts
│   │   │   │   ├── attribute-types.ts
│   │   │   │   ├── calendars.ts
│   │   │   │   ├── chart-config.ts             # Per-portfolio chart content sidecar
│   │   │   │   ├── csv-import.ts
│   │   │   │   ├── dashboard.ts
│   │   │   │   ├── debug.ts
│   │   │   │   ├── events.ts                   # Live SSE event stream (cross-tab broadcast)
│   │   │   │   ├── import.ts                   # POST /api/import/xml (PP-XML upload)
│   │   │   │   ├── logo.ts
│   │   │   │   ├── performance.ts
│   │   │   │   ├── portfolio.ts                # Single-portfolio context routes
│   │   │   │   ├── portfolios.ts               # Registry CRUD (create / list / rename / delete)
│   │   │   │   ├── prices.ts
│   │   │   │   ├── rebalancing.ts
│   │   │   │   ├── reports.ts
│   │   │   │   ├── securities.ts
│   │   │   │   ├── security-events.ts
│   │   │   │   ├── security-search.ts
│   │   │   │   ├── settings.ts
│   │   │   │   ├── setup.ts                    # /securities-accounts + /setup (BUG-54)
│   │   │   │   ├── taxonomies.ts
│   │   │   │   ├── taxonomy-write.ts
│   │   │   │   ├── transactions.ts
│   │   │   │   └── watchlists.ts
│   │   │   ├── services/
│   │   │   │   ├── accounts.service.ts
│   │   │   │   ├── auto-fetch.ts
│   │   │   │   ├── benchmark.service.ts
│   │   │   │   ├── boot-recovery.ts            # Crash-recovery for in-flight imports
│   │   │   │   ├── chart-config.service.ts
│   │   │   │   ├── chart-config-migrations.ts
│   │   │   │   ├── csv/
│   │   │   │   │   ├── csv-config.service.ts
│   │   │   │   │   ├── csv-import.service.ts
│   │   │   │   │   ├── csv-price-mapper.ts
│   │   │   │   │   ├── csv-reader.ts
│   │   │   │   │   └── csv-trade-mapper.ts
│   │   │   │   ├── dashboard.service.ts
│   │   │   │   ├── dashboard-seed.ts
│   │   │   │   ├── data-series.service.ts
│   │   │   │   ├── fx.service.ts
│   │   │   │   ├── fx-fetcher.service.ts
│   │   │   │   ├── fx-scheduler.service.ts       # Per-portfolio FX refresh (next 17 CET / 6h cap)
│   │   │   │   ├── import.service.ts           # ppxml2db orchestration + lock + sanitization
│   │   │   │   ├── import-validation.ts
│   │   │   │   ├── logo-resolver.service.ts
│   │   │   │   ├── movers.service.ts
│   │   │   │   ├── performance.service.ts
│   │   │   │   ├── portfolio-db-pool.ts        # better-sqlite3 handle pool (per portfolio)
│   │   │   │   ├── portfolio-manager.ts        # Create/rename/delete + seed (BUG-54)
│   │   │   │   ├── portfolio-registry.ts       # data/portfolios.json metadata index
│   │   │   │   ├── prices.service.ts
│   │   │   │   ├── rebalancing.service.ts
│   │   │   │   ├── reference-data.ts           # Pure per-portfolio reads (ADR-016)
│   │   │   │   ├── reports.service.ts
│   │   │   │   ├── securities.service.ts
│   │   │   │   ├── security-search-import.service.ts
│   │   │   │   ├── settings.service.ts
│   │   │   │   ├── taxonomy.service.ts
│   │   │   │   ├── taxonomy-performance.service.ts
│   │   │   │   ├── transaction.service.ts      # Double-entry BUY/SELL (.claude/rules/double-entry.md)
│   │   │   │   ├── unit-conversion.ts
│   │   │   │   ├── watchlists.service.ts
│   │   │   │   ├── widget-migrations.ts
│   │   │   │   └── yahoo-search.service.ts
│   │   │   ├── data/
│   │   │   │   └── taxonomy-templates.ts
│   │   │   ├── tests/
│   │   │   │   └── audit/                      # Read-path + write-path audit suites
│   │   │   ├── types/
│   │   │   │   └── express.d.ts
│   │   │   └── __tests__/                      # supertest end-to-end suites
│   │   ├── vendor/
│   │   │   ├── ppxml2db_init.py                # Upstream baseline schema (Gate 1 source)
│   │   │   ├── ppxml2db.py
│   │   │   ├── requirements.txt                # Pinned Python deps (lxml only)
│   │   │   ├── account.sql                     # Per-table verbatim SQL fragments
│   │   │   └── xact.sql                        # (and ~22 other *.sql files — one per ppxml2db table)
│   │   ├── scripts/                            # bootstrap.sql regen + parity helpers
│   │   │   ├── regen-bootstrap.sh
│   │   │   ├── check-bootstrap-fresh.sh
│   │   │   ├── normalize-bootstrap.mjs
│   │   │   ├── dump-schema.mjs
│   │   │   └── exec-sql.mjs
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── web/                        # React 19 + Vite frontend
│       ├── src/
│       │   ├── main.tsx
│       │   ├── router.tsx                  # React Router v7 (Shell + sibling welcome/setup routes)
│       │   ├── globals.css                 # Tailwind v4 @theme + Flexoki palette tokens
│       │   ├── test-setup.ts
│       │   ├── vite-env.d.ts
│       │   ├── api/                        # apiFetch + TanStack Query hooks
│       │   │   ├── fetch.ts
│       │   │   ├── query-client.ts         # MutationCache global error toast + ApiError shape
│       │   │   ├── types.ts
│       │   │   ├── use-accounts.ts
│       │   │   ├── use-allocation-view.ts
│       │   │   ├── use-ath.ts
│       │   │   ├── use-attribute-types.ts
│       │   │   ├── use-benchmark-series.ts
│       │   │   ├── use-chart-config.ts
│       │   │   ├── use-chart-series.ts
│       │   │   ├── use-csv-import.ts
│       │   │   ├── use-dashboards.ts
│       │   │   ├── use-events.ts           # SSE subscription + cross-tab cache invalidation
│       │   │   ├── use-fx.ts
│       │   │   ├── use-import.ts
│       │   │   ├── use-investments-view.ts
│       │   │   ├── use-logo.ts
│       │   │   ├── use-movers.ts
│       │   │   ├── use-performance.ts
│       │   │   ├── use-portfolio.ts
│       │   │   ├── use-portfolios.ts       # Registry CRUD
│       │   │   ├── use-preferences.ts      # Sidecar user preferences
│       │   │   ├── use-rebalancing.ts
│       │   │   ├── use-reporting-periods.ts
│       │   │   ├── use-reports.ts
│       │   │   ├── use-scoped-api.ts       # Builds /api/p/:pid/* base URLs
│       │   │   ├── use-securities.ts
│       │   │   ├── use-securities-accounts.ts
│       │   │   ├── use-security-events.ts
│       │   │   ├── use-table-layout.ts
│       │   │   ├── use-taxonomies.ts
│       │   │   ├── use-taxonomy-mutations.ts
│       │   │   ├── use-taxonomy-series.ts
│       │   │   ├── use-taxonomy-tree.ts
│       │   │   ├── use-transactions.ts
│       │   │   └── use-watchlists.ts
│       │   ├── components/
│       │   │   ├── ui/                     # shadcn/ui primitives (do not touch)
│       │   │   ├── layout/
│       │   │   │   ├── Shell.tsx
│       │   │   │   ├── Sidebar.tsx
│       │   │   │   ├── TopBar.tsx              # Privacy only (theme/lang in Settings)
│       │   │   │   ├── ExpandableNavItem.tsx
│       │   │   │   ├── PortfolioSwitcher.tsx
│       │   │   │   └── DemoBadge.tsx
│       │   │   ├── welcome/                # Welcome / portfolio-setup chrome (no Shell)
│       │   │   │   ├── ActionCard.tsx
│       │   │   │   ├── WelcomeBackground.tsx
│       │   │   │   ├── WelcomeHero.tsx
│       │   │   │   ├── WelcomeTopBar.tsx
│       │   │   │   └── WelcomeFooter.tsx
│       │   │   ├── ImportDropzone.tsx
│       │   │   ├── ImportProgress.tsx
│       │   │   ├── domain/                 # Business-logic components
│       │   │   │   ├── TransactionForm.tsx
│       │   │   │   ├── transaction-form.schema.ts
│       │   │   │   ├── transaction-server-error.ts
│       │   │   │   ├── PriceChart.tsx
│       │   │   │   ├── TaxonomyChart.tsx
│       │   │   │   ├── RebalancingTable.tsx
│       │   │   │   ├── CommandPalette.tsx
│       │   │   │   ├── ChartSummaryBar.tsx
│       │   │   │   ├── PriceFeedConfig.tsx
│       │   │   │   ├── HolidayTable.tsx
│       │   │   │   ├── DashboardEmptyState.tsx
│       │   │   │   ├── DashboardHero.tsx
│       │   │   │   ├── DashboardMetricsStrip.tsx
│       │   │   │   ├── MetricsStripSettings.tsx
│       │   │   │   ├── PeriodOverrideDialog.tsx
│       │   │   │   ├── WidgetShell.tsx
│       │   │   │   ├── WidgetCatalogDialog.tsx
│       │   │   │   ├── BenchmarkWidgetConfigDialog.tsx
│       │   │   │   ├── WatchlistWidgetConfigDialog.tsx
│       │   │   │   ├── AddSecurityToWatchlistDialog.tsx
│       │   │   │   ├── CreateAccountDialog.tsx
│       │   │   │   ├── ChangeReferenceAccountDialog.tsx
│       │   │   │   ├── RenamePortfolioDialog.tsx
│       │   │   │   ├── DeletePortfolioDialog.tsx
│       │   │   │   ├── CreateTaxonomyDialog.tsx
│       │   │   │   ├── DeleteTaxonomyDialog.tsx
│       │   │   │   ├── DeleteCategoryDialog.tsx
│       │   │   │   ├── CategoryNameDialog.tsx
│       │   │   │   ├── MoveCategoryDialog.tsx
│       │   │   │   ├── CategoryColorPicker.tsx
│       │   │   │   ├── AssignCategoryDialog.tsx
│       │   │   │   ├── TaxonomyNodePickerPopover.tsx
│       │   │   │   ├── WeightEditDialog.tsx
│       │   │   │   ├── NewPeriodDialog.tsx
│       │   │   │   ├── DataSeriesDialog.tsx
│       │   │   │   ├── DataSeriesSelector.tsx
│       │   │   │   ├── CalculationBreakdownCard.tsx
│       │   │   │   ├── CalculationDetail.tsx
│       │   │   │   ├── CorporateEventDialog.tsx
│       │   │   │   ├── StockSplitDialog.tsx
│       │   │   │   ├── AccountDetailTabs.tsx
│       │   │   │   ├── AccountSummaryStrip.tsx
│       │   │   │   ├── BrokerageUnitCard.tsx
│       │   │   │   ├── BrokerageUnitExpanded.tsx
│       │   │   │   ├── StandaloneDepositCard.tsx
│       │   │   │   ├── CashAccountView.tsx
│       │   │   │   ├── SecurityDrawer.tsx
│       │   │   │   ├── EditBuyDialog.tsx
│       │   │   │   ├── EditSellDialog.tsx
│       │   │   │   ├── EditCashDialog.tsx
│       │   │   │   ├── EditDeliveryDialog.tsx
│       │   │   │   ├── EditRemovalDialog.tsx
│       │   │   │   ├── EditSecurityTransferDialog.tsx
│       │   │   │   ├── EditTaxRefundDialog.tsx
│       │   │   │   ├── AddInstrumentDialog/    # Spotlight search + detail sheet
│       │   │   │   ├── SecurityEditor/         # Sheet-based security editor
│       │   │   │   ├── SecurityDetail/
│       │   │   │   │   └── TaxonomyAssignmentsCard.tsx
│       │   │   │   ├── csv-import/             # Wizard steps (upload, map, match, preview)
│       │   │   │   ├── portfolio/              # PortfolioSetupForm + NewPortfolioDialog (BUG-54)
│       │   │   │   └── widgets/                # 26 dashboard widgets (KPIs, charts, lists)
│       │   │   └── shared/
│       │   │       ├── DataTable.tsx
│       │   │       ├── TableToolbar.tsx
│       │   │       ├── CurrencyDisplay.tsx     # Privacy-aware + colorSign
│       │   │       ├── SharesDisplay.tsx
│       │   │       ├── DateRangePicker.tsx
│       │   │       ├── AccessibleNumberFlow.tsx
│       │   │       ├── AccountAvatar.tsx
│       │   │       ├── SecurityAvatar.tsx
│       │   │       ├── CashBreakdown.tsx
│       │   │       ├── ChartExportButton.tsx
│       │   │       ├── ChartLegendOverlay.tsx
│       │   │       ├── ChartSkeleton.tsx
│       │   │       ├── ChartToolbar.tsx
│       │   │       ├── ChartTooltip.tsx
│       │   │       ├── ColumnVisibilityToggle.tsx
│       │   │       ├── EmptyState.tsx
│       │   │       ├── ErrorFallback.tsx
│       │   │       ├── FadeIn.tsx
│       │   │       ├── GainBadge.tsx
│       │   │       ├── KpiCard.tsx
│       │   │       ├── LanguageSwitcher.tsx
│       │   │       ├── LazySection.tsx
│       │   │       ├── MetricCard.tsx
│       │   │       ├── MetricCardSkeleton.tsx
│       │   │       ├── PageHeader.tsx
│       │   │       ├── RootRedirect.tsx
│       │   │       ├── SectionSkeleton.tsx
│       │   │       ├── SegmentedControl.tsx
│       │   │       ├── SidecarSync.tsx
│       │   │       ├── Sparkline.tsx
│       │   │       ├── SplitBar.tsx
│       │   │       ├── SubmitButton.tsx
│       │   │       ├── SummaryStrip.tsx
│       │   │       ├── TableSkeleton.tsx
│       │   │       ├── TypeBadge.tsx
│       │   │       └── UnsavedChangesAlert.tsx
│       │   ├── layouts/
│       │   │   ├── PortfolioLayout.tsx         # /p/:portfolioId/* — N=0 setup redirect
│       │   │   └── UserSettingsLayout.tsx
│       │   ├── pages/
│       │   │   ├── Welcome.tsx                 # No Shell (welcome chrome)
│       │   │   ├── PortfolioSetupPage.tsx      # /p/:pid/setup — sibling of PortfolioLayout
│       │   │   ├── ImportHub.tsx               # PP-XML + .db restore boundary
│       │   │   ├── Dashboard.tsx
│       │   │   ├── AccountsHub.tsx
│       │   │   ├── AccountDetail.tsx
│       │   │   ├── Investments.tsx             # Securities + statement + holdings + perf
│       │   │   ├── SecurityDetail.tsx
│       │   │   ├── Transactions.tsx
│       │   │   ├── TransactionNew.tsx
│       │   │   ├── Analytics.tsx               # Parent shell for analytics sub-routes
│       │   │   ├── Calculation.tsx
│       │   │   ├── PerformanceChart.tsx
│       │   │   ├── Payments.tsx
│       │   │   ├── TaxonomySeries.tsx
│       │   │   ├── AssetAllocation.tsx
│       │   │   ├── CsvImportPage.tsx
│       │   │   ├── Watchlists.tsx
│       │   │   ├── PortfolioSettings.tsx       # Per-portfolio settings (split from old Settings)
│       │   │   └── UserSettings.tsx            # Cross-portfolio user prefs
│       │   ├── i18n/
│       │   │   ├── index.ts                    # ns array — source of truth for namespaces
│       │   │   └── locales/                    # 8 languages (en/it/de/fr/es/nl/pl/pt) × N namespaces
│       │   │       └── en/                     # English; the other 7 lang dirs mirror this shape
│       │   │           ├── accounts.json
│       │   │           ├── common.json
│       │   │           ├── csv-import.json
│       │   │           ├── dashboard.json
│       │   │           ├── errors.json
│       │   │           ├── investments.json
│       │   │           ├── navigation.json
│       │   │           ├── performance.json
│       │   │           ├── portfolio-setup.json
│       │   │           ├── portfolioSettings.json
│       │   │           ├── reports.json
│       │   │           ├── securities.json
│       │   │           ├── settings.json
│       │   │           ├── switcher.json
│       │   │           ├── transactions.json
│       │   │           ├── userSettings.json
│       │   │           ├── watchlists.json
│       │   │           └── welcome.json
│       │   ├── context/
│       │   │   ├── PortfolioContext.tsx        # Active portfolio metadata + reference accounts
│       │   │   ├── privacy-context.tsx
│       │   │   ├── widget-config-context.tsx
│       │   │   └── analytics-context.tsx
│       │   ├── hooks/
│       │   │   ├── use-theme.ts
│       │   │   ├── use-base-currency.ts
│       │   │   ├── use-chart-colors.ts
│       │   │   ├── use-chart-theme.ts
│       │   │   ├── useColumnDnd.ts
│       │   │   ├── useColumnVisibility.ts
│       │   │   ├── use-crosshair-values.ts
│       │   │   ├── use-debounce.ts
│       │   │   ├── use-display-preferences.ts
│       │   │   ├── useDocumentTitle.ts
│       │   │   ├── use-guarded-submit.ts       # Save-button re-entry guard (BUG-141/145)
│       │   │   ├── useInvestmentsColumns.tsx
│       │   │   ├── use-language.ts
│       │   │   ├── use-lightweight-chart.ts
│       │   │   ├── useSecurityDrawerData.ts
│       │   │   ├── use-unsaved-changes-guard.ts
│       │   │   ├── use-widget-calculation.ts
│       │   │   ├── use-widget-chart-calculation.ts
│       │   │   ├── use-widget-invested-capital.ts
│       │   │   └── use-widget-kpi-meta.ts
│       │   └── lib/
│       │       ├── formatters.ts               # i18n-aware number/date/currency
│       │       ├── colors.ts                   # Reads CSS vars; Flexoki fallbacks
│       │       ├── utils.ts                    # cn(), txTypeKey(), helpers
│       │       ├── enums.ts
│       │       ├── currencies.ts
│       │       ├── privacy.ts
│       │       ├── period-utils.ts
│       │       ├── router-helpers.ts           # appendSearch (RedirectWithSearch — BUG-08)
│       │       ├── portfolio-recency.ts
│       │       ├── portfolio-switch-route.ts
│       │       ├── transaction-display.ts
│       │       ├── transaction-payload.ts
│       │       ├── chart-formatters.ts
│       │       ├── chart-series-factory.ts
│       │       ├── chart-types.ts
│       │       ├── calculation-rows.ts
│       │       ├── data-series-utils.ts
│       │       ├── dashboard-templates.ts
│       │       ├── drag-utils.ts
│       │       ├── fx-utils.ts
│       │       ├── image-utils.ts
│       │       ├── metric-registry.ts
│       │       ├── widget-registry.ts
│       │       ├── pagination.ts
│       │       ├── security-completeness.ts
│       │       ├── table-export.ts
│       │       ├── table-sort-functions.ts
│       │       ├── column-factories.tsx
│       │       ├── taxonomy-cascade.ts
│       │       └── taxonomy-flatten.ts
│       ├── package.json
│       └── tsconfig.json
│
├── eslint-rules/                   # Custom ESLint rules (governance)
│   ├── no-portfolio-scope-module-state.mjs   # ADR-016
│   └── no-unscoped-portfolio-api.mjs
│
├── scripts/                        # Governance & automation
│   ├── check-architecture.ts       # A1–A9 dependency boundaries
│   ├── check-governance.ts         # G1–G14 doc↔code consistency, upstream-ref ban, service-layer
│   ├── check-docs-alignment.sh
│   ├── ci.sh
│   ├── preflight.sh
│   ├── postflight.sh
│   ├── seed-demo.ts                # Seeds data/demo.db template
│   └── generate-changelog-entry.sh
│
├── tests/
│   └── golden-dataset/             # Cross-package fixtures (audit suites consume these)
│
├── data/                           # Docker volume — portfolio.db, demo.db, portfolios.json (gitignored)
│
└── docs/                           # Project documentation
    ├── architecture/               # Architecture documentation (this directory)
    ├── adr/                        # Architecture Decision Records (ADR-001…ADR-016)
    ├── release-notes/              # Public release notes
    ├── screenshots/                # Marketing screenshots referenced by README
    ├── audit/                      # Read-path / write-path / regression audit specs (gitignored)
    ├── pp-reference/               # PP business-logic reference (gitignored)
    ├── pp-verified/                # Behavior-verification notes (gitignored)
    └── superpowers/specs/          # Feature/bug TDD specs (gitignored)
```
