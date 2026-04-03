import { useState, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { FadeIn } from '@/components/shared/FadeIn';
import { SectionSkeleton } from '@/components/shared/SectionSkeleton';
import { PageHeader } from '@/components/shared/PageHeader';
import { EmptyState } from '@/components/shared/EmptyState';
import { cn } from '@/lib/utils';
import {
  useReactTable,
  getCoreRowModel,
  getExpandedRowModel,
  getSortedRowModel,
  type ColumnDef,
  type SortingState,
  flexRender,
} from '@tanstack/react-table';
import { ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, MoreHorizontal, Plus, TrendingUp, Landmark } from 'lucide-react';
import { sortNumeric } from '@/lib/table-sort-functions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { CurrencyDisplay } from '@/components/shared/CurrencyDisplay';
import { TaxonomyChart } from '@/components/domain/TaxonomyChart';
import { RebalancingTable } from '@/components/domain/RebalancingTable';
import { AssignCategoryDialog } from '@/components/domain/AssignCategoryDialog';
import { CategoryNameDialog } from '@/components/domain/CategoryNameDialog';
import { MoveCategoryDialog } from '@/components/domain/MoveCategoryDialog';
import { WeightEditDialog } from '@/components/domain/WeightEditDialog';
import { ColorPaletteContent } from '@/components/domain/CategoryColorPicker';
import { useTaxonomies } from '@/api/use-taxonomies';
import { useTaxonomyTree } from '@/api/use-taxonomy-tree';
import { useSecurities } from '@/api/use-securities';
import { useAccounts } from '@/api/use-accounts';
import { useAssetAllocation } from '@/api/use-reports';
import { useRebalancing, useUpdateAllocation } from '@/api/use-rebalancing';
import {
  useCreateCategory, useUpdateCategory, useDeleteCategory,
  useDeleteAssignment, useUpdateAssignment,
} from '@/api/use-taxonomy-mutations';
import { formatPercentage } from '@/lib/formatters';
import { Skeleton } from '@/components/ui/skeleton';
import { TableSkeleton } from '@/components/shared/TableSkeleton';
import type { AssetAllocationItem, AssetAllocationSecurity, HoldingsItem, TaxonomyListItem, TaxonomyTreeCategory } from '@/api/types';

interface TreeItem {
  id: string;
  name: string;
  nodeType: 'category' | 'security';
  marketValue: string;
  percentage: string;
  depth: number;
  isRetired?: boolean;
  weight?: number;
  logoUrl?: string | null;
  subRows?: TreeItem[];
  // category-only
  categoryId?: string;
  parentId?: string | null;
  isLeaf?: boolean;
  // enrichment from taxonomy tree
  color?: string | null;
  assignmentId?: number;
  itemId?: string;
  itemType?: 'security' | 'account';
}

function buildTree(
  items: AssetAllocationItem[],
  hideRetired: boolean,
  hideZeroValue: boolean,
  treeCategories?: TaxonomyTreeCategory[],
): TreeItem[] {
  // Build lookup maps from taxonomy tree for colors and assignment IDs
  const colorLookup = new Map<string, string | null>();
  const assignmentLookup = new Map<string, number>();

  if (treeCategories) {
    function walkTree(cats: TaxonomyTreeCategory[]) {
      for (const cat of cats) {
        colorLookup.set(cat.id, cat.color);
        for (const a of cat.assignments) {
          assignmentLookup.set(`${cat.id}:${a.itemId}`, a.assignmentId);
        }
        if (cat.children?.length) walkTree(cat.children);
      }
    }
    walkTree(treeCategories);
  }

  const byParent = new Map<string, AssetAllocationItem[]>();
  for (const item of items) {
    const key = item.parentId ?? '__root__';
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key)!.push(item);
  }

  function nest(parentId: string | null): TreeItem[] {
    const key = parentId ?? '__root__';
    return (byParent.get(key) ?? []).map((item) => {
      const childCategories = nest(item.categoryId);

      // Build security leaf rows for this category
      let securities: AssetAllocationSecurity[] = item.securities ?? [];
      if (hideRetired) securities = securities.filter((s) => !s.isRetired);
      if (hideZeroValue) securities = securities.filter((s) => parseFloat(s.marketValue) !== 0);

      const secRows: TreeItem[] = securities.map((s) => ({
        id: `${item.categoryId}:${s.securityId}`,
        name: s.name,
        nodeType: 'security' as const,
        marketValue: s.marketValue,
        percentage: s.percentage ?? '0',
        depth: item.depth + 1,
        isRetired: s.isRetired,
        weight: s.weight,
        logoUrl: s.logoUrl,
        assignmentId: assignmentLookup.get(`${item.categoryId}:${s.securityId}`),
        itemId: s.securityId,
        itemType: (s.isAccount ? 'account' : 'security') as 'security' | 'account',
      }));

      const subRows: TreeItem[] = [...childCategories, ...secRows];

      const categoryRow: TreeItem = {
        id: item.categoryId,
        name: item.name,
        nodeType: 'category',
        marketValue: item.marketValue,
        percentage: item.percentage,
        depth: item.depth,
        categoryId: item.categoryId,
        parentId: item.parentId,
        isLeaf: item.isLeaf,
        color: colorLookup.get(item.categoryId) ?? null,
        subRows: subRows.length > 0 ? subRows : undefined,
      };
      return categoryRow;
    });
  }
  return nest(null);
}

// ----- Category Context Menu -----

function CategoryMenu({
  taxonomyId, categoryId, categoryName, categoryColor, parentId, usedColors,
}: {
  taxonomyId: string;
  categoryId: string;
  categoryName: string;
  categoryColor: string | null;
  parentId: string | null;
  usedColors?: Set<string>;
}) {
  const { t } = useTranslation('reports');
  const createCategory = useCreateCategory(taxonomyId);
  const updateCategory = useUpdateCategory(taxonomyId);
  const deleteCategory = useDeleteCategory(taxonomyId);
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState(categoryName);
  const [colorPickerOpen, setColorPickerOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [addSubDialog, setAddSubDialog] = useState(false);
  const [moveDialog, setMoveDialog] = useState(false);

  if (renaming) {
    return (
      <Input
        value={newName}
        onChange={(e) => setNewName(e.target.value)}
        onBlur={() => {
          if (newName.trim() && newName !== categoryName) {
            updateCategory.mutate({ catId: categoryId, name: newName.trim() });
          }
          setRenaming(false);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') { setNewName(categoryName); setRenaming(false); }
        }}
        className="h-6 text-sm w-40"
        autoFocus
      />
    );
  }

  return (
    <div className="flex items-center gap-3">
      <Popover open={colorPickerOpen} onOpenChange={setColorPickerOpen}>
        <PopoverTrigger asChild>
          <button
            className="h-3.5 w-3.5 rounded-full border border-white/20 opacity-60 hover:opacity-100 shrink-0 cursor-pointer transition-opacity"
            style={{ backgroundColor: categoryColor || '#888' }}
            aria-label={t('taxonomyManagement.changeColor')}
          />
        </PopoverTrigger>
        <PopoverContent className="w-52 p-3" align="end">
          <ColorPaletteContent
            currentColor={categoryColor}
            usedColors={usedColors}
            onColorChange={(color) => {
              updateCategory.mutate({ catId: categoryId, color });
              setColorPickerOpen(false);
            }}
          />
        </PopoverContent>
      </Popover>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="h-6 w-6 p-0 opacity-30 group-hover:opacity-100 transition-opacity">
            <MoreHorizontal size={14} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => setAddSubDialog(true)}>
            {t('taxonomyManagement.addSubcategory')}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setRenaming(true)}>
            {t('taxonomyManagement.renameCategory')}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setMoveDialog(true)}>
            {t('taxonomyManagement.moveCategory')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            onClick={() => setConfirmDelete(true)}
          >
            {t('taxonomyManagement.deleteCategory')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialog open={confirmDelete} onOpenChange={(open) => { if (!open) setConfirmDelete(false); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('taxonomyManagement.deleteCategory')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('taxonomyManagement.deleteCategoryConfirm')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common:cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                deleteCategory.mutate(categoryId);
                setConfirmDelete(false);
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteCategory.isPending}
            >
              {deleteCategory.isPending ? t('common:deleting') : t('common:delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <CategoryNameDialog
        open={addSubDialog}
        onOpenChange={setAddSubDialog}
        title={t('taxonomyManagement.addSubcategory')}
        onConfirm={(name) => createCategory.mutate({ name, parentId: categoryId })}
      />
      {moveDialog && (
        <MoveCategoryDialog
          taxonomyId={taxonomyId}
          categoryId={categoryId}
          categoryName={categoryName}
          currentParentId={parentId}
          onClose={() => setMoveDialog(false)}
        />
      )}
    </div>
  );
}

// ----- Assignment Context Menu -----

function AssignmentMenu({
  taxonomyId, assignmentId, assignmentWeight, categoryId,
}: {
  taxonomyId: string;
  assignmentId: number;
  assignmentWeight: number | null;
  categoryId: string;
}) {
  const { t } = useTranslation('reports');
  const deleteAssignment = useDeleteAssignment(taxonomyId);
  const updateAssignment = useUpdateAssignment(taxonomyId);
  const [editingWeight, setEditingWeight] = useState(false);
  const [weightVal, setWeightVal] = useState(
    assignmentWeight != null ? String(assignmentWeight / 100) : '',
  );
  const [moveDialog, setMoveDialog] = useState(false);

  if (editingWeight) {
    return (
      <Input
        type="number"
        min={0}
        max={100}
        step={0.01}
        value={weightVal}
        onChange={(e) => setWeightVal(e.target.value)}
        onBlur={() => {
          const v = parseFloat(weightVal);
          if (!isNaN(v)) {
            const w = Math.round(v * 100);
            updateAssignment.mutate({ assignmentId, weight: w });
          }
          setEditingWeight(false);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') setEditingWeight(false);
        }}
        className="h-6 text-sm w-20"
        autoFocus
      />
    );
  }

  return (
    <div className="flex items-center gap-3">
      {/* Invisible spacer matching CategoryMenu's color dot (h-3.5 w-3.5) */}
      <span className="inline-block h-3.5 w-3.5 shrink-0" />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="h-6 w-6 p-0 opacity-30 group-hover:opacity-100 transition-opacity">
            <MoreHorizontal size={14} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => setMoveDialog(true)}>
            {t('taxonomyManagement.moveTo')}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setEditingWeight(true)}>
            {t('taxonomyManagement.editWeight')}
          </DropdownMenuItem>
          <DropdownMenuItem
            className="text-destructive"
            onClick={() => deleteAssignment.mutate(assignmentId)}
          >
            {t('taxonomyManagement.removeAssignment')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {moveDialog && (
        <AssignCategoryDialog
          taxonomyId={taxonomyId}
          itemId=""
          itemType="security"
          mode="move"
          assignmentId={assignmentId}
          excludeCategoryId={categoryId}
          onClose={() => setMoveDialog(false)}
        />
      )}
    </div>
  );
}

// ----- Tree Table (unified Definition view) -----

// ----- Inline Weight Editor -----

function WeightCell({ assignmentId, weight, taxonomyId }: {
  assignmentId: number; weight: number | null; taxonomyId: string;
}) {
  const updateAssignment = useUpdateAssignment(taxonomyId);
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(weight != null ? String(weight / 100) : '');

  if (editing) {
    return (
      <Input
        type="number"
        min={0}
        max={100}
        step={0.01}
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onBlur={() => {
          const v = parseFloat(val);
          if (!isNaN(v)) {
            updateAssignment.mutate({ assignmentId, weight: Math.round(v * 100) });
          }
          setEditing(false);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') setEditing(false);
        }}
        className="h-6 text-sm w-20"
        autoFocus
      />
    );
  }

  return (
    <button
      className="text-sm tabular-nums hover:underline cursor-pointer"
      onClick={() => { setVal(weight != null ? String(weight / 100) : ''); setEditing(true); }}
    >
      {weight != null ? formatPercentage(weight / 10000) : '—'}
    </button>
  );
}

function TreeTable({ data, taxonomyId, taxonomyName, rootId, highlightedCategoryId, onHighlightCategory: _onHighlightCategory, usedColors }: {
  data: TreeItem[];
  taxonomyId: string;
  taxonomyName: string;
  rootId: string | null;
  highlightedCategoryId?: string | null;
  onHighlightCategory?: (id: string | null) => void;
  usedColors?: Set<string>;
}) {
  const { t } = useTranslation('reports');
  const [sorting, setSorting] = useState<SortingState>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [rootExpanded, setRootExpanded] = useState(true);

  // Context menu mutation hooks
  const ctxCreateCategory = useCreateCategory(taxonomyId);
  const ctxUpdateCategory = useUpdateCategory(taxonomyId);
  const ctxDeleteCategory = useDeleteCategory(taxonomyId);
  const ctxDeleteAssignment = useDeleteAssignment(taxonomyId);
  const ctxUpdateAssignment = useUpdateAssignment(taxonomyId);
  const [ctxMoveTarget, setCtxMoveTarget] = useState<{ assignmentId: number; itemId: string; itemType: 'security' | 'account'; categoryId: string } | null>(null);
  const [ctxDeleteTarget, setCtxDeleteTarget] = useState<string | null>(null);
  const [nameDialog, setNameDialog] = useState<{ open: boolean; mode: 'add' | 'addSub' | 'rename'; parentId?: string; catId?: string; defaultValue?: string }>({ open: false, mode: 'add' });
  const [moveCategoryTarget, setMoveCategoryTarget] = useState<{ categoryId: string; name: string; parentId: string | null } | null>(null);
  const [weightDialog, setWeightDialog] = useState<{ open: boolean; assignmentId: number; weight: number | null }>({ open: false, assignmentId: 0, weight: null });

  const columns = useMemo<ColumnDef<TreeItem>[]>(() => [
    {
      accessorKey: 'name',
      header: t('assetAllocation.columns.category'),
      cell: ({ row }) => (
        <div style={{ paddingLeft: `${row.depth * 20}px` }} className="flex items-center gap-1.5">
          {row.getCanExpand() ? (
            <button onClick={row.getToggleExpandedHandler()} className="text-muted-foreground hover:text-foreground p-0.5">
              {row.getIsExpanded() ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>
          ) : (
            <span className="w-[14px]" />
          )}
          {row.original.nodeType === 'category' && (
            <span
              className="inline-block h-3 w-3 rounded-full shrink-0 border border-white/20"
              style={{ backgroundColor: row.original.color || '#888' }}
            />
          )}
          {row.original.nodeType === 'security' && row.original.logoUrl ? (
            <img src={row.original.logoUrl} alt="" className="h-5 w-5 rounded-md object-contain flex-shrink-0" />
          ) : row.original.nodeType === 'security' ? (
            row.original.itemType === 'account'
              ? <Landmark className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              : <TrendingUp className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          ) : null}
          <span className={cn(
            row.original.nodeType === 'category' ? 'font-medium' : 'text-sm',
            row.original.isRetired ? 'text-muted-foreground line-through' : '',
          )}>
            {row.original.name}
          </span>
        </div>
      ),
    },
    {
      id: 'weight',
      header: t('assetAllocation.columns.weight'),
      enableSorting: false,
      cell: ({ row }) => {
        if (row.original.nodeType === 'category') {
          return <span className="text-sm text-muted-foreground">—</span>;
        }
        if (row.original.assignmentId != null) {
          return (
            <WeightCell
              assignmentId={row.original.assignmentId}
              weight={row.original.weight ?? null}
              taxonomyId={taxonomyId}
            />
          );
        }
        return null;
      },
    },
    {
      accessorKey: 'marketValue',
      header: t('assetAllocation.columns.marketValue'),
      sortingFn: sortNumeric,
      cell: ({ row }) => (
        <CurrencyDisplay value={parseFloat(row.original.marketValue)} className="text-sm" />
      ),
    },
    {
      accessorKey: 'percentage',
      header: t('assetAllocation.columns.portfolioPercent'),
      sortingFn: sortNumeric,
      cell: ({ row }) => {
        const pct = parseFloat(row.original.percentage);
        if (pct === 0 && row.original.nodeType === 'security') return null;
        return <span className="text-sm">{formatPercentage(pct / 100)}</span>;
      },
    },
    {
      id: 'actions',
      header: '',
      enableSorting: false,
      cell: ({ row }) => {
        if (row.original.nodeType === 'category' && row.original.categoryId) {
          return (
            <CategoryMenu
              taxonomyId={taxonomyId}
              categoryId={row.original.categoryId}
              categoryName={row.original.name}
              categoryColor={row.original.color ?? null}
              parentId={row.original.parentId ?? null}
              usedColors={usedColors}
            />
          );
        }
        if (row.original.nodeType === 'security' && row.original.assignmentId != null) {
          const catId = row.original.id.split(':')[0];
          return (
            <AssignmentMenu
              taxonomyId={taxonomyId}
              assignmentId={row.original.assignmentId}
              assignmentWeight={row.original.weight ?? null}
              categoryId={catId}
            />
          );
        }
        return null;
      },
    },
  ], [t, taxonomyId, usedColors]);

  const table = useReactTable<TreeItem>({
    data,
    columns,
    state: { sorting, expanded },
    onSortingChange: setSorting,
    onExpandedChange: setExpanded,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
    getSubRows: (row) => row.subRows,
    getRowId: (row) => row.id,
  });

  return (
    <>
    <div className="flex items-center gap-1 mb-2">
      <Button variant="ghost" size="sm" onClick={() => table.toggleAllRowsExpanded(true)}>
        <ChevronsUpDown size={14} className="mr-1" />
        {t('assetAllocation.expandAll')}
      </Button>
      <Button variant="ghost" size="sm" onClick={() => table.toggleAllRowsExpanded(false)}>
        <ChevronsDownUp size={14} className="mr-1" />
        {t('assetAllocation.collapseAll')}
      </Button>
      <div className="flex-1" />
      {rootId && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setNameDialog({ open: true, mode: 'add', parentId: rootId })}
        >
          <Plus size={14} className="mr-1" />
          {t('taxonomyManagement.addCategory')}
        </Button>
      )}
    </div>
    <Table>
      <TableHeader>
        {table.getHeaderGroups().map((hg) => (
          <TableRow key={hg.id}>
            {hg.headers.map((h) => (
              <TableHead
                key={h.id}
                className={cn(
                  h.column.getCanSort() ? 'cursor-pointer select-none' : '',
                  h.id === 'actions' ? 'w-10' : '',
                )}
                onClick={h.column.getToggleSortingHandler()}
              >
                {flexRender(h.column.columnDef.header, h.getContext())}
                {h.column.getIsSorted() === 'asc' ? ' ↑' : h.column.getIsSorted() === 'desc' ? ' ↓' : ''}
              </TableHead>
            ))}
          </TableRow>
        ))}
      </TableHeader>
      <TableBody>
        {rootId && (
          <ContextMenu>
            <ContextMenuTrigger asChild>
              <TableRow className="transition-colors group hover:bg-accent/5 font-medium">
                <TableCell>
                  <div className="flex items-center gap-1.5">
                    <button onClick={() => setRootExpanded(!rootExpanded)} className="text-muted-foreground hover:text-foreground p-0.5">
                      {rootExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </button>
                    <span>{taxonomyName}</span>
                  </div>
                </TableCell>
                <TableCell />
                <TableCell />
                <TableCell />
                <TableCell>
                  <div className="flex items-center gap-3">
                    <span className="inline-block h-3.5 w-3.5 shrink-0" />
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm" className="h-6 w-6 p-0 opacity-30 group-hover:opacity-100 transition-opacity">
                          <MoreHorizontal size={14} />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => setNameDialog({ open: true, mode: 'add', parentId: rootId })}>
                          <Plus size={14} className="mr-2" />
                          {t('taxonomyManagement.addCategory')}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </TableCell>
              </TableRow>
            </ContextMenuTrigger>
            <ContextMenuContent>
              <ContextMenuItem onClick={() => setNameDialog({ open: true, mode: 'add', parentId: rootId })}>
                {t('taxonomyManagement.addCategory')}
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        )}
        {rootExpanded && table.getRowModel().rows.map((row) => {
          const isHighlighted = highlightedCategoryId != null &&
            row.original.nodeType === 'category' &&
            row.original.categoryId === highlightedCategoryId;
          const rowEl = (
            <TableRow
              key={row.id}
              className={cn('transition-colors group hover:bg-accent/5', isHighlighted && 'bg-accent/10')}
            >
              {row.getVisibleCells().map((cell) => (
                <TableCell key={cell.id}>
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </TableCell>
              ))}
            </TableRow>
          );

          const isCategory = row.original.nodeType === 'category' && row.original.categoryId;
          const isAssignment = row.original.nodeType === 'security' && row.original.assignmentId != null;

          if (isCategory) {
            return (
              <ContextMenu key={row.id}>
                <ContextMenuTrigger asChild>
                  {rowEl}
                </ContextMenuTrigger>
                <ContextMenuContent>
                  <ContextMenuItem onClick={() => setNameDialog({ open: true, mode: 'addSub', parentId: row.original.categoryId! })}>
                    {t('taxonomyManagement.addSubcategory')}
                  </ContextMenuItem>
                  <ContextMenuItem onClick={() => setNameDialog({ open: true, mode: 'rename', catId: row.original.categoryId!, defaultValue: row.original.name })}>
                    {t('taxonomyManagement.renameCategory')}
                  </ContextMenuItem>
                  <ContextMenuItem onClick={() => setMoveCategoryTarget({ categoryId: row.original.categoryId!, name: row.original.name, parentId: row.original.parentId ?? null })}>
                    {t('taxonomyManagement.moveCategory')}
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem
                    className="text-destructive focus:text-destructive"
                    onClick={() => setCtxDeleteTarget(row.original.categoryId!)}
                  >
                    {t('taxonomyManagement.deleteCategory')}
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            );
          }

          if (isAssignment) {
            const catId = row.original.id.split(':')[0];
            return (
              <ContextMenu key={row.id}>
                <ContextMenuTrigger asChild>
                  {rowEl}
                </ContextMenuTrigger>
                <ContextMenuContent>
                  <ContextMenuItem onClick={() => setCtxMoveTarget({
                    assignmentId: row.original.assignmentId!,
                    itemId: row.original.itemId!,
                    itemType: row.original.itemType!,
                    categoryId: catId,
                  })}>
                    {t('taxonomyManagement.moveTo')}
                  </ContextMenuItem>
                  <ContextMenuItem onClick={() => setWeightDialog({ open: true, assignmentId: row.original.assignmentId!, weight: row.original.weight ?? null })}>
                    {t('taxonomyManagement.editWeight')}
                  </ContextMenuItem>
                  <ContextMenuItem
                    className="text-destructive"
                    onClick={() => ctxDeleteAssignment.mutate(row.original.assignmentId!)}
                  >
                    {t('taxonomyManagement.removeAssignment')}
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            );
          }

          return rowEl;
        })}
      </TableBody>
    </Table>

    {/* Context menu move dialog */}
    {ctxMoveTarget && (
      <AssignCategoryDialog
        taxonomyId={taxonomyId}
        itemId={ctxMoveTarget.itemId}
        itemType={ctxMoveTarget.itemType}
        mode="move"
        assignmentId={ctxMoveTarget.assignmentId}
        excludeCategoryId={ctxMoveTarget.categoryId}
        onClose={() => setCtxMoveTarget(null)}
      />
    )}

    {/* Context menu delete confirmation */}
    <AlertDialog open={ctxDeleteTarget !== null} onOpenChange={(open) => { if (!open) setCtxDeleteTarget(null); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('taxonomyManagement.deleteCategory')}</AlertDialogTitle>
          <AlertDialogDescription>
            {t('taxonomyManagement.deleteCategoryConfirm')}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('common:cancel')}</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              if (ctxDeleteTarget) ctxDeleteCategory.mutate(ctxDeleteTarget);
              setCtxDeleteTarget(null);
            }}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            disabled={ctxDeleteCategory.isPending}
          >
            {ctxDeleteCategory.isPending ? t('common:deleting') : t('common:delete')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    {/* Category name dialog (add / add sub / rename) */}
    <CategoryNameDialog
      open={nameDialog.open}
      onOpenChange={(open) => { if (!open) setNameDialog((s) => ({ ...s, open: false })); }}
      title={nameDialog.mode === 'rename' ? t('taxonomyManagement.renameCategory') : nameDialog.mode === 'addSub' ? t('taxonomyManagement.addSubcategory') : t('taxonomyManagement.addCategory')}
      defaultValue={nameDialog.defaultValue ?? ''}
      onConfirm={(name) => {
        if (nameDialog.mode === 'rename' && nameDialog.catId) {
          ctxUpdateCategory.mutate({ catId: nameDialog.catId, name });
        } else if (nameDialog.parentId) {
          ctxCreateCategory.mutate({ name, parentId: nameDialog.parentId });
        }
      }}
    />

    {/* Move category dialog */}
    {moveCategoryTarget && (
      <MoveCategoryDialog
        taxonomyId={taxonomyId}
        categoryId={moveCategoryTarget.categoryId}
        categoryName={moveCategoryTarget.name}
        currentParentId={moveCategoryTarget.parentId}
        onClose={() => setMoveCategoryTarget(null)}
      />
    )}

    {/* Weight edit dialog */}
    <WeightEditDialog
      open={weightDialog.open}
      onOpenChange={(open) => { if (!open) setWeightDialog((s) => ({ ...s, open: false })); }}
      defaultValue={weightDialog.weight}
      onConfirm={(weight) => ctxUpdateAssignment.mutate({ assignmentId: weightDialog.assignmentId, weight })}
    />
    </>
  );
}

// ----- Without Classification -----

function collectAssignedIds(categories: TaxonomyTreeCategory[]): Set<string> {
  const ids = new Set<string>();
  for (const cat of categories) {
    for (const a of cat.assignments) ids.add(a.itemId);
    if (cat.children?.length) {
      for (const id of collectAssignedIds(cat.children)) ids.add(id);
    }
  }
  return ids;
}

interface UnassignedItem { id: string; name: string; type: 'security' | 'account' }

function WithoutClassification({ taxonomyId }: { taxonomyId: string }) {
  const { t } = useTranslation('reports');
  const { data: tree } = useTaxonomyTree(taxonomyId);
  const { data: securities = [] } = useSecurities();
  const { data: accounts = [] } = useAccounts();
  const [expanded, setExpanded] = useState(false);
  const [assignDialog, setAssignDialog] = useState<UnassignedItem | null>(null);

  const unassigned = useMemo(() => {
    if (!tree) return [];
    const assigned = collectAssignedIds(tree.categories);
    const result: UnassignedItem[] = [];
    for (const s of securities) {
      if (!assigned.has(s.id)) result.push({ id: s.id, name: s.name, type: 'security' });
    }
    for (const a of accounts) {
      if (a.type === 'account' && !assigned.has(a.id)) result.push({ id: a.id, name: a.name, type: 'account' });
    }
    return result.sort((a, b) => a.name.localeCompare(b.name));
  }, [tree, securities, accounts]);

  return (
    <div className="mt-6">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span>{t('taxonomyManagement.withoutClassification')}</span>
        <span className="text-xs">({unassigned.length})</span>
      </button>
      {expanded && (
        <div className="border rounded-md divide-y">
          {unassigned.map((item) => (
            <ContextMenu key={item.id}>
              <ContextMenuTrigger asChild>
                <div
                  className="flex items-center justify-between px-4 py-2 group hover:bg-accent/5"
                >
                  <div className="flex items-center gap-2">
                    {item.type === 'security'
                      ? <TrendingUp className="h-3.5 w-3.5 text-muted-foreground" />
                      : <Landmark className="h-3.5 w-3.5 text-muted-foreground" />}
                    <span className="text-sm">{item.name}</span>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button className="p-1 rounded-md hover:bg-accent/50 opacity-30 group-hover:opacity-100 transition-opacity">
                        <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => setAssignDialog(item)}>
                        {t('taxonomyManagement.assignTo')}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </ContextMenuTrigger>
              <ContextMenuContent>
                <ContextMenuItem onClick={() => setAssignDialog(item)}>
                  {t('taxonomyManagement.assignTo')}
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          ))}
          {unassigned.length === 0 && (
            <div className="px-4 py-3 text-sm text-muted-foreground italic">
              {t('taxonomyManagement.allAssigned')}
            </div>
          )}
        </div>
      )}
      {assignDialog && (
        <AssignCategoryDialog
          taxonomyId={taxonomyId}
          itemId={assignDialog.id}
          itemType={assignDialog.type}
          mode="assign"
          onClose={() => setAssignDialog(null)}
        />
      )}
    </div>
  );
}

function TaxonomySection({
  taxonomy, date, viewMode, hideRetired, hideZeroValue,
}: {
  taxonomy: TaxonomyListItem;
  date: string;
  viewMode: 'definition' | 'rebalancing';
  hideRetired: boolean;
  hideZeroValue: boolean;
}) {
  const { t } = useTranslation('reports');
  const { data, isLoading, isError, error, isFetching } = useAssetAllocation(date, taxonomy.id);
  const { data: taxonomyTree } = useTaxonomyTree(taxonomy.id);
  const { data: securities = [] } = useSecurities();
  const { data: accounts = [] } = useAccounts();
  const [highlightedCategoryId, setHighlightedCategoryId] = useState<string | null>(null);
  const isRefetching = isFetching && !isLoading;

  const rebalQuery = useRebalancing(
    viewMode === 'rebalancing' ? taxonomy.id : undefined,
    date,
  );
  const allocationMutation = useUpdateAllocation(
    viewMode === 'rebalancing' ? taxonomy.id : undefined,
    date,
  );

  const allItems = data?.items ?? [];
  const filteredItems = useMemo(() => {
    if (!hideZeroValue) return allItems;
    return allItems.filter(item => parseFloat(item.marketValue) !== 0);
  }, [allItems, hideZeroValue]);
  const treeData = useMemo(
    () => buildTree(filteredItems, hideRetired, hideZeroValue, taxonomyTree?.categories),
    [filteredItems, hideRetired, hideZeroValue, taxonomyTree],
  );

  // Build color lookup from taxonomy tree for chart
  const categoryColorMap = useMemo(() => {
    const map = new Map<string, string | null>();
    if (taxonomyTree?.categories) {
      function walk(cats: TaxonomyTreeCategory[]) {
        for (const cat of cats) {
          map.set(cat.id, cat.color);
          if (cat.children?.length) walk(cat.children);
        }
      }
      walk(taxonomyTree.categories);
    }
    return map;
  }, [taxonomyTree]);

  const chartItems: HoldingsItem[] = useMemo(
    () =>
      allItems
        .filter((item) => item.depth === 0 && parseFloat(item.marketValue) > 0)
        .map((item) => ({
          securityId: item.categoryId,
          name: item.name,
          marketValue: item.marketValue,
          percentage: item.percentage,
          color: categoryColorMap.get(item.categoryId) ?? null,
        })),
    [allItems, categoryColorMap],
  );

  // Collect colors already used by categories (for duplicate prevention in color picker)
  const usedColors = useMemo(() => {
    const colors = new Set<string>();
    if (taxonomyTree?.categories) {
      function walk(cats: TaxonomyTreeCategory[]) {
        for (const cat of cats) {
          if (cat.color) colors.add(cat.color.toLowerCase());
          if (cat.children?.length) walk(cat.children);
        }
      }
      walk(taxonomyTree.categories);
    }
    return colors;
  }, [taxonomyTree]);

  // Metric cards data
  const metrics = useMemo(() => {
    if (!taxonomyTree) return null;
    const assignedIds = collectAssignedIds(taxonomyTree.categories);
    const assignedCount = assignedIds.size;
    const depositAccounts = accounts.filter(a => a.type === 'account');
    const totalItemCount = securities.length + depositAccounts.length;
    const unassignedCount = totalItemCount - assignedCount;

    function countCategories(cats: TaxonomyTreeCategory[]): number {
      let count = 0;
      for (const cat of cats) {
        count += 1;
        if (cat.children?.length) count += countCategories(cat.children);
      }
      return count;
    }
    const categoriesCount = countCategories(taxonomyTree.categories);

    return { assignedCount, totalItemCount, unassignedCount, categoriesCount };
  }, [taxonomyTree, securities, accounts]);

  if (viewMode === 'rebalancing') {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{taxonomy.name}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {rebalQuery.isLoading ? (
            <TableSkeleton columns={7} rows={5} />
          ) : rebalQuery.isError ? (
            <p className="text-sm text-destructive">
              {rebalQuery.error instanceof Error ? rebalQuery.error.message : t('rebalancing.noData')}
            </p>
          ) : !rebalQuery.data || rebalQuery.data.categories.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t('rebalancing.noData')}</p>
          ) : (
            <div className={cn(rebalQuery.isFetching && !rebalQuery.isLoading && 'opacity-60 transition-opacity duration-200')}>
              <RebalancingTable
                categories={rebalQuery.data.categories}
                onAllocationChange={(categoryId, allocation) =>
                  allocationMutation.mutate({ categoryId, allocation })
                }
                hideRetired={hideRetired}
                hideZeroValue={hideZeroValue}
              />
              <p className="text-sm text-muted-foreground text-right mt-2">
                {t('rebalancing.totalPortfolioValue')}{' '}
                <CurrencyDisplay
                  value={parseFloat(rebalQuery.data.totalPortfolioValue)}
                  className="font-medium text-foreground"
                />
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{taxonomy.name}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-[200px] w-full rounded-lg" />
            <TableSkeleton columns={3} rows={4} />
          </div>
        ) : isError ? (
          <p className="text-sm text-destructive">
            {t('assetAllocation.error')} {error instanceof Error ? error.message : t('assetAllocation.loadFailed')}
          </p>
        ) : allItems.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t('assetAllocation.noData')}</p>
        ) : (
          <div className={cn(isRefetching && 'opacity-60 transition-opacity duration-200')}>
            <div className="flex flex-col md:flex-row items-center gap-6">
              <div className="flex-shrink-0">
                <TaxonomyChart
                  items={chartItems}
                  showLegend={false}
                  highlightedId={highlightedCategoryId}
                  onHighlightChange={setHighlightedCategoryId}
                />
              </div>
              {metrics && (
                <div className="grid grid-cols-2 gap-3 flex-1">
                  <div className="bg-secondary rounded-lg px-4 py-3">
                    <div className="text-xs text-muted-foreground mb-1">
                      {t('taxonomyManagement.totalValue')}
                    </div>
                    <div className="text-lg font-medium">
                      <CurrencyDisplay value={parseFloat(data!.totalMarketValue)} />
                    </div>
                  </div>
                  <div className="bg-secondary rounded-lg px-4 py-3">
                    <div className="text-xs text-muted-foreground mb-1">
                      {t('taxonomyManagement.classified')}
                    </div>
                    <div className="text-lg font-medium">
                      {metrics.assignedCount} / {metrics.totalItemCount}
                    </div>
                  </div>
                  <div className="bg-secondary rounded-lg px-4 py-3">
                    <div className="text-xs text-muted-foreground mb-1">
                      {t('taxonomyManagement.categoriesCount')}
                    </div>
                    <div className="text-lg font-medium">
                      {metrics.categoriesCount}
                    </div>
                  </div>
                  <div className="bg-secondary rounded-lg px-4 py-3">
                    <div className="text-xs text-muted-foreground mb-1">
                      {t('taxonomyManagement.unclassifiedCount')}
                    </div>
                    <div className={cn('text-lg font-medium', metrics.unassignedCount > 0 && 'text-[var(--qv-warning)]')}>
                      {metrics.unassignedCount}
                    </div>
                  </div>
                </div>
              )}
            </div>
            <TreeTable
              data={treeData}
              taxonomyId={taxonomy.id}
              taxonomyName={taxonomy.name}
              rootId={taxonomyTree?.rootId ?? null}
              highlightedCategoryId={highlightedCategoryId}
              onHighlightCategory={setHighlightedCategoryId}
              usedColors={usedColors}
            />
            <WithoutClassification taxonomyId={taxonomy.id} />
            <p className="text-sm text-muted-foreground text-right">
              {t('assetAllocation.total')}{' '}
              <CurrencyDisplay
                value={parseFloat(data!.totalMarketValue)}
                className="font-medium text-foreground"
              />
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function AssetAllocation() {
  const { t } = useTranslation('reports');
  const [searchParams, setSearchParams] = useSearchParams();
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [viewMode, setViewMode] = useState<'definition' | 'rebalancing'>('definition');
  const [hideRetired, setHideRetired] = useState(false);
  const [hideZeroValue, setHideZeroValue] = useState(false);

  const { data: taxonomies, isLoading: taxonomiesLoading } = useTaxonomies();

  // Derive selected taxonomy from URL query param, default to first
  const selectedTaxonomyId = searchParams.get('taxonomy');
  const setSelectedTaxonomyId = useCallback((id: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('taxonomy', id);
      return next;
    }, { replace: true });
  }, [setSearchParams]);


  return (
    <div className="qv-page space-y-6">
      <PageHeader title={t('assetAllocation.title')} subtitle={t('assetAllocation.subtitle')} />

      {taxonomiesLoading ? (
        <>
          <Skeleton className="h-8 w-48 rounded-lg" />
          <SectionSkeleton rows={3} />
          <SectionSkeleton rows={3} />
        </>
      ) : !taxonomies || taxonomies.length === 0 ? (
        <EmptyState icon={Landmark} title={t('assetAllocation.noTaxonomies')} />
      ) : (
        <>

      <div className="flex items-center gap-4">
        <label className="text-sm text-muted-foreground">{t('assetAllocation.date')}</label>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="border rounded-md px-3 py-1.5 text-sm bg-background"
        />
        <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as 'definition' | 'rebalancing')}>
          <TabsList>
            <TabsTrigger value="definition">{t('rebalancing.viewDefinition')}</TabsTrigger>
            <TabsTrigger value="rebalancing">{t('rebalancing.viewRebalancing')}</TabsTrigger>
          </TabsList>
        </Tabs>
        <label className="flex items-center gap-2 text-sm cursor-pointer ml-auto">
          <Checkbox checked={hideRetired} onCheckedChange={(v) => setHideRetired(v === true)} />
          {t('assetAllocation.filters.activeOnly')}
        </label>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <Checkbox checked={hideZeroValue} onCheckedChange={(v) => setHideZeroValue(v === true)} />
          {t('assetAllocation.filters.nonZeroOnly')}
        </label>
      </div>

      {(() => {
        const selected = taxonomies.find(tx => tx.id === selectedTaxonomyId) ?? taxonomies[0];
        // Set URL param if missing (direct navigation to /allocation)
        if (!selectedTaxonomyId && selected) {
          // Schedule the URL update to avoid setState during render
          queueMicrotask(() => setSelectedTaxonomyId(selected.id));
        }
        return (
          <FadeIn key={selected.id}>
            <TaxonomySection taxonomy={selected} date={date} viewMode={viewMode} hideRetired={hideRetired} hideZeroValue={hideZeroValue} />
          </FadeIn>
        );
      })()}
        </>
      )}
    </div>
  );
}
