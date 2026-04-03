# Table Architecture

Comprehensive overview of the QuoVibe table system.

## Component Stack

```
DataTable (shared wrapper)
  └─ useReactTable (TanStack Table v8)
  └─ useTableLayout (persistence hook)
  └─ useVirtualizer (TanStack Virtual, optional)
  └─ TableToolbar (search + filters)
  └─ Column factories (sort + meta)
```

## Files

| File | Purpose |
|------|---------|
| `components/shared/DataTable.tsx` | Shared table component with persistence, virtualization, export, sorting, resizing, reordering, visibility |
| `components/shared/TableToolbar.tsx` | Unified toolbar with search, custom filters, reset button |
| `lib/table-sort-functions.ts` | 5 sort functions with nulls-last (sortNumeric, sortDate, sortString, sortBoolean, sortDecimalJs) |
| `lib/column-factories.tsx` | 7 column type factories with sort function, alignment, data type, and responsive priority |
| `lib/table-export.ts` | CSV export utility (buildCsvContent, exportTableToCSV) |
| `api/use-table-layout.ts` | Persistence hook managing 4 state dimensions |
| `hooks/useColumnDnd.ts` | Column DnD hook — sensors, drag state, order computation |
| `hooks/useInvestmentsColumns.tsx` | 22-column definition for the Investments table |

## DataTable Props

### Core
- `columns`, `data` — required
- `onRowClick` — row click handler
- `pagination`, `pageSize` — client-side pagination
- `isLoading`, `skeletonRows` — loading state

### Persistence
- `tableId` — enables auto-persistence for all features
- `defaultSorting` — initial sort state
- `defaultColumnVisibility` — initial column visibility

### Column UI
- `enableColumnVisibility` — shows column picker popover
- `columnVisibilityGroups` — groups for the column picker

### Export
- `enableExport` — shows CSV export button (disabled in privacy mode)

### Virtualization
- `enableVirtualization` — `true` (threshold 50) or `number` (custom threshold)

### External State (legacy)
- `columnVisibility`, `columnOrder`, `columnSizing` + onChange handlers

## Feature Tiers

| Tier | Tables | Features |
|------|--------|----------|
| **Full** | Investments, Transactions | Persistence, visibility groups, export, responsive priorities, search toolbar |
| **Core** | SecurityDetail, AccountDetail, CashAccount | Persistence, sort, column factories |
| **Custom** | AssetAllocation, RebalancingTable | Tree structure, direct useReactTable, standard sort functions |
| **Raw** | HolidayTable, Payments, PriceFeedConfig, HistoricalQuotes, Heatmap | Plain HTML tables, no TanStack |

## Sort System

All sort functions return nullish values to END regardless of sort direction. Available via column factories:

| Factory | Sort Function | Alignment | Data Type |
|---------|--------------|-----------|-----------|
| `numericColumnMeta()` | `sortNumeric` | right | numeric |
| `currencyColumnMeta()` | `sortNumeric` | right | currency |
| `percentColumnMeta()` | `sortNumeric` | right | percent |
| `sharesColumnMeta()` | `sortNumeric` | right | shares |
| `dateColumnMeta()` | `sortDate` | left | date |
| `textColumnMeta()` | `sortString` | left | text |
| `booleanColumnMeta()` | `sortBoolean` | center | boolean |

## Responsive Design

Columns declare `meta.priority` via factory overrides:
- `high` — always visible
- `medium` — hidden on mobile (<640px)
- `low` — hidden on mobile and tablet (<768px)

Column resize and reorder are disabled on tablet and below.

## Export

CSV export via `exportTableToCSV()`:
- Exports visible columns only (respects visibility)
- Exports in current column order
- Exports in current sort order
- Uses raw accessor values (not rendered content)
- UTF-8 with BOM for Excel compatibility
- Disabled when privacy mode is active

## Virtualization

Uses `@tanstack/react-virtual` when `enableVirtualization` is set and row count exceeds the threshold. The virtualizer controls only the tbody — headers remain sticky, pagination unaffected. Overscan: 10 rows.

## Column DnD Reordering

Drag-and-drop column reordering uses `@dnd-kit/core` + `@dnd-kit/sortable`. Desktop only (disabled on tablet and below via `isTabletOrBelow` guard).

### Architecture

| Component | Purpose |
|-----------|---------|
| `useColumnDnd` (hook) | Sensors, drag state, handlers, pinned-column-safe `arrayMove` |
| `SortableColumnHeader` | Wraps `ColumnHeader` with `useSortable` — provides DnD ref, listeners, attributes |
| `DraggedColumnOverlay` | Floating ghost rendered in `DragOverlay` during drag |
| `DndContext` | Root provider — wraps the table section only when `enableReorder` is true |
| `SortableContext` | Wraps the header `<tr>`, items = visible non-locked column IDs |

### Gesture Disambiguation

- **Click (<8px movement)** → fires sort via TanStack `getToggleSortingHandler()`
- **Drag (≥8px movement)** → activates `PointerSensor` → column DnD
- **Resize handle** → `onPointerDown: stopPropagation()` blocks DnD activation entirely
- **Keyboard** → `KeyboardSensor` with `sortableKeyboardCoordinates` (Space to pick up, arrows to move)

### Visual Feedback

- Source column: `opacity-40` while dragging
- Drop indicator: 2px `bg-primary` line on left or right edge of the hovered column
- DragOverlay: cloned header content with `shadow-lg`, `opacity-90`, `cursor-grabbing`
- Cursor: `cursor-grab` on hover (when DnD is enabled)

### Sticky/Locked Columns

Columns with `meta.locked: true` or `meta.sticky` are excluded from `SortableContext.items`. They cannot be dragged or receive drops. Their positions are preserved during reorder via the pinned-column re-insertion algorithm (same logic as context menu Move Left/Right).

### Persistence

On drop, `onColumnOrderChange(newOrder)` fires immediately — same path as context menu. Optimistic update via `use-table-layout.ts` mutation.

### Constraints

- `autoScroll: false` — prevents incorrect scroll detection on `<main>` ancestor
- `restrictToHorizontalAxis` modifier on both `DndContext` and `DragOverlay`
- `touch-none` on the drag activator div to prevent browser scroll gestures
- Context menu Move Left/Right continues to work alongside DnD

## Accessibility

- `aria-sort` on all sortable column headers
- `role="separator"` + keyboard support on resize handles
- `aria-live` region announces current sort state
- Sort buttons are native `<button>` elements (tab-focusable)
- Multi-sort via Shift+click (up to 3 columns)
- Column DnD: screen reader announcements via `DndContext` accessibility config (pickup, move, drop, cancel)
- Column DnD keyboard: Space to pick up, Left/Right arrows to move, Space to drop, Escape to cancel
