# Table Persistence

Unified persistence system for all DataTable state dimensions.

## Schema

Persisted per `tableId` in the sidecar file (`quovibe.settings.json`):

```typescript
{
  columnOrder: string[];              // default: []
  columnSizing: Record<string, number>; // default: {}
  sorting: { id: string; desc: boolean }[] | null; // default: null
  columnVisibility: Record<string, boolean> | null; // default: null
  version: number;                    // default: 1
}
```

- `null` for sorting/visibility means "use column definition defaults"
- `version` field for future schema migrations

## API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/settings/table-layouts/:tableId` | Read persisted layout |
| PUT | `/api/settings/table-layouts/:tableId` | Partial update (merge) |
| DELETE | `/api/settings/table-layouts/:tableId` | Reset to defaults |

### Table ID validation

Dynamic regex: `/^[a-z][a-z0-9-]{2,30}$/` (no hardcoded whitelist).

## Hook: `useTableLayout(tableId, defaults)`

Located in `packages/web/src/api/use-table-layout.ts`.

**Returns:** `sorting`, `columnSizing`, `columnOrder`, `columnVisibility`, `isLoading`, + setter functions + `resetAll()`.

**Behaviors:**
- `setSorting()` — immediate save
- `setColumnSizing()` — debounced 300ms
- `setColumnOrder()` — immediate save
- `setColumnVisibility()` — immediate save
- `resetAll()` — DELETE + invalidate query
- Table IDs starting with `__` disable persistence (noop mode)

## Registered Table IDs

| tableId | Table | Tier |
|---------|-------|------|
| `investments` | Investments | Full |
| `transactions` | Transactions | Full |
| `security-transactions` | SecurityDetail | Core |
| `account-transactions` | AccountDetailTabs | Core |
| `cash-transactions` | CashAccountView | Core |

## Interaction with DataTable

When `tableId` is provided to `<DataTable>`, the component internally calls `useTableLayout` and connects all state dimensions automatically. External state props are ignored in persistence mode.
