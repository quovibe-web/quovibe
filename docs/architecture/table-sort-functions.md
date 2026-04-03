# Table Sort Functions & Column Factories

## Overview

Standardized sort function library and column type factory system for TanStack Table columns. Every table in QuoVibe should use these to ensure correct, consistent sorting behavior.

## Sort Functions

**Location:** `packages/web/src/lib/table-sort-functions.ts`

### Available Functions

| Function | Use Case | Nullish Values | Input Types |
|----------|----------|----------------|-------------|
| `sortNumeric` | Currencies, percentages, shares, any number | `null`, `undefined`, `NaN` → END | `number`, `string` (parsed) |
| `sortDate` | Date columns | `null`, `undefined`, invalid dates → END | `Date`, ISO string, timestamp |
| `sortString` | Names, ISINs, tickers, text | `null`, `undefined`, empty/whitespace → END | `string` |
| `sortBoolean` | Boolean flags | `null`, `undefined` → END | `boolean` |
| `sortDecimalJs` | Decimal.js instances | `null`, `undefined`, Decimal NaN → END | Decimal.js (duck-typed) |

### Null Handling (Critical)

**Nullish values ALWAYS sort to the END regardless of sort direction:**
- Ascending: `[1, 2, 3, null, null]`
- Descending: `[3, 2, 1, null, null]`

This is direction-aware. TanStack Table negates the comparator result for descending sorts. The sort functions detect the current sort direction from the column state and compensate, ensuring nulls stay last after TanStack's negation.

### When to Use Each

- Financial amounts → `sortNumeric`
- Percentage values → `sortNumeric`
- Share counts → `sortNumeric`
- Date/time values → `sortDate`
- Names, labels, identifiers → `sortString`
- Yes/no flags → `sortBoolean`
- Engine Decimal.js values → `sortDecimalJs` (rare in frontend)

## Column Factories

**Location:** `packages/web/src/lib/column-factories.tsx`

### Available Factories

| Factory | Sort Function | Alignment | Data Type |
|---------|--------------|-----------|-----------|
| `numericColumnMeta()` | `sortNumeric` | right | `numeric` |
| `currencyColumnMeta()` | `sortNumeric` | right | `currency` |
| `percentColumnMeta()` | `sortNumeric` | right | `percent` |
| `sharesColumnMeta()` | `sortNumeric` | right | `shares` |
| `dateColumnMeta()` | `sortDate` | left | `date` |
| `textColumnMeta()` | `sortString` | left | `text` |
| `booleanColumnMeta()` | `sortBoolean` | center | `boolean` |

### Usage Pattern

Factories return partial `ColumnDef` objects. Spread them into your column definition:

```ts
{
  accessorKey: 'marketValue',
  ...currencyColumnMeta(),
  header: t('columns.marketValue'),
  size: 130,
  minSize: 100,
  cell: ({ row }) => <CurrencyDisplay value={...} />,
}
```

**Factories do NOT define:** `accessorFn`, `accessorKey`, `header`, `id`, `cell` — those are per-column.

**Factories DO define:** `sortingFn`, `meta` (align + dataType).

### Merging Meta

If a column needs additional meta properties (e.g., `sticky`), override `meta` after the spread:

```ts
{
  accessorKey: 'name',
  ...textColumnMeta(),
  meta: { align: 'left', dataType: 'text', sticky: 'left' },
}
```

### Overrides

All factories accept an optional overrides object:

```ts
...currencyColumnMeta({ minSize: 120, maxSize: 200 })
```

## DataTable `meta.align` Support

DataTable automatically reads `column.columnDef.meta.align` and applies:
- `'right'` → `text-right` on both `<th>` content and `<td>`
- `'center'` → `text-center` on both
- `'left'` → no class (default)

This means columns using factories get correct alignment automatically. Existing inline `text-right` divs in cell renderers are compatible (redundant but harmless).

## Accessor Pattern for Map-Based Columns

For columns where the value comes from external maps (not the row data directly), define an `accessorFn` that returns the raw value:

```ts
{
  id: 'shares',
  accessorFn: (row) => {
    const shares = statementMap.get(row.id)?.shares;
    return shares != null ? parseFloat(shares) : null;
  },
  ...sharesColumnMeta(),
  cell: ({ row }) => { /* uses maps directly for display-specific logic */ },
}
```

The sort function calls `getValue(columnId)` which invokes the `accessorFn`, getting the correct numeric value for comparison.
