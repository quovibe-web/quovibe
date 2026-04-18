import { useState, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  useReactTable,
  getCoreRowModel,
  getExpandedRowModel,
  flexRender,
  type ColumnDef,
  type ExpandedState,
} from '@tanstack/react-table';
import { ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from '@/components/ui/tooltip';
import { CurrencyDisplay } from '@/components/shared/CurrencyDisplay';
import { formatPercentage } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import type { RebalancingCategory, RebalancingSecurity } from '@/api/types';

// Row type: either a category or a security nested under a category
interface TreeRow {
  id: string;
  name: string;
  type: 'category' | 'security';
  depth: number;
  parentId: string | null;
  // Category fields
  allocation?: number;
  allocationSumOk?: boolean;
  allocationSum?: number;
  color?: string | null;
  targetValue?: string;
  deltaValue?: string;
  deltaPercent?: string;
  // True when this row's own sibling group or any ancestor's sibling group
  // doesn't sum to 100% — computed targets below become meaningless, so the
  // cells that derive from targets render muted em-dashes instead.
  allocationsInvalid?: boolean;
  // Security fields
  weight?: number;
  rebalancingIncluded?: boolean;
  rebalanceAmount?: string;
  rebalanceShares?: string;
  currentPrice?: string;
  currency?: string;
  logoUrl?: string | null;
  // Shared
  actualValue: string;
  subRows?: TreeRow[];
}

function buildRebalancingTree(categories: RebalancingCategory[]): TreeRow[] {
  // Build category rows with security children
  const catMap = new Map<string, TreeRow>();
  for (const cat of categories) {
    const secRows: TreeRow[] = cat.securities.map((s: RebalancingSecurity) => ({
      id: `${cat.categoryId}:${s.securityId}`,
      name: s.name,
      type: 'security' as const,
      depth: cat.depth + 1,
      parentId: cat.categoryId,
      weight: s.weight,
      rebalancingIncluded: s.rebalancingIncluded,
      actualValue: s.actualValue,
      rebalanceAmount: s.rebalanceAmount,
      rebalanceShares: s.rebalanceShares,
      currentPrice: s.currentPrice,
      currency: s.currency,
      logoUrl: s.logoUrl,
    }));

    catMap.set(cat.categoryId, {
      id: cat.categoryId,
      name: cat.name,
      type: 'category',
      depth: cat.depth,
      parentId: cat.parentId,
      allocation: cat.allocation,
      allocationSumOk: cat.allocationSumOk,
      allocationSum: cat.allocationSum,
      color: cat.color,
      actualValue: cat.actualValue,
      targetValue: cat.targetValue,
      deltaValue: cat.deltaValue,
      deltaPercent: cat.deltaPercent,
      subRows: secRows.length > 0 ? secRows : undefined,
    });
  }

  // Memoized walk: a category is "invalid" when its own sibling group or any
  // ancestor's sibling group doesn't sum to 100%.
  const invalidCache = new Map<string, boolean>();
  function isInvalid(catId: string): boolean {
    const cached = invalidCache.get(catId);
    if (cached !== undefined) return cached;
    const cat = catMap.get(catId);
    if (!cat) return false;
    const self = cat.allocationSumOk === false;
    const ancestor = cat.parentId ? isInvalid(cat.parentId) : false;
    const result = self || ancestor;
    invalidCache.set(catId, result);
    return result;
  }
  for (const cat of catMap.values()) {
    cat.allocationsInvalid = isInvalid(cat.id);
    if (cat.subRows) {
      for (const child of cat.subRows) {
        if (child.type === 'security') child.allocationsInvalid = cat.allocationsInvalid;
      }
    }
  }

  // Nest categories: children under parents
  const roots: TreeRow[] = [];
  for (const row of catMap.values()) {
    if (row.parentId && catMap.has(row.parentId)) {
      const parent = catMap.get(row.parentId)!;
      if (!parent.subRows) parent.subRows = [];
      // Insert category children before security children
      const secStart = parent.subRows.findIndex(r => r.type === 'security');
      if (secStart === -1) parent.subRows.push(row);
      else parent.subRows.splice(secStart, 0, row);
    } else {
      roots.push(row);
    }
  }

  return roots;
}

const INVALID_PLACEHOLDER = <span className="text-sm text-muted-foreground">—</span>;


interface RebalancingTableProps {
  categories: RebalancingCategory[];
  onAllocationChange: (categoryId: string, allocation: number) => void;
  hideRetired?: boolean;
  hideZeroValue?: boolean;
}

export function RebalancingTable({ categories, onAllocationChange, hideRetired, hideZeroValue }: RebalancingTableProps) {
  const { t } = useTranslation('reports');
  const data = useMemo(() => {
    const filtered = categories.map(cat => ({
      ...cat,
      securities: cat.securities.filter(s => {
        if (hideRetired && s.isRetired) return false;
        if (hideZeroValue && parseFloat(s.actualValue) === 0) return false;
        return true;
      }),
    }));
    return buildRebalancingTree(filtered);
  }, [categories, hideRetired, hideZeroValue]);

  const [expanded, setExpanded] = useState<ExpandedState>({});

  const handleAllocationBlur = useCallback((categoryId: string, value: string) => {
    const num = parseFloat(value);
    if (isNaN(num) || num < 0 || num > 100) return;
    onAllocationChange(categoryId, Math.round(num * 100));
  }, [onAllocationChange]);

  const columns = useMemo<ColumnDef<TreeRow>[]>(() => [
    {
      accessorKey: 'name',
      header: t('rebalancing.columns.category'),
      cell: ({ row }) => (
        <div style={{ paddingLeft: `${row.depth * 20}px` }} className="flex items-center gap-1">
          {row.getCanExpand() ? (
            <button onClick={row.getToggleExpandedHandler()} className="text-muted-foreground hover:text-foreground">
              {row.getIsExpanded() ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>
          ) : <span className="w-[14px]" />}
          {row.original.type === 'security' && row.original.logoUrl ? (
            <img src={row.original.logoUrl} alt="" className="h-5 w-5 rounded-md object-contain flex-shrink-0" />
          ) : row.original.type === 'security' ? (
            <span className="w-5 flex-shrink-0" />
          ) : null}
          <span className={cn(
            row.original.type === 'category' && 'font-medium',
            row.original.type === 'security' && !row.original.rebalancingIncluded && 'text-muted-foreground line-through',
          )}>
            {row.original.name}
          </span>
        </div>
      ),
    },
    {
      id: 'allocation',
      header: t('rebalancing.columns.allocation'),
      cell: ({ row }) => {
        if (row.original.type !== 'category') return null;
        const alloc = (row.original.allocation ?? 0) / 100;
        const hasError = row.original.allocationSumOk === false;
        return (
          <div className={cn(
            'flex items-center gap-1.5',
            hasError && 'text-[var(--qv-warning)]',
          )}>
            <Input
              type="number" min={0} max={100} step={0.01}
              defaultValue={alloc.toFixed(2)}
              onBlur={e => handleAllocationBlur(row.original.id, e.target.value)}
              className="w-24 text-sm h-7 tabular-nums"
            />
            {hasError && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <AlertTriangle size={14} className="text-[var(--qv-warning)] flex-shrink-0" />
                  </TooltipTrigger>
                  <TooltipContent>
                    {t('rebalancing.allocationSumWarning', {
                      sum: ((row.original.allocationSum ?? 0) / 100).toFixed(0),
                      expected: '100',
                    })}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </div>
        );
      },
    },
    {
      id: 'weight',
      header: t('rebalancing.columns.weight'),
      cell: ({ row }) => {
        if (row.original.type !== 'security') return null;
        return <span className="text-sm font-medium">{((row.original.weight ?? 10000) / 100).toFixed(2)}%</span>;
      },
    },
    {
      accessorKey: 'actualValue',
      header: t('rebalancing.columns.actualValue'),
      cell: ({ row }) => (
        <CurrencyDisplay value={parseFloat(row.original.actualValue)} className="text-sm font-medium" />
      ),
    },
    {
      id: 'targetValue',
      header: t('rebalancing.columns.targetValue'),
      cell: ({ row }) => {
        if (row.original.type !== 'category') return null;
        if (row.original.allocationsInvalid) return INVALID_PLACEHOLDER;
        return <CurrencyDisplay value={parseFloat(row.original.targetValue ?? '0')} className="text-sm text-muted-foreground" />;
      },
    },
    {
      id: 'deltaValue',
      header: t('rebalancing.columns.deltaValue'),
      cell: ({ row }) => {
        if (row.original.type !== 'category') return null;
        if (row.original.allocationsInvalid) return INVALID_PLACEHOLDER;
        const delta = parseFloat(row.original.deltaValue ?? '0');
        return (
          <CurrencyDisplay value={delta} className="text-sm" colorize />
        );
      },
    },
    {
      id: 'deltaPercent',
      header: t('rebalancing.columns.deltaPercent'),
      cell: ({ row }) => {
        if (row.original.type !== 'category') return null;
        if (row.original.allocationsInvalid) return INVALID_PLACEHOLDER;
        const dp = parseFloat(row.original.deltaPercent ?? '0');
        return (
          <span className={cn(
            'text-sm',
            dp > 0 ? 'text-[var(--qv-positive)]' : dp < 0 ? 'text-[var(--qv-negative)]' : '',
          )}>
            {formatPercentage(dp)}
          </span>
        );
      },
    },
    {
      id: 'rebalanceAmount',
      header: t('rebalancing.columns.rebalanceAmount'),
      cell: ({ row }) => {
        if (row.original.type !== 'security') return null;
        if (row.original.allocationsInvalid) return INVALID_PLACEHOLDER;
        const amt = parseFloat(row.original.rebalanceAmount ?? '0');
        return (
          <CurrencyDisplay value={amt} className="text-sm" colorize />
        );
      },
    },
    {
      id: 'rebalanceShares',
      header: t('rebalancing.columns.rebalanceShares'),
      cell: ({ row }) => {
        if (row.original.type !== 'security') return null;
        if (row.original.allocationsInvalid) return INVALID_PLACEHOLDER;
        const shares = parseFloat(row.original.rebalanceShares ?? '0');
        return (
          <span className={cn(
            'text-sm',
            shares > 0 ? 'text-[var(--qv-positive)]' : shares < 0 ? 'text-[var(--qv-negative)]' : '',
          )}>
            {shares.toFixed(2)}
          </span>
        );
      },
    },
  ], [t, handleAllocationBlur]);

  const table = useReactTable<TreeRow>({
    data,
    columns,
    state: { expanded },
    onExpandedChange: setExpanded,
    getCoreRowModel: getCoreRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
    getSubRows: (row) => row.subRows,
    getRowId: (row) => row.id,
  });

  return (
    <>
      <div className="flex items-center gap-1 mb-2">
        <Button variant="ghost" size="sm" onClick={() => table.toggleAllRowsExpanded(true)}>
          <ChevronsDownUp size={14} className="mr-1" />
          {t('assetAllocation.expandAll')}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => table.toggleAllRowsExpanded(false)}>
          <ChevronsUpDown size={14} className="mr-1" />
          {t('assetAllocation.collapseAll')}
        </Button>
      </div>
      <Table>
      <TableHeader>
        {table.getHeaderGroups().map(hg => (
          <TableRow key={hg.id}>
            {hg.headers.map(h => (
              <TableHead key={h.id} className={cn(
                'text-xs uppercase tracking-wider',
                h.column.id !== 'name' && h.column.id !== 'allocation' && 'text-right',
              )}>
                {flexRender(h.column.columnDef.header, h.getContext())}
              </TableHead>
            ))}
          </TableRow>
        ))}
      </TableHeader>
      <TableBody>
        {table.getRowModel().rows.map(row => (
          <TableRow
            key={row.id}
            className="transition-none hover:bg-[var(--qv-surface-elevated)]"
          >
            {row.getVisibleCells().map(cell => (
              <TableCell key={cell.id} className={cn(
                cell.column.id !== 'name' && cell.column.id !== 'allocation' && 'text-right tabular-nums',
              )}>
                {flexRender(cell.column.columnDef.cell, cell.getContext())}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
      </Table>
    </>
  );
}
