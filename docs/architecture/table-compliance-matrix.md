# Table Compliance Matrix

Complete compliance status for all 12 table instances in QuoVibe.

---

## TABLE 1: Investments

| Criterion | Status |
|-----------|--------|
| Uses shared DataTable component | ✅ |
| Has a unique tableId | ✅ `investments` |
| Every column has explicit accessor returning raw value | ✅ |
| Every numeric column uses sortNumeric | ✅ |
| Every date column uses sortDate | ✅ |
| Every column header uses i18n key | ✅ |
| Every column defines size and minSize | ✅ |
| Numeric columns are right-aligned | ✅ |
| Sorting is enabled for all appropriate columns | ✅ (20/22, logo+actions disabled) |
| Default sort is defined and appropriate | ✅ `[]` (no default — user decides) |
| Sort indicators are visible | ✅ ArrowUp/Down/UpDown |
| Null values sort to the end consistently | ✅ |
| Column resizing is enabled | ✅ |
| Column reordering is enabled | ✅ (context menu) |
| Column visibility toggle available | ✅ (grouped picker) |
| Persistence works (tableId provided) | ✅ |
| Reset to defaults available | ✅ |
| Loading skeleton shown during data fetch | ✅ 10 rows |
| Empty state shown when no data | ✅ |
| Horizontal scroll on mobile | ✅ |
| Sticky first column | ✅ (logo) |
| Privacy mode works on all cells | ✅ |
| Export available | ✅ |
| Column definitions memoized | ✅ (useInvestmentsColumns hook) |
| ARIA attributes correct | ✅ |
| **Grade** | **A** |

---

## TABLE 2: Transactions

| Criterion | Status |
|-----------|--------|
| Uses shared DataTable component | ✅ |
| Has a unique tableId | ✅ `transactions` |
| Every column has explicit accessor returning raw value | ✅ |
| Every numeric column uses sortNumeric | ✅ |
| Every date column uses sortDate | ✅ |
| Every column header uses i18n key | ✅ |
| Every column defines size and minSize | ✅ |
| Numeric columns are right-aligned | ✅ |
| Sorting is enabled for all appropriate columns | ✅ (7/8, actions disabled) |
| Default sort is defined and appropriate | ✅ `date desc` |
| Sort indicators are visible | ✅ |
| Null values sort to the end consistently | ✅ |
| Column resizing is enabled | ✅ |
| Column reordering is enabled | ✅ |
| Column visibility toggle available | ✅ (3 groups) |
| Persistence works | ✅ |
| Reset to defaults available | ✅ |
| Loading skeleton shown during data fetch | ✅ |
| Empty state shown when no data | ✅ |
| Horizontal scroll on mobile | ✅ |
| Sticky first column | ❌ (not needed — actions sticky right) |
| Privacy mode works on all cells | ✅ |
| Export available | ✅ |
| Column definitions memoized | ✅ |
| ARIA attributes correct | ✅ |
| **Grade** | **A** |

---

## TABLE 3: SecurityDetail

| Criterion | Status |
|-----------|--------|
| Uses shared DataTable component | ✅ |
| Has a unique tableId | ✅ `security-transactions` |
| Every column has explicit accessor returning raw value | ✅ |
| Every numeric column uses sortNumeric | ✅ |
| Every date column uses sortDate | ✅ |
| Every column header uses i18n key | ✅ |
| Every column defines size and minSize | ❌ (factories provide defaults) |
| Numeric columns are right-aligned | ✅ |
| Sorting is enabled for all appropriate columns | ✅ |
| Default sort is defined and appropriate | ✅ `date desc` |
| Sort indicators are visible | ✅ |
| Null values sort to the end consistently | ✅ |
| Column resizing is enabled | ✅ |
| Column reordering is enabled | ✅ |
| Column visibility toggle available | ❌ (only 4 columns — intentional) |
| Persistence works | ✅ |
| Reset to defaults available | ✅ |
| Loading skeleton shown during data fetch | ✅ |
| Empty state shown when no data | ✅ |
| Horizontal scroll on mobile | ✅ |
| Sticky first column | ❌ (not needed) |
| Privacy mode works on all cells | ✅ |
| Export available | ❌ |
| Column definitions memoized | ✅ |
| ARIA attributes correct | ✅ |
| **Grade** | **B+** |

---

## TABLE 4: AccountDetailTabs

| Criterion | Status |
|-----------|--------|
| Uses shared DataTable component | ✅ |
| Has a unique tableId | ✅ `account-transactions` |
| Every column has explicit accessor returning raw value | ✅ |
| Every numeric column uses sortNumeric | ✅ |
| Every date column uses sortDate | ✅ |
| Every column header uses i18n key | ✅ |
| Every column defines size and minSize | ❌ (factories provide defaults) |
| Numeric columns are right-aligned | ✅ |
| Sorting is enabled for all appropriate columns | ✅ |
| Default sort is defined and appropriate | ✅ `date desc` |
| Sort indicators are visible | ✅ |
| Null values sort to the end consistently | ✅ |
| Column resizing is enabled | ✅ |
| Column reordering is enabled | ✅ |
| Column visibility toggle available | ❌ (only 4 columns — intentional) |
| Persistence works | ✅ |
| Reset to defaults available | ✅ |
| Loading skeleton shown during data fetch | ✅ |
| Empty state shown when no data | ✅ |
| Horizontal scroll on mobile | ✅ |
| Privacy mode works on all cells | ✅ |
| Export available | ❌ |
| Column definitions memoized | ✅ |
| ARIA attributes correct | ✅ |
| **Grade** | **B+** |

---

## TABLE 5: CashAccountView

| Criterion | Status |
|-----------|--------|
| Uses shared DataTable component | ✅ |
| Has a unique tableId | ✅ `cash-transactions` |
| Every column has explicit accessor returning raw value | ✅ |
| Every numeric column uses sortNumeric | ✅ |
| Every date column uses sortDate | ✅ |
| Every column header uses i18n key | ✅ |
| Every column defines size and minSize | ❌ (factories provide defaults) |
| Numeric columns are right-aligned | ✅ |
| Sorting is enabled for all appropriate columns | ✅ |
| Default sort is defined and appropriate | ✅ `date desc` |
| Sort indicators are visible | ✅ |
| Null values sort to the end consistently | ✅ |
| Column resizing is enabled | ✅ |
| Column reordering is enabled | ✅ |
| Column visibility toggle available | ❌ (only 4 columns — intentional) |
| Persistence works | ✅ |
| Reset to defaults available | ✅ |
| Loading skeleton shown during data fetch | ✅ |
| Empty state shown when no data | ✅ |
| Horizontal scroll on mobile | ✅ |
| Privacy mode works on all cells | ✅ |
| Export available | ❌ |
| Column definitions memoized | ✅ |
| ARIA attributes correct | ✅ |
| **Grade** | **B+** |

---

## TABLE 6: AssetAllocation (Tree Table)

| Criterion | Status |
|-----------|--------|
| Uses shared DataTable component | ❌ (direct useReactTable — tree table) |
| Has a unique tableId | ❌ (no persistence) |
| Every numeric column uses sortNumeric | ✅ (imported from library) |
| Every column header uses i18n key | ✅ |
| Numeric columns are right-aligned | ✅ |
| Column definitions memoized | ✅ |
| **Grade** | **B-** (tree table, correct by design) |

---

## TABLE 7: RebalancingTable (Tree Table)

| Criterion | Status |
|-----------|--------|
| Uses shared DataTable component | ❌ (direct useReactTable — tree table) |
| Sorting intentionally disabled | ✅ (tree structure) |
| Every column header uses i18n key | ✅ |
| Numeric columns are right-aligned | ✅ |
| Column definitions memoized | ✅ |
| **Grade** | **B-** (tree table, sorting disabled by design) |

---

## TABLES 8-12: Raw HTML Tables

These tables are intentionally simple raw HTML `<table>` elements. They are not candidates for DataTable migration due to their specialized nature (holiday calendars, price feed previews, heatmap visualizations).

| Table | Location | i18n | Right-Align | Grade |
|-------|----------|------|-------------|-------|
| HolidayTable | `components/domain/HolidayTable.tsx` | ✅ | N/A | C (static) |
| Payments | `pages/Payments.tsx` | ✅ | ✅ | C (detail cards) |
| PriceFeedConfig | `components/domain/PriceFeedConfig.tsx` | ✅ | ✅ | C (preview) |
| HistoricalQuotesTab | `components/domain/SecurityDialog/HistoricalQuotesTab.tsx` | ✅ | ✅ | C (preview) |
| WidgetReturnsHeatmap | `components/domain/widgets/WidgetReturnsHeatmap.tsx` | ✅ | ✅ | C (specialized) |

---

## Summary

| Grade | Tables | Count |
|-------|--------|-------|
| **A** | Investments, Transactions | 2 |
| **B+** | SecurityDetail, AccountDetailTabs, CashAccountView | 3 |
| **B-** | AssetAllocation, RebalancingTable | 2 |
| **C** | HolidayTable, Payments, PriceFeedConfig, HistoricalQuotesTab, WidgetReturnsHeatmap | 5 |

**Overall grade: B+** (up from C- at audit start)
