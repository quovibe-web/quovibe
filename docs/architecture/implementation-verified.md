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
