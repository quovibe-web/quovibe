import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
  type ColumnFiltersState,
  type VisibilityState,
  type OnChangeFn,
  type ColumnOrderState,
  type ColumnSizingState,
  type ColumnSizingInfoState,
  type Header,
} from '@tanstack/react-table';
import { useState, useCallback, useMemo, useRef, useEffect, type CSSProperties } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useTranslation } from 'react-i18next';
import { ArrowUp, ArrowDown, ArrowUpDown, ArrowLeft, ArrowRight, GripVertical, Columns3, RotateCcw, Download } from 'lucide-react';
import { toast } from 'sonner';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { useTableLayout, type TableLayoutDefaults } from '@/api/use-table-layout';
import { usePrivacy } from '@/context/privacy-context';
import { exportTableToCSV } from '@/lib/table-export';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  DndContext,
  pointerWithin,
  DragOverlay,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  horizontalListSortingStrategy,
} from '@dnd-kit/sortable';
import { restrictToHorizontalAxis } from '@dnd-kit/modifiers';
import { useColumnDnd } from '@/hooks/useColumnDnd';

/** Group definition for the column visibility picker */
export interface ColumnVisibilityGroup {
  label: string;
  columns: string[];
}

interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  onRowClick?: (row: TData) => void;
  pagination?: boolean;
  pageSize?: number;
  isLoading?: boolean;
  skeletonRows?: number;

  // --- Persistence mode: provide tableId for auto-persistence ---
  /** If provided, DataTable internally manages and persists sort, sizing, order, visibility */
  tableId?: string;
  /** Initial sort state (used as default before persistence loads) */
  defaultSorting?: SortingState;
  /** Initial column visibility (used as default before persistence loads) */
  defaultColumnVisibility?: VisibilityState;

  // --- Column visibility UI ---
  /** Shows column visibility toggle (Columns button) */
  enableColumnVisibility?: boolean;
  /** Groups for the column picker UI */
  columnVisibilityGroups?: ColumnVisibilityGroup[];

  // --- Export ---
  /** Shows CSV export button */
  enableExport?: boolean;

  // --- Virtualization ---
  /** Enable row virtualization for large datasets.
   *  true = virtualize when rows > 50, number = custom threshold, false/omitted = disabled */
  enableVirtualization?: boolean | number;

  // --- External state mode (existing API, used when tableId is absent) ---
  columnVisibility?: VisibilityState;
  onColumnVisibilityChange?: OnChangeFn<VisibilityState>;
  columnOrder?: ColumnOrderState;
  onColumnOrderChange?: (order: ColumnOrderState) => void;
  columnSizing?: ColumnSizingState;
  onColumnSizingChange?: (sizing: ColumnSizingState) => void;
}

const SKELETON_WIDTHS = ['w-24', 'w-32', 'w-20', 'w-28', 'w-16', 'w-36'];

/** Compute `aria-sort` attribute from a TanStack header. */
function getAriaSort(header: Header<unknown, unknown>): 'ascending' | 'descending' | 'none' | undefined {
  const sorted = header.column.getIsSorted();
  if (sorted === 'asc') return 'ascending';
  if (sorted === 'desc') return 'descending';
  if (header.column.getCanSort()) return 'none';
  return undefined;
}

/** Extract `meta.align` from a column definition. Falls back to 'left'. */
function getColumnAlign(meta: unknown): 'left' | 'right' | 'center' {
  const align = (meta as { align?: string } | undefined)?.align;
  if (align === 'right' || align === 'center') return align;
  return 'left';
}

const ALIGN_CLASS = {
  left: '',
  right: 'text-right',
  center: 'text-center',
} as const;

// ---------------------------------------------------------------------------
// ColumnHeader — resizable column header with context menu reordering
// ---------------------------------------------------------------------------

/** Precomputed left offset and last-flag for each sticky-left column */
interface StickyLeftInfo { left: number; isLast: boolean }

interface ColumnHeaderProps {
  header: Header<unknown, unknown>;
  onResetLayout?: () => void;
  onMoveLeft?: () => void;
  onMoveRight?: () => void;
  canMoveLeft: boolean;
  canMoveRight: boolean;
  enableResize: boolean;
  isLocked: boolean;
  sortedCount: number;
  onResizeByDelta?: (columnId: string, delta: number) => void;
  stickyLeftOffsets: Map<string, StickyLeftInfo>;
  // DnD props (set by SortableColumnHeader wrapper)
  dndNodeRef?: (node: HTMLElement | null) => void;
  dndActivatorRef?: (node: HTMLElement | null) => void;
  dndListeners?: Record<string, unknown>;
  dndAttributes?: Record<string, unknown>;
  isDragging?: boolean;
  dropIndicatorSide?: 'left' | 'right' | null;
}

function ColumnHeader({ header, onResetLayout, onMoveLeft, onMoveRight, canMoveLeft, canMoveRight, enableResize, isLocked, sortedCount, onResizeByDelta, stickyLeftOffsets, dndNodeRef, dndActivatorRef, dndListeners, dndAttributes, isDragging, dropIndicatorSide }: ColumnHeaderProps) {
  const { t } = useTranslation('common');
  const colMeta = header.column.columnDef.meta;
  const stickyMeta = (colMeta as { sticky?: string } | undefined)?.sticky;
  const isStickyRight = stickyMeta === 'right';
  const stickyLeft = stickyLeftOffsets.get(header.column.id);
  const isStickyLeft = !!stickyLeft;
  const align = getColumnAlign(colMeta);

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <TableHead
          ref={dndNodeRef}
          scope="col"
          aria-sort={getAriaSort(header)}
          style={{
            position: isStickyLeft || isStickyRight ? 'sticky' : 'relative',
            width: header.column.getSize(),
            minWidth: header.column.getSize(),
            maxWidth: header.column.getSize(),
            ...(isStickyLeft ? { left: stickyLeft.left } : {}),
          }}
          className={cn(
            'text-xs uppercase tracking-wider text-muted-foreground whitespace-nowrap overflow-hidden group',
            header.column.getIsSorted() ? 'font-semibold' : 'font-medium',
            header.column.getCanSort() && 'select-none',
            isStickyRight && 'right-0 z-10 bg-card shadow-[-4px_0_6px_-2px_var(--qv-border)]',
            isStickyLeft && 'z-10 bg-card',
            isStickyLeft && stickyLeft.isLast && 'shadow-[4px_0_6px_-2px_var(--qv-border)]',
            isDragging && 'opacity-40',
          )}
        >
          <div
            ref={dndActivatorRef}
            {...(dndListeners ?? {})}
            {...(dndAttributes ?? {})}
            onClick={!isLocked ? header.column.getToggleSortingHandler() : undefined}
            className={cn(
              'flex items-center gap-1 w-full rounded-sm',
              header.column.getCanSort() && !isLocked && (dndListeners ? 'cursor-grab' : 'cursor-pointer'),
              dndListeners && 'touch-none',
            )}
          >
            {/* Grip hint — signals reorderability (right-click to move) */}
            {!isLocked && (
              <GripVertical className="size-3.5 shrink-0 text-muted-foreground/0 group-hover:text-muted-foreground/25 transition-colors duration-150" />
            )}
            <div className={cn('flex-1 min-w-0', ALIGN_CLASS[align])}>
              {header.isPlaceholder
                ? null
                : flexRender(header.column.columnDef.header, header.getContext())}
            </div>
            {header.column.getCanSort() && !isLocked && (
              <span className="shrink-0 inline-flex items-center gap-0.5 transition-all duration-150">
                {header.column.getIsSorted() === 'asc' ? (
                  <ArrowUp className="size-3 text-foreground" />
                ) : header.column.getIsSorted() === 'desc' ? (
                  <ArrowDown className="size-3 text-foreground" />
                ) : (
                  <ArrowUpDown className="size-3 text-muted-foreground/0 group-hover:text-muted-foreground/40 transition-colors duration-150" />
                )}
                {header.column.getIsSorted() && sortedCount > 1 && (
                  <span className="text-[9px] font-bold text-primary tabular-nums leading-none">
                    {header.column.getSortIndex() + 1}
                  </span>
                )}
              </span>
            )}
          </div>
          {/* Resize handle — wide hit target, always-visible separator, highlight on hover/drag */}
          {enableResize && !isLocked && (
            <div
              data-resize-handle
              className="absolute right-0 top-0 h-full w-6 -mr-3 cursor-col-resize z-20 group/resize touch-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
              role="separator"
              aria-orientation="vertical"
              tabIndex={0}
              aria-label={t('resizeColumn')}
              onPointerDown={(e) => e.stopPropagation()}
              onMouseDown={header.getResizeHandler()}
              onTouchStart={header.getResizeHandler()}
              onKeyDown={(e) => {
                if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                  e.preventDefault();
                  const delta = e.key === 'ArrowRight' ? 10 : -10; // native-ok
                  onResizeByDelta?.(header.column.id, delta);
                } else if (e.key === 'Escape') {
                  (e.target as HTMLElement).blur();
                }
              }}
            >
              <div className={cn(
                'absolute right-1/2 top-1/4 h-1/2 w-px bg-border transition-all duration-150',
                'group-hover/resize:h-full group-hover/resize:top-0 group-hover/resize:w-0.5 group-hover/resize:bg-primary',
                header.column.getIsResizing() && '!h-full !top-0 !w-0.5 !bg-primary',
              )} />
            </div>
          )}
          {dropIndicatorSide === 'left' && (
            <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-primary z-30" />
          )}
          {dropIndicatorSide === 'right' && (
            <div className="absolute right-0 top-0 bottom-0 w-0.5 bg-primary z-30" />
          )}
        </TableHead>
      </ContextMenuTrigger>
      <ContextMenuContent>
        {!isLocked && (
          <>
            <ContextMenuItem disabled={!canMoveLeft} onClick={onMoveLeft}>
              <ArrowLeft className="h-3.5 w-3.5 mr-2" />
              {t('moveColumnLeft')}
            </ContextMenuItem>
            <ContextMenuItem disabled={!canMoveRight} onClick={onMoveRight}>
              <ArrowRight className="h-3.5 w-3.5 mr-2" />
              {t('moveColumnRight')}
            </ContextMenuItem>
            {onResetLayout && <ContextMenuSeparator />}
          </>
        )}
        {onResetLayout && (
          <ContextMenuItem onClick={onResetLayout}>
            {t('resetColumnLayout')}
          </ContextMenuItem>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}

// ---------------------------------------------------------------------------
// SortableColumnHeader — wraps ColumnHeader with @dnd-kit useSortable
// ---------------------------------------------------------------------------

function SortableColumnHeader(props: ColumnHeaderProps) {
  const {
    setNodeRef,
    setActivatorNodeRef,
    listeners,
    attributes,
    isDragging,
    isOver,
    index,
    activeIndex,
  } = useSortable({ id: props.header.column.id });

  const dropIndicatorSide: 'left' | 'right' | null =
    isOver && activeIndex !== -1 && activeIndex !== index // native-ok
      ? (activeIndex < index ? 'right' : 'left') // native-ok
      : null;

  return (
    <ColumnHeader
      {...props}
      dndNodeRef={setNodeRef}
      dndActivatorRef={setActivatorNodeRef}
      dndListeners={listeners as Record<string, unknown>}
      dndAttributes={attributes as unknown as Record<string, unknown>}
      isDragging={isDragging}
      dropIndicatorSide={dropIndicatorSide}
    />
  );
}

// ---------------------------------------------------------------------------
// DraggedColumnOverlay — floating ghost in DragOverlay during column DnD
// ---------------------------------------------------------------------------

function DraggedColumnOverlay({ header, width }: { header: Header<unknown, unknown>; width: number }) {
  const align = getColumnAlign(header.column.columnDef.meta);
  return (
    <div
      className={cn(
        'px-2 h-10 flex items-center gap-1 rounded-md shadow-lg',
        'bg-[var(--qv-surface-elevated)] border border-border',
        'text-xs uppercase tracking-wider text-muted-foreground font-medium',
        'opacity-90 cursor-grabbing',
      )}
      style={{ width }}
    >
      <GripVertical className="size-3.5 shrink-0 text-muted-foreground/40" />
      <div className={cn('flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap', ALIGN_CLASS[align])}>
        {flexRender(header.column.columnDef.header, header.getContext())}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// DataTable
// ---------------------------------------------------------------------------

export function DataTable<TData, TValue>({
  columns,
  data,
  onRowClick,
  pagination = false,
  pageSize = 20,
  isLoading = false,
  skeletonRows,
  tableId,
  defaultSorting,
  defaultColumnVisibility,
  enableColumnVisibility: enableColVis = false,
  columnVisibilityGroups,
  enableExport = false,
  enableVirtualization = false,
  columnVisibility: extColumnVisibility,
  onColumnVisibilityChange: extOnColumnVisibilityChange,
  columnOrder: extColumnOrder,
  onColumnOrderChange: extOnColumnOrderChange,
  columnSizing: extColumnSizing,
  onColumnSizingChange: extOnColumnSizingChange,
}: DataTableProps<TData, TValue>) {
  const { t } = useTranslation('common');
  const { isPrivate } = usePrivacy();

  // --- Responsive viewport detection ---
  const [isMobile, setIsMobile] = useState(false);
  const [isTabletOrBelow, setIsTabletOrBelow] = useState(false);

  useEffect(() => {
    const mqMobile = window.matchMedia('(max-width: 639px)');
    const mqTablet = window.matchMedia('(max-width: 767px)');
    const update = () => {
      setIsMobile(mqMobile.matches);
      setIsTabletOrBelow(mqTablet.matches);
    };
    update();
    mqMobile.addEventListener('change', update);
    mqTablet.addEventListener('change', update);
    return () => {
      mqMobile.removeEventListener('change', update);
      mqTablet.removeEventListener('change', update);
    };
  }, []);

  // Auto-hide columns based on meta.priority and viewport size
  const responsiveVisibility = useMemo(() => {
    const vis: VisibilityState = {};
    for (const col of columns) {
      const id = (col as { accessorKey?: string }).accessorKey ?? (col as { id?: string }).id;
      if (!id) continue;
      const priority = (col.meta as { priority?: string } | undefined)?.priority;
      if (!priority || priority === 'high') continue;
      if (isMobile && (priority === 'low' || priority === 'medium')) {
        vis[id] = false;
      } else if (isTabletOrBelow && priority === 'low') {
        vis[id] = false;
      }
    }
    return vis;
  }, [columns, isMobile, isTabletOrBelow]);

  const autoHiddenCount = useMemo(
    () => Object.values(responsiveVisibility).filter(v => !v).length, // native-ok
    [responsiveVisibility],
  );

  // --- Persistence mode: use unified hook when tableId is provided ---
  const layoutDefaults = useMemo<TableLayoutDefaults>(() => ({
    sorting: defaultSorting ?? [],
    columnSizing: {},
    columnOrder: [],
    columnVisibility: { ...responsiveVisibility, ...(defaultColumnVisibility ?? {}) },
  }), [defaultSorting, defaultColumnVisibility, responsiveVisibility]);

  const persistedLayout = useTableLayout(
    tableId ?? '__noop__',
    layoutDefaults,
  );

  // Determine if we're in persistence mode
  const isPersisted = tableId !== undefined;

  // Resolve state: persistence mode wins over external props
  const columnVisibility = isPersisted ? persistedLayout.columnVisibility : extColumnVisibility;
  const onColumnVisibilityChange = isPersisted
    ? ((updater: VisibilityState | ((prev: VisibilityState) => VisibilityState)) => {
        const newValue = typeof updater === 'function' ? updater(persistedLayout.columnVisibility) : updater;
        persistedLayout.setColumnVisibility(newValue);
      }) as OnChangeFn<VisibilityState>
    : extOnColumnVisibilityChange;
  const columnOrder = isPersisted ? persistedLayout.columnOrder : extColumnOrder;
  const onColumnOrderChange = isPersisted ? persistedLayout.setColumnOrder : extOnColumnOrderChange;
  const columnSizing = isPersisted ? persistedLayout.columnSizing : extColumnSizing;
  const onColumnSizingChange = isPersisted ? persistedLayout.setColumnSizing : extOnColumnSizingChange;

  // Sorting: in persistence mode, use persisted state; otherwise use local state
  const [localSorting, setLocalSorting] = useState<SortingState>(defaultSorting ?? []);
  const sorting = isPersisted ? persistedLayout.sorting : localSorting;
  const sortedCount = sorting?.length ?? 0; // native-ok
  const setSorting: OnChangeFn<SortingState> = (updater) => {
    const current = isPersisted ? persistedLayout.sorting : localSorting;
    const newValue = typeof updater === 'function' ? updater(current) : updater;
    // Third click: restore default sort instead of clearing (unsorted tables feel broken in fintech UX)
    const effective = (newValue.length === 0 && defaultSorting && defaultSorting.length > 0)
      ? defaultSorting
      : newValue;
    if (isPersisted) {
      persistedLayout.setSorting(effective);
    } else {
      setLocalSorting(effective);
    }
  };

  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);

  // Stable height: prevent layout shift when parent filters data
  // Capture container height when data grows (full dataset); preserve it when data shrinks (filtering).
  const stableRef = useRef<HTMLDivElement>(null);
  const peakDataLen = useRef(0); // native-ok
  const [minHeight, setMinHeight] = useState(0); // native-ok

  useEffect(() => {
    const el = stableRef.current;
    if (!el || isLoading) return;
    if (data.length >= peakDataLen.current) {
      peakDataLen.current = data.length;
      setMinHeight(el.offsetHeight);
    }
  }, [data.length, isLoading]);

  // Scroll overflow indicator
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showScrollHint, setShowScrollHint] = useState(false);

  const checkScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setShowScrollHint(
      el.scrollWidth > el.clientWidth + 1 &&
      el.scrollLeft + el.clientWidth < el.scrollWidth - 1
    );
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    checkScroll();
    el.addEventListener('scroll', checkScroll, { passive: true });
    window.addEventListener('resize', checkScroll);
    return () => {
      el.removeEventListener('scroll', checkScroll);
      window.removeEventListener('resize', checkScroll);
    };
  }, [checkScroll]);

  // Re-check when content changes
  useEffect(checkScroll);

  const enableReorder = onColumnOrderChange !== undefined && !isTabletOrBelow;
  const enableResize = onColumnSizingChange !== undefined && !isTabletOrBelow;

  // --- Local resize state for smooth drag (avoids API roundtrip per pixel) ---
  // During active resize, TanStack writes to localSizing (synchronous, immediate).
  // Only when the user releases the handle do we persist to parent (API save).
  const [localSizing, setLocalSizing] = useState<ColumnSizingState>({});
  const [sizingInfo, setSizingInfo] = useState<ColumnSizingInfoState>({
    startOffset: null,
    startSize: null,
    deltaOffset: null,
    deltaPercentage: null,
    columnSizingStart: [],
    isResizingColumn: false,
  });
  const isResizing = !!sizingInfo.isResizingColumn;

  // Persist to parent (triggers API save) only when resize drag ends
  const wasResizingRef = useRef(false);
  useEffect(() => {
    if (wasResizingRef.current && !isResizing) {
      onColumnSizingChange?.(localSizing);
    }
    wasResizingRef.current = isResizing;
  }, [isResizing]);

  // Sync localSizing when parent resets sizing to empty (e.g. Reset View)
  useEffect(() => {
    if (columnSizing && Object.keys(columnSizing).length === 0) {
      setLocalSizing({});
    }
  }, [columnSizing]);

  // Use localSizing while resizing OR on the render right after resize ends
  // (wasResizingRef is still true until the effect above updates it).
  // This prevents a 1-frame flash where columns revert to parent sizing
  // before the persist fires.
  const rawSizing = (isResizing || wasResizingRef.current)
    ? localSizing
    : (columnSizing ?? {});

  // Clamp saved sizing against column min/max to prevent unreadable or oversized columns
  // (TanStack's column.getSize() does NOT enforce minSize/maxSize on stored values)
  const GLOBAL_MIN_COL_WIDTH = 60; // native-ok
  const GLOBAL_MAX_COL_WIDTH = 600; // native-ok

  const sizeConstraintsMap = useMemo(() => {
    const map: Record<string, { min: number; max: number }> = {};
    for (const col of columns) {
      const id = (col as { accessorKey?: string }).accessorKey ?? (col as { id?: string }).id;
      if (id) {
        map[id] = {
          min: col.minSize ?? GLOBAL_MIN_COL_WIDTH,
          max: col.maxSize ?? GLOBAL_MAX_COL_WIDTH,
        };
      }
    }
    return map;
  }, [columns]);

  const activeSizing = useMemo(() => {
    const entries = Object.entries(rawSizing);
    if (entries.length === 0) return rawSizing;
    let clamped = false;
    const result: ColumnSizingState = {};
    for (const [id, size] of entries) {
      const constraints = sizeConstraintsMap[id];
      const min = constraints?.min ?? GLOBAL_MIN_COL_WIDTH;
      const max = constraints?.max ?? GLOBAL_MAX_COL_WIDTH;
      if (size < min) {
        result[id] = min;
        clamped = true;
      } else if (size > max) {
        result[id] = max;
        clamped = true;
      } else {
        result[id] = size;
      }
    }
    return clamped ? result : rawSizing;
  }, [rawSizing, sizeConstraintsMap]);

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    enableMultiSort: true,
    maxMultiSortColCount: 3, // native-ok
    ...(pagination && { getPaginationRowModel: getPaginationRowModel() }),
    ...(enableResize && { columnResizeMode: 'onChange' as const }),
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    state: {
      sorting,
      columnFilters,
      ...(columnVisibility !== undefined && { columnVisibility }),
      ...(columnOrder !== undefined && { columnOrder }),
      ...((enableResize || columnSizing !== undefined) && {
        columnSizing: enableResize ? activeSizing : columnSizing,
      }),
      ...(enableResize && { columnSizingInfo: sizingInfo }),
    },
    ...(onColumnVisibilityChange && { onColumnVisibilityChange }),
    ...(onColumnOrderChange && {
      onColumnOrderChange: ((updater: ColumnOrderState | ((prev: ColumnOrderState) => ColumnOrderState)) => {
        const newValue = typeof updater === 'function' ? updater(columnOrder ?? []) : updater;
        onColumnOrderChange(newValue);
      }) as OnChangeFn<ColumnOrderState>,
    }),
    ...(enableResize && {
      onColumnSizingChange: ((updater: ColumnSizingState | ((prev: ColumnSizingState) => ColumnSizingState)) => {
        // Apply updater against parent sizing (authoritative base for non-resized columns)
        const base = columnSizing ?? {};
        const newValue = typeof updater === 'function' ? updater(base) : updater;
        setLocalSizing(newValue);
      }) as OnChangeFn<ColumnSizingState>,
      onColumnSizingInfoChange: setSizingInfo as OnChangeFn<ColumnSizingInfoState>,
    }),
    initialState: pagination ? { pagination: { pageSize } } : undefined,
  });

  // Build set of locked column IDs from column defs (logo, actions, etc.)
  const lockedIds = useMemo(
    () => new Set(columns.filter((c) => (c.meta as { locked?: boolean } | undefined)?.locked).map((c) => ('id' in c ? c.id ?? '' : ('accessorKey' in c ? String(c.accessorKey) : '')))),
    [columns],
  );

  // --- Column DnD ---
  const sortableColumnIds = useMemo(() => {
    if (!enableReorder) return [] as string[];
    return table.getLeafHeaders()
      .map(h => h.column.id)
      .filter(id => !lockedIds.has(id));
  }, [enableReorder, lockedIds, columnOrder, columnVisibility]);

  const dnd = useColumnDnd({
    visibleColumnIds: table.getVisibleLeafColumns().map(c => c.id),
    lockedIds,
    currentOrder: columnOrder ?? [],
    allColumnIds: table.getAllLeafColumns().map(c => c.id),
    onColumnOrderChange,
  });

  const getColumnName = useCallback((id: string | number) => {
    const col = table.getColumn(String(id));
    const headerDef = col?.columnDef.header;
    return typeof headerDef === 'string' ? headerDef : String(id);
  }, [table]);

  const dndAccessibility = useMemo(() => enableReorder ? {
    announcements: {
      onDragStart({ active }: { active: { id: string | number } }) {
        return t('dnd.pickedUp', { name: getColumnName(active.id), index: sortableColumnIds.indexOf(String(active.id)) + 1, total: sortableColumnIds.length }); // native-ok
      },
      onDragOver({ active, over }: { active: { id: string | number }; over: { id: string | number } | null }) {
        if (!over) return '';
        return t('dnd.movedTo', { name: getColumnName(active.id), index: sortableColumnIds.indexOf(String(over.id)) + 1, total: sortableColumnIds.length }); // native-ok
      },
      onDragEnd({ active, over }: { active: { id: string | number }; over: { id: string | number } | null }) {
        const idx = over ? sortableColumnIds.indexOf(String(over.id)) + 1 : sortableColumnIds.indexOf(String(active.id)) + 1; // native-ok
        return t('dnd.dropped', { name: getColumnName(active.id), index: idx, total: sortableColumnIds.length });
      },
      onDragCancel({ active }: { active: { id: string | number } }) {
        return t('dnd.cancelled', { name: getColumnName(active.id), index: sortableColumnIds.indexOf(String(active.id)) + 1 }); // native-ok
      },
    },
  } : undefined, [enableReorder, getColumnName, sortableColumnIds, t]);

  const activeHeader = dnd.activeId
    ? table.getLeafHeaders().find(h => h.column.id === dnd.activeId) as Header<unknown, unknown> | undefined
    : undefined;

  const handleMoveColumn = useCallback(
    (columnId: string, direction: 'left' | 'right') => {
      if (!onColumnOrderChange) return;

      const currentOrder = columnOrder && columnOrder.length > 0
        ? columnOrder
        : table.getAllLeafColumns().map((c) => c.id);

      // Only swap among visible, non-locked columns; hidden + locked stay pinned
      const visibleIds = new Set(table.getVisibleLeafColumns().map((c) => c.id));
      const pinnedIds = new Set([
        ...lockedIds,
        ...currentOrder.filter((id) => !visibleIds.has(id)),
      ]);

      const movableOrder = currentOrder.filter((id) => !pinnedIds.has(id));
      const idx = movableOrder.indexOf(columnId);
      if (idx === -1) return; // native-ok

      const target = direction === 'left' ? idx - 1 : idx + 1; // native-ok
      if (target < 0 || target >= movableOrder.length) return; // native-ok

      const newMovable = [...movableOrder];
      [newMovable[idx], newMovable[target]] = [newMovable[target], newMovable[idx]];

      // Re-insert pinned columns (locked + hidden) at their original positions
      const pinnedPositions = currentOrder
        .map((id, i) => pinnedIds.has(id) ? { id, index: i } : null)
        .filter(Boolean) as { id: string; index: number }[];
      for (const { id, index } of pinnedPositions) {
        newMovable.splice(index, 0, id); // native-ok
      }
      onColumnOrderChange(newMovable);
    },
    [columnOrder, lockedIds, onColumnOrderChange, table],
  );

  // Keyboard-driven column resize (arrow keys on focused resize handle)
  const handleResizeByDelta = useCallback((columnId: string, delta: number) => {
    const col = table.getColumn(columnId);
    if (!col) return;
    const currentSize = col.getSize();
    const newSize = Math.max(GLOBAL_MIN_COL_WIDTH, Math.min(GLOBAL_MAX_COL_WIDTH, currentSize + delta));
    const newSizing = { ...(columnSizing ?? {}), [columnId]: newSize };
    setLocalSizing(newSizing);
    onColumnSizingChange?.(newSizing);
  }, [table, columnSizing, onColumnSizingChange]);

  const handleResetLayout = useCallback(() => {
    if (isPersisted) {
      persistedLayout.resetAll();
      setLocalSizing({});
      toast.success(t('layoutReset'));
    } else {
      onColumnOrderChange?.([]);
      onColumnSizingChange?.({});
      setLocalSizing({});
    }
  }, [isPersisted, persistedLayout, onColumnOrderChange, onColumnSizingChange, t]);

  // --- Compute sticky-left offsets for multi-column sticky support ---
  const stickyLeftOffsets = useMemo(() => {
    const offsets = new Map<string, StickyLeftInfo>();
    const headers = table.getLeafHeaders();
    let cumLeft = 0; // native-ok
    const stickyHeaders: typeof headers = [];
    for (const h of headers) {
      const meta = h.column.columnDef.meta as { sticky?: string } | undefined;
      if (meta?.sticky === 'left') stickyHeaders.push(h);
    }
    for (let i = 0; i < stickyHeaders.length; i++) { // native-ok
      offsets.set(stickyHeaders[i].column.id, { left: cumLeft, isLast: i === stickyHeaders.length - 1 }); // native-ok
      cumLeft += stickyHeaders[i].column.getSize(); // native-ok
    }
    return offsets;
  }, [table.getLeafHeaders().map(h => `${h.column.id}:${h.column.getSize()}`).join(',')]);

  // --- Header content ---
  const headerContent = (
    <TableHeader className="sticky top-0 z-20 bg-card [&_tr]:border-[var(--qv-border-strong)]">
      {table.getHeaderGroups().map((hg) => {
        const cells = hg.headers.map((header) => {
          if (enableReorder) {
            const isLocked = lockedIds.has(header.column.id);
            const movableColumns = hg.headers.map((h) => h.column.id).filter((id) => !lockedIds.has(id));
            const movableIndex = movableColumns.indexOf(header.column.id);
            const HeaderComp = isLocked ? ColumnHeader : SortableColumnHeader;
            return (
              <HeaderComp
                key={header.id}
                header={header as Header<unknown, unknown>}
                onResetLayout={handleResetLayout}
                onMoveLeft={() => handleMoveColumn(header.column.id, 'left')}
                onMoveRight={() => handleMoveColumn(header.column.id, 'right')}
                canMoveLeft={!isLocked && movableIndex > 0}
                canMoveRight={!isLocked && movableIndex >= 0 && movableIndex < movableColumns.length - 1}
                enableResize={enableResize}
                isLocked={isLocked}
                sortedCount={sortedCount}
                onResizeByDelta={enableResize ? handleResizeByDelta : undefined}
                stickyLeftOffsets={stickyLeftOffsets}
              />
            );
          }
          const colMeta = header.column.columnDef.meta;
          const stickyMeta = (colMeta as { sticky?: string } | undefined)?.sticky;
          const isStickyRight = stickyMeta === 'right';
          const stickyLeft = stickyLeftOffsets.get(header.column.id);
          const headerAlign = getColumnAlign(colMeta);
          return (
            <TableHead
              key={header.id}
              scope="col"
              aria-sort={getAriaSort(header as Header<unknown, unknown>)}
              className={cn(
                'text-xs uppercase tracking-wider text-muted-foreground whitespace-nowrap group',
                header.column.getIsSorted() ? 'font-semibold' : 'font-medium',
                enableResize && 'overflow-hidden',
                isStickyRight && 'sticky right-0 z-10 bg-inherit shadow-[-4px_0_6px_-2px_var(--qv-border)]',
                stickyLeft && 'sticky z-10 bg-inherit',
                stickyLeft?.isLast && 'shadow-[4px_0_6px_-2px_var(--qv-border)]',
              )}
              style={{
                ...(enableResize || header.column.columnDef.size !== undefined ? { width: header.column.getSize(), minWidth: header.column.getSize(), maxWidth: header.column.getSize() } : {}),
                ...(stickyLeft ? { left: stickyLeft.left } : {}),
              }}
            >
              {header.column.getCanSort() ? (
                <button
                  type="button"
                  onClick={header.column.getToggleSortingHandler()}
                  className="flex items-center gap-1 w-full cursor-pointer select-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none rounded-sm"
                >
                  <div className={cn('flex-1 min-w-0', ALIGN_CLASS[headerAlign])}>
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                  </div>
                  <span className="shrink-0 inline-flex items-center gap-0.5 transition-all duration-150">
                    {header.column.getIsSorted() === 'asc' ? (
                      <ArrowUp className="size-3 text-foreground" />
                    ) : header.column.getIsSorted() === 'desc' ? (
                      <ArrowDown className="size-3 text-foreground" />
                    ) : (
                      <ArrowUpDown className="size-3 text-muted-foreground/0 group-hover:text-muted-foreground/40 transition-colors duration-150" />
                    )}
                    {header.column.getIsSorted() && sortedCount > 1 && (
                      <span className="text-[9px] font-bold text-primary tabular-nums leading-none">
                        {header.column.getSortIndex() + 1}
                      </span>
                    )}
                  </span>
                </button>
              ) : (
                <div className="flex items-center gap-1 w-full">
                  <div className={cn('flex-1 min-w-0', ALIGN_CLASS[headerAlign])}>
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                  </div>
                </div>
              )}
            </TableHead>
          );
        });

        return enableReorder ? (
          <SortableContext key={hg.id} items={sortableColumnIds} strategy={horizontalListSortingStrategy}>
            <TableRow className="bg-card">{cells}</TableRow>
          </SortableContext>
        ) : (
          <TableRow key={hg.id} className="bg-card">{cells}</TableRow>
        );
      })}
    </TableHeader>
  );

  // --- Column visibility picker ---
  const toggleableColumns = table.getAllLeafColumns().filter(col => col.getCanHide());
  const visibleCount = toggleableColumns.filter(col => col.getIsVisible()).length; // native-ok

  const handleToggleAll = useCallback((checked: boolean) => {
    const newVis: VisibilityState = {};
    for (const col of toggleableColumns) {
      newVis[col.id] = checked;
    }
    // Locked (non-hideable) columns remain visible
    for (const col of table.getAllLeafColumns()) {
      if (!col.getCanHide()) newVis[col.id] = true;
    }
    if (isPersisted) {
      persistedLayout.setColumnVisibility(newVis);
    } else {
      onColumnVisibilityChange?.(newVis);
    }
  }, [toggleableColumns, table, isPersisted, persistedLayout, onColumnVisibilityChange]);

  const handleToggleColumn = useCallback((columnId: string, checked: boolean) => {
    const current = table.getState().columnVisibility;
    const newVis = { ...current, [columnId]: checked };
    if (isPersisted) {
      persistedLayout.setColumnVisibility(newVis);
    } else {
      onColumnVisibilityChange?.(newVis);
    }
  }, [table, isPersisted, persistedLayout, onColumnVisibilityChange]);

  const allVisible = toggleableColumns.length > 0 && toggleableColumns.every(col => col.getIsVisible());

  // --- Virtualization ---
  const virtualThreshold = typeof enableVirtualization === 'number' ? enableVirtualization : 50; // native-ok
  const allRows = table.getRowModel().rows;
  const shouldVirtualize = enableVirtualization !== false && allRows.length > virtualThreshold;

  const virtualScrollRef = useRef<HTMLDivElement>(null);
  const ROW_HEIGHT_ESTIMATE = 40; // native-ok — px, updated after first measure
  const VIRTUAL_OVERSCAN = 10; // native-ok

  const virtualizer = useVirtualizer({
    count: shouldVirtualize ? allRows.length : 0, // native-ok
    getScrollElement: () => virtualScrollRef.current,
    estimateSize: () => ROW_HEIGHT_ESTIMATE,
    overscan: VIRTUAL_OVERSCAN,
    enabled: shouldVirtualize,
  });

  // --- Table inner content (extracted for conditional DndContext wrapping) ---
  const tableInner = (
    <>
      <div
        ref={(el) => {
          // Combine refs: scrollRef for horizontal scroll hint, virtualScrollRef for virtualizer
          (scrollRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
          (virtualScrollRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
        }}
        className="rounded-lg border bg-card overflow-x-auto overflow-y-hidden"
      >
        <Table
          wrapperClassName="overflow-visible"
          style={enableResize ? { width: table.getTotalSize(), tableLayout: 'fixed' as const } : undefined}
        >
          {headerContent}
          <TableBody>
            {isLoading ? (
              Array.from({ length: skeletonRows ?? (pagination ? pageSize : 5) }).map((_, rowIdx) => (
                <TableRow
                  key={`skeleton-${rowIdx}`}
                  style={{
                    animation: 'qv-fade-in 0.3s ease-out both',
                    animationDelay: `${rowIdx * 40}ms`,
                  }}
                >
                  {columns.map((_, colIdx) => (
                    <TableCell key={colIdx} className="whitespace-nowrap text-sm">
                      <Skeleton className={`h-4 ${SKELETON_WIDTHS[(rowIdx + colIdx) % SKELETON_WIDTHS.length]}`} />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : allRows.length ? (
              shouldVirtualize ? (
                <>
                  {/* Top spacer for virtual scroll */}
                  {virtualizer.getVirtualItems().length > 0 && (
                    <tr>
                      <td
                        colSpan={columns.length}
                        style={{ height: virtualizer.getVirtualItems()[0]?.start ?? 0, padding: 0, border: 'none' } as CSSProperties}
                      />
                    </tr>
                  )}
                  {virtualizer.getVirtualItems().map((virtualRow) => {
                    const row = allRows[virtualRow.index];
                    return (
                      <TableRow
                        key={row.id}
                        data-index={virtualRow.index}
                        ref={virtualizer.measureElement}
                        onClick={() => onRowClick?.(row.original)}
                        className={cn('bg-card hover:bg-secondary transition-colors duration-100', onRowClick && 'cursor-pointer')}
                      >
                        {row.getVisibleCells().map((cell) => {
                          const cellMeta = cell.column.columnDef.meta;
                          const stickyMeta = (cellMeta as { sticky?: string } | undefined)?.sticky;
                          const isStickyRight = stickyMeta === 'right';
                          const stickyLeft = stickyLeftOffsets.get(cell.column.id);
                          const cellAlign = getColumnAlign(cellMeta);
                          return (
                            <TableCell
                              key={cell.id}
                              className={cn(
                                'whitespace-nowrap text-sm',
                                ALIGN_CLASS[cellAlign],
                                enableResize && 'overflow-hidden',
                                enableResize && !isStickyRight && !stickyLeft && 'text-ellipsis',
                                isStickyRight && 'sticky right-0 z-10 bg-inherit shadow-[-4px_0_6px_-2px_var(--qv-border)]',
                                stickyLeft && 'sticky z-10 bg-inherit',
                                stickyLeft?.isLast && 'shadow-[4px_0_6px_-2px_var(--qv-border)]',
                              )}
                              style={{
                                ...(enableResize || cell.column.columnDef.size !== undefined ? { width: cell.column.getSize(), minWidth: cell.column.getSize(), maxWidth: cell.column.getSize() } : {}),
                                ...(stickyLeft ? { left: stickyLeft.left } : {}),
                              }}
                            >
                              {flexRender(cell.column.columnDef.cell, cell.getContext())}
                            </TableCell>
                          );
                        })}
                      </TableRow>
                    );
                  })}
                  {/* Bottom spacer for virtual scroll */}
                  {virtualizer.getVirtualItems().length > 0 && (
                    <tr>
                      <td
                        colSpan={columns.length}
                        style={{
                          height: virtualizer.getTotalSize() - (virtualizer.getVirtualItems().at(-1)?.end ?? 0),
                          padding: 0,
                          border: 'none',
                        } as CSSProperties}
                      />
                    </tr>
                  )}
                </>
              ) : (
                allRows.map((row) => (
                  <TableRow
                    key={row.id}
                    onClick={() => onRowClick?.(row.original)}
                    className={cn('bg-card hover:bg-secondary transition-colors duration-100', onRowClick && 'cursor-pointer')}
                  >
                    {row.getVisibleCells().map((cell) => {
                      const cellMeta = cell.column.columnDef.meta;
                      const stickyMeta = (cellMeta as { sticky?: string } | undefined)?.sticky;
                      const isStickyRight = stickyMeta === 'right';
                      const stickyLeft = stickyLeftOffsets.get(cell.column.id);
                      const cellAlign = getColumnAlign(cellMeta);
                      return (
                        <TableCell
                          key={cell.id}
                          className={cn(
                            'whitespace-nowrap text-sm',
                            ALIGN_CLASS[cellAlign],
                            enableResize && 'overflow-hidden',
                            enableResize && !isStickyRight && !stickyLeft && 'text-ellipsis',
                            isStickyRight && 'sticky right-0 z-10 bg-inherit shadow-[-4px_0_6px_-2px_var(--qv-border)]',
                            stickyLeft && 'sticky z-10 bg-inherit',
                            stickyLeft?.isLast && 'shadow-[4px_0_6px_-2px_var(--qv-border)]',
                          )}
                          style={{
                            ...(enableResize || cell.column.columnDef.size !== undefined ? { width: cell.column.getSize(), minWidth: cell.column.getSize(), maxWidth: cell.column.getSize() } : {}),
                            ...(stickyLeft ? { left: stickyLeft.left } : {}),
                          }}
                        >
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))
              )
            ) : (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-24 text-center text-muted-foreground">
                  {t('noData')}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      {showScrollHint && (
        <div
          className="pointer-events-none absolute top-0 right-0 bottom-0 w-8 rounded-r-lg z-10"
          style={{ background: 'linear-gradient(to right, transparent, hsl(var(--card)))' }}
        />
      )}
    </>
  );

  return (
    <div ref={stableRef} className="space-y-2" style={minHeight ? { minHeight } : undefined}>
      {/* Toolbar: column visibility picker + export + reset */}
      {(enableColVis || enableExport) && (
        <div className="flex items-center gap-2">
          {/* CSV Export button */}
          {enableExport && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-2"
                    disabled={isPrivate}
                    onClick={() => exportTableToCSV(table, tableId ?? 'export')}
                  >
                    <Download className="h-4 w-4" />
                    {t('exportCsv')}
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>
                {isPrivate ? t('exportDisabledPrivacy') : t('exportCsv')}
              </TooltipContent>
            </Tooltip>
          )}
          {enableColVis && <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2">
                <Columns3 className="h-4 w-4" />
                {t('columns')}
                <span className="rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground">
                  {visibleCount}
                </span>
                {autoHiddenCount > 0 && (
                  <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                    {t('columnsHidden', { count: autoHiddenCount })}
                  </span>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-56 max-h-80 overflow-y-auto p-2">
              {/* Select all / Deselect all */}
              <label className="flex items-center gap-2 px-2 py-1.5 text-xs font-semibold uppercase text-muted-foreground cursor-pointer hover:bg-accent rounded-sm">
                <Checkbox
                  checked={allVisible}
                  onCheckedChange={(v) => handleToggleAll(v === true)}
                />
                {allVisible ? t('deselectAll') : t('selectAll')}
              </label>
              <div className="my-1 h-px bg-border" />

              {/* Grouped columns */}
              {columnVisibilityGroups ? (
                columnVisibilityGroups.map((group, gi) => {
                  const groupCols = toggleableColumns.filter(col => group.columns.includes(col.id));
                  if (groupCols.length === 0) return null;
                  const groupAllVisible = groupCols.every(col => col.getIsVisible());
                  const groupSomeVisible = groupCols.some(col => col.getIsVisible());
                  return (
                    <div key={group.label}>
                      {gi > 0 && <div className="my-1 h-px bg-border" />}
                      <label className="flex items-center gap-2 px-2 py-1.5 text-xs font-semibold uppercase text-muted-foreground cursor-pointer hover:bg-accent rounded-sm">
                        <Checkbox
                          checked={groupAllVisible ? true : (groupSomeVisible ? 'indeterminate' : false)}
                          onCheckedChange={() => {
                            const newVis = { ...table.getState().columnVisibility };
                            for (const col of groupCols) {
                              newVis[col.id] = !groupAllVisible;
                            }
                            if (isPersisted) {
                              persistedLayout.setColumnVisibility(newVis);
                            } else {
                              onColumnVisibilityChange?.(newVis);
                            }
                          }}
                        />
                        {group.label}
                      </label>
                      {groupCols.map(col => (
                        <label key={col.id} className="flex items-center gap-2 px-2 py-1.5 pl-6 text-sm cursor-pointer hover:bg-accent rounded-sm">
                          <Checkbox
                            checked={col.getIsVisible()}
                            onCheckedChange={(v) => handleToggleColumn(col.id, v === true)}
                          />
                          {typeof col.columnDef.header === 'string' ? col.columnDef.header : col.id}
                        </label>
                      ))}
                    </div>
                  );
                })
              ) : (
                /* Flat column list (no groups) */
                toggleableColumns.map(col => (
                  <label key={col.id} className="flex items-center gap-2 px-2 py-1.5 text-sm cursor-pointer hover:bg-accent rounded-sm">
                    <Checkbox
                      checked={col.getIsVisible()}
                      onCheckedChange={(v) => handleToggleColumn(col.id, v === true)}
                    />
                    {typeof col.columnDef.header === 'string' ? col.columnDef.header : col.id}
                  </label>
                ))
              )}

              {/* Reset to defaults */}
              <div className="my-1 h-px bg-border" />
              <button
                className="flex w-full items-center gap-2 px-2 py-1.5 text-xs text-primary hover:bg-accent rounded-sm"
                onClick={handleResetLayout}
              >
                <RotateCcw className="h-3 w-3" />
                {t('resetToDefaults')}
              </button>
            </PopoverContent>
          </Popover>}
        </div>
      )}

      {/* Screen reader sort announcement */}
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {sorting && sorting.length > 0
          ? sorting.map(s => `${s.id} ${s.desc ? 'descending' : 'ascending'}`).join(', ')
          : ''}
      </div>

      <div className="relative">
      {enableReorder ? (
        <DndContext
          sensors={dnd.sensors}
          collisionDetection={pointerWithin}
          modifiers={[restrictToHorizontalAxis]}
          onDragStart={dnd.handleDragStart}
          onDragEnd={dnd.handleDragEnd}
          onDragCancel={dnd.handleDragCancel}
          autoScroll={false}
          accessibility={dndAccessibility}
        >
          {tableInner}
          <DragOverlay
            modifiers={[restrictToHorizontalAxis]}
            dropAnimation={{
              duration: 200, // native-ok
              easing: 'cubic-bezier(0.25, 1, 0.5, 1)',
            }}
          >
            {activeHeader ? <DraggedColumnOverlay header={activeHeader} width={activeHeader.column.getSize()} /> : null}
          </DragOverlay>
        </DndContext>
      ) : tableInner}
      </div>
      {pagination && !isLoading && table.getPageCount() > 1 && (
        <div className="flex items-center justify-end gap-2">
          <span className="text-sm text-muted-foreground tabular-nums">
            {t('pagination.pageOf', { current: table.getState().pagination.pageIndex + 1, total: table.getPageCount() })}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
          >
            {t('pagination.previous')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
          >
            {t('pagination.next')}
          </Button>
        </div>
      )}
    </div>
  );
}
