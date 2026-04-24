# Verified Write Methods

All exported service functions that perform database writes (INSERT, UPDATE, DELETE).
This document is the reference for governance check G11 — any new write method
must be added here to pass the automated check.

## transaction.service.ts

| Method | Tables written | Audit status |
|--------|---------------|--------------|
| `createTransaction` | xact, xact_unit, xact_cross_entry | Verified (write-parity audit) |
| `updateTransaction` | xact, xact_unit, xact_cross_entry | Verified (update-path audit) |
| `deleteTransaction` | xact, xact_unit, xact_cross_entry | Verified (contract parity test) |

## taxonomy.service.ts

| Method | Tables written | Audit status |
|--------|---------------|--------------|
| `createTaxonomy` | taxonomy, taxonomy_category | Verified (contract parity test) |
| `deleteTaxonomy` | taxonomy, taxonomy_category, taxonomy_data, taxonomy_assignment, taxonomy_assignment_data | Verified |
| `renameTaxonomy` | taxonomy | Verified |
| `createCategory` | taxonomy_category | Verified |
| `updateCategory` | taxonomy_category | Verified |
| `deleteCategory` | taxonomy_category, taxonomy_assignment, taxonomy_assignment_data | Verified |
| `createAssignment` | taxonomy_assignment | Verified |
| `updateAssignment` | taxonomy_assignment | Verified |
| `deleteAssignment` | taxonomy_assignment, taxonomy_assignment_data | Verified |
| `reorderTaxonomy` | taxonomy_data | Verified |
| `reorderCategory` | taxonomy_category | Verified (unit tests) |
| `updateCategoryAllocationsBulk` | taxonomy_category | Verified |

## settings.service.ts

| Method | Tables written | Audit status |
|--------|---------------|--------------|
| `updateSettings` | JSON file (no DB) | N/A — file-based |
| `updateAppState` | JSON file (no DB) | N/A — file-based |
| `updatePreferences` | JSON file (no DB) | N/A — file-based |

## prices.service.ts

| Method | Tables written | Audit status |
|--------|---------------|--------------|
| `fetchSecurityPrices` | price, latest_price | Verified |
| `fetchAllPrices` | price, latest_price | Verified (delegates to fetchSecurityPrices) |

## fx-fetcher.service.ts

| Method | Tables written | Audit status |
|--------|---------------|--------------|
| `fetchExchangeRates` | exchange_rate (virtual table) | Verified |
| `fetchAllExchangeRates` | exchange_rate (virtual table) | Verified (delegates to fetchExchangeRates) |

## import.service.ts

| Method | Tables written | Audit status |
|--------|---------------|--------------|
| `runImport` | All tables (full DB replacement via ppxml2db) | Verified |

## csv-config.service.ts

| Method | Tables written | Audit status |
|--------|---------------|--------------|
| `createCsvConfig` | csv_import_config | Verified |
| `updateCsvConfig` | csv_import_config | Verified |
| `deleteCsvConfig` | csv_import_config | Verified |

## accounts.service.ts

| Method | Tables written | Audit status |
|--------|---------------|--------------|
| `createAccount` | account | Verified — moved from route handler to enforce service-layer rule (BUG-06) |
| `updateAccountFields` | account | Verified — moved from route handler to enforce service-layer rule |
| `deleteAccountById` | account_attr, taxonomy_assignment_data, taxonomy_assignment, account | Verified — moved from route handler |

## watchlists.service.ts

| Method | Tables written | Audit status |
|--------|---------------|--------------|
| `updateWatchlistName` | watchlist | Verified — moved from route handler to enforce service-layer rule |
| `deleteWatchlistById` | watchlist_security, watchlist | Verified — moved from route handler |
| `duplicateWatchlistById` | watchlist, watchlist_security | Verified — moved from route handler |

## securities.service.ts

| Method | Tables written | Audit status |
|--------|---------------|--------------|
| `createSecurity` | security, security_prop | Verified — moved from route handler |
| `updateSecurity` | security, security_prop | Verified — moved from route handler |
| `updateSecurityTaxonomies` | taxonomy_assignment_data, taxonomy_assignment | Verified — moved from route handler |
| `updateSecurityFeedConfig` | security, security_prop | Verified — moved from route handler |
| `deleteSecurity` | security_attr, security_prop, taxonomy_assignment_data, taxonomy_assignment, price, latest_price, security_event, watchlist_security, security | Verified — moved from route handler |

## portfolio-registry.ts

Registry mutations operate on the `quovibe.settings.json` sidecar, not a DB table.
They update the `portfolios[]` index and `app.defaultPortfolioId` pointer.

| Method | Target | Audit status |
|--------|--------|--------------|
| `upsertPortfolioEntry` | sidecar portfolios[] | Verified (ADR-015 §3.14) |
| `removePortfolioEntry` | sidecar portfolios[] + app.defaultPortfolioId fallback | Verified (ADR-015 §3.14) |

## portfolio-manager.ts

Orchestrates per-portfolio DB lifecycle (bootstrap, clone, rename, delete). All
DB mutations are `applyBootstrap` + `vf_portfolio_meta` writes on newly created
.db files; the sidecar is updated via portfolio-registry.

| Method | Target | Audit status |
|--------|--------|--------------|
| `createPortfolio` | new portfolio-<uuid>.db (applyBootstrap + vf_portfolio_meta) + sidecar | Verified (ADR-015 §3.4a) |
| `renamePortfolio` | vf_portfolio_meta (name) + sidecar entry | Verified (ADR-015 §3.4b) |
| `deletePortfolio` | filesystem (portfolio .db + .bak.*) + sidecar | Verified (ADR-015 §3.4b) |

## dashboard.service.ts

Per-portfolio REST collection backed by `vf_dashboard`. All writes go through
the per-portfolio pool handle, never the route handler.

| Method | Tables written | Audit status |
|--------|---------------|--------------|
| `createDashboard` | vf_dashboard | Verified (ADR-015 §3.4c) |
| `updateDashboard` | vf_dashboard | Verified (ADR-015 §3.4c) |
| `deleteDashboard` | vf_dashboard | Verified (ADR-015 §3.4c) |
