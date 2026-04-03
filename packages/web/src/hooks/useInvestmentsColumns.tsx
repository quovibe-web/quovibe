import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';
import type { SecurityListItem, StatementSecurityEntry, SecurityPerfResponse } from '@/api/types';
import { CurrencyDisplay } from '@/components/shared/CurrencyDisplay';
import { SharesDisplay } from '@/components/shared/SharesDisplay';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { formatDate, formatPercentage } from '@/lib/formatters';
import { usePrivacy } from '@/context/privacy-context';
import { COLORS } from '@/lib/colors';
import { textColumnMeta, currencyColumnMeta, percentColumnMeta, sharesColumnMeta, dateColumnMeta } from '@/lib/column-factories';

interface UseInvestmentsColumnsParams {
  statementMap: Map<string, StatementSecurityEntry>;
  perfMap: Map<string, SecurityPerfResponse>;
  totalSecurityValue: number;
  logoMap: Map<string, string>;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
}

/** Local helper — colored percentage cell for performance columns */
function PctCell({ value }: { value: string }) {
  const { isPrivate } = usePrivacy();
  const n = parseFloat(value);
  return (
    <span style={{ color: !isPrivate && n >= 0 ? COLORS.profit : COLORS.loss }}>
      {isPrivate ? '••••••' : formatPercentage(n)}
    </span>
  );
}

export function useInvestmentsColumns({
  statementMap, perfMap, totalSecurityValue, logoMap, onEdit, onDelete,
}: UseInvestmentsColumnsParams): ColumnDef<SecurityListItem>[] {
  const { t } = useTranslation('investments');
  const { t: tCommon } = useTranslation('common');
  const { isPrivate } = usePrivacy();

  return useMemo(() => {
    const columns: ColumnDef<SecurityListItem>[] = [
      // ── Logo ──
      {
        id: 'logo',
        header: '',
        size: 36,
        minSize: 36,
        maxSize: 36,
        enableSorting: false,
        meta: { locked: true, sticky: 'left' },
        cell: ({ row }) => {
          const logo = logoMap.get(row.original.id);
          return logo
            ? <img src={logo} alt="" className="h-6 w-6 rounded-md object-contain" />
            : <div className="h-6 w-6" />;
        },
      },

      // ── Name (sticky for horizontal scroll) ──
      {
        accessorKey: 'name',
        ...textColumnMeta({ priority: 'high' }),
        header: t('columns.name'),
        size: 280,
        minSize: 150,
        maxSize: 500,
        enableSorting: true,
        meta: { align: 'left', dataType: 'text', sticky: 'left', priority: 'high' },
        cell: ({ row }) => (
          <div className="truncate">
            <span className={row.original.isRetired ? 'text-muted-foreground' : 'font-medium'}>
              {row.original.name}
              {row.original.isRetired && (
                <span className="ml-2 text-xs">{tCommon('retired')}</span>
              )}
            </span>
          </div>
        ),
      },

      // ── ISIN ──
      {
        accessorKey: 'isin',
        ...textColumnMeta({ priority: 'low' }),
        header: t('columns.isin'),
        size: 130,
        minSize: 100,
        maxSize: 180,
        enableSorting: true,
        cell: ({ getValue }) => (
          <span className="font-mono text-sm">{getValue<string | null>() ?? '—'}</span>
        ),
      },

      // ── Ticker ──
      {
        accessorKey: 'ticker',
        ...textColumnMeta({ priority: 'low' }),
        header: t('columns.ticker'),
        size: 80,
        minSize: 60,
        maxSize: 120,
        enableSorting: true,
        cell: ({ getValue }) => getValue<string | null>() ?? '—',
      },

      // ── Currency ──
      {
        accessorKey: 'currency',
        ...textColumnMeta({ priority: 'low' }),
        header: t('columns.currency'),
        size: 70,
        minSize: 60,
        maxSize: 90,
        enableSorting: true,
      },

      // ── Shares (dual source: statementMap preferred, fallback to perfMap) ──
      {
        id: 'shares',
        accessorFn: (row) => {
          const shares = statementMap.get(row.id)?.shares ?? perfMap.get(row.id)?.shares;
          return shares != null ? parseFloat(shares) : null;
        },
        ...sharesColumnMeta({ priority: 'medium' }),
        header: t('columns.shares'),
        size: 110,
        minSize: 80,
        maxSize: 160,
        enableSorting: true,
        cell: ({ row }) => {
          const shares = statementMap.get(row.original.id)?.shares ?? perfMap.get(row.original.id)?.shares;
          return (
            <div className="text-right">
              <SharesDisplay value={shares} className="text-sm" />
            </div>
          );
        },
      },

      // ── Price per Share ──
      {
        id: 'pricePerShare',
        accessorFn: (row) => {
          const entry = statementMap.get(row.id);
          return entry ? parseFloat(entry.pricePerShare) : null;
        },
        ...currencyColumnMeta({ priority: 'medium' }),
        header: t('columns.price'),
        size: 120,
        minSize: 90,
        maxSize: 160,
        enableSorting: true,
        cell: ({ row }) => {
          const entry = statementMap.get(row.original.id);
          if (!entry) return <div className="text-right">—</div>;
          return (
            <div className="text-right">
              <CurrencyDisplay value={parseFloat(entry.pricePerShare)} currency={entry.currency} className="text-sm" />
            </div>
          );
        },
      },

      // ── Market Value (from statement) ──
      {
        id: 'marketValue',
        accessorFn: (row) => {
          const entry = statementMap.get(row.id);
          return entry ? parseFloat(entry.marketValue) : null;
        },
        ...currencyColumnMeta({ priority: 'high' }),
        header: t('columns.marketValue'),
        size: 130,
        minSize: 100,
        maxSize: 180,
        enableSorting: true,
        cell: ({ row }) => {
          const entry = statementMap.get(row.original.id);
          if (!entry) return <div className="text-right">—</div>;
          return (
            <div className="text-right">
              <CurrencyDisplay value={parseFloat(entry.marketValue)} currency={entry.currency} className="text-sm font-medium" />
            </div>
          );
        },
      },

      // ── Percentage of Portfolio ──
      // FIX: previously sorted by marketValue — now sorts by actual percentage
      {
        id: 'percentage',
        accessorFn: (row) => {
          const entry = statementMap.get(row.id);
          if (!entry || totalSecurityValue <= 0) return null;
          return parseFloat(entry.marketValue) / totalSecurityValue;
        },
        ...percentColumnMeta({ priority: 'medium' }),
        header: t('columns.percentage'),
        size: 100,
        minSize: 70,
        maxSize: 140,
        enableSorting: true,
        cell: ({ row }) => {
          const entry = statementMap.get(row.original.id);
          if (!entry || totalSecurityValue <= 0) return <div className="text-right">—</div>;
          const pct = (parseFloat(entry.marketValue) / totalSecurityValue) * 100;
          return (
            <div className="text-right">
              <span className="text-sm tabular-nums text-muted-foreground">
                {isPrivate ? '••••••' : formatPercentage(pct / 100)}
              </span>
            </div>
          );
        },
      },

      // ── Latest Quote ──
      {
        id: 'latestQuote',
        accessorFn: (row) => row.latestPrice != null ? parseFloat(row.latestPrice) : null,
        ...currencyColumnMeta({ priority: 'low' }),
        header: t('columns.latestQuote'),
        size: 120,
        minSize: 90,
        maxSize: 160,
        enableSorting: true,
        cell: ({ row }) => {
          const price = row.original.latestPrice;
          if (!price) return <div className="text-right">—</div>;
          return (
            <div className="text-right">
              <CurrencyDisplay value={parseFloat(price)} currency={row.original.currency} className="text-sm" />
            </div>
          );
        },
      },

      // ── Latest Date ──
      // FIX: previously used default string sort — now uses proper date sort
      {
        id: 'latestDate',
        accessorFn: (row) => row.latestDate ?? null,
        ...dateColumnMeta({ priority: 'low' }),
        header: t('columns.latestDate'),
        size: 110,
        minSize: 90,
        maxSize: 140,
        enableSorting: true,
        meta: { align: 'right', dataType: 'date', priority: 'low' },
        cell: ({ row }) => (
          <div className="text-right text-sm text-muted-foreground">
            {row.original.latestDate ? formatDate(row.original.latestDate) : '—'}
          </div>
        ),
      },

      // ── IRR ──
      // Non-converged IRR returns null → sorted to end (replaces -Infinity hack)
      {
        id: 'irr',
        accessorFn: (row) => {
          const perf = perfMap.get(row.id);
          if (!perf?.irrConverged || perf.irr === null) return null;
          return parseFloat(perf.irr);
        },
        ...percentColumnMeta({ priority: 'low' }),
        size: 90,
        minSize: 70,
        maxSize: 120,
        header: t('columns.irr'),
        cell: ({ row }) => {
          const perf = perfMap.get(row.original.id);
          if (!perf) return <div className="text-right text-muted-foreground">—</div>;
          if (!perf.irrConverged || perf.irr === null)
            return <div className="text-right text-[var(--qv-warning)] text-xs">{t('columns.irrNotConverged')}</div>;
          return <div className="text-right"><PctCell value={perf.irr} /></div>;
        },
        enableSorting: true,
      },

      // ── TTWROR ──
      {
        id: 'ttwror',
        accessorFn: (row) => {
          const val = perfMap.get(row.id)?.ttwror;
          return val != null ? parseFloat(val) : null;
        },
        ...percentColumnMeta({ priority: 'high' }),
        size: 90,
        minSize: 70,
        maxSize: 120,
        header: t('columns.ttwror'),
        cell: ({ row }) => {
          const perf = perfMap.get(row.original.id);
          if (!perf?.ttwror) return <div className="text-right text-muted-foreground">—</div>;
          return <div className="text-right"><PctCell value={perf.ttwror} /></div>;
        },
        enableSorting: true,
      },

      // ── TTWROR p.a. ──
      {
        id: 'ttwrorPa',
        accessorFn: (row) => {
          const val = perfMap.get(row.id)?.ttwrorPa;
          return val != null ? parseFloat(val) : null;
        },
        ...percentColumnMeta({ priority: 'low' }),
        size: 100,
        minSize: 80,
        maxSize: 130,
        header: t('columns.ttwrorPa'),
        cell: ({ row }) => {
          const perf = perfMap.get(row.original.id);
          if (!perf?.ttwrorPa) return <div className="text-right text-muted-foreground">—</div>;
          return <div className="text-right"><PctCell value={perf.ttwrorPa} /></div>;
        },
        enableSorting: true,
      },

      // ── Purchase Value ──
      {
        id: 'purchaseValue',
        accessorFn: (row) => {
          const val = perfMap.get(row.id)?.purchaseValue;
          return val != null ? parseFloat(val) : null;
        },
        ...currencyColumnMeta({ priority: 'low' }),
        size: 130,
        minSize: 100,
        maxSize: 180,
        header: t('columns.purchaseValue'),
        cell: ({ row }) => {
          const perf = perfMap.get(row.original.id);
          if (!perf?.purchaseValue) return <div className="text-right text-muted-foreground">—</div>;
          return <div className="text-right"><CurrencyDisplay value={parseFloat(perf.purchaseValue)} /></div>;
        },
        enableSorting: true,
      },

      // ── MVE (Market Value End) ──
      {
        id: 'mve',
        accessorFn: (row) => {
          const val = perfMap.get(row.id)?.mve;
          return val != null ? parseFloat(val) : null;
        },
        ...currencyColumnMeta({ priority: 'low' }),
        size: 130,
        minSize: 100,
        maxSize: 180,
        header: t('columns.mve'),
        cell: ({ row }) => {
          const perf = perfMap.get(row.original.id);
          if (!perf?.mve) return <div className="text-right text-muted-foreground">—</div>;
          return <div className="text-right font-medium"><CurrencyDisplay value={parseFloat(perf.mve)} /></div>;
        },
        enableSorting: true,
      },

      // ── Unrealized Gain (colorized) ──
      {
        id: 'unrealizedGain',
        accessorFn: (row) => {
          const val = perfMap.get(row.id)?.unrealizedGain;
          return val != null ? parseFloat(val) : null;
        },
        ...currencyColumnMeta({ priority: 'medium' }),
        size: 130,
        minSize: 100,
        maxSize: 180,
        header: t('columns.unrealizedGain'),
        cell: ({ row }) => {
          const perf = perfMap.get(row.original.id);
          if (!perf?.unrealizedGain) return <div className="text-right text-muted-foreground">—</div>;
          return <div className="text-right"><CurrencyDisplay value={parseFloat(perf.unrealizedGain)} colorize /></div>;
        },
        enableSorting: true,
      },

      // ── Realized Gain (colorized) ──
      {
        id: 'realizedGain',
        accessorFn: (row) => {
          const val = perfMap.get(row.id)?.realizedGain;
          return val != null ? parseFloat(val) : null;
        },
        ...currencyColumnMeta({ priority: 'low' }),
        size: 130,
        minSize: 100,
        maxSize: 180,
        header: t('columns.realizedGain'),
        cell: ({ row }) => {
          const perf = perfMap.get(row.original.id);
          if (!perf?.realizedGain) return <div className="text-right text-muted-foreground">—</div>;
          return <div className="text-right"><CurrencyDisplay value={parseFloat(perf.realizedGain)} colorize /></div>;
        },
        enableSorting: true,
      },

      // ── Dividends ──
      {
        id: 'dividends',
        accessorFn: (row) => {
          const val = perfMap.get(row.id)?.dividends;
          return val != null ? parseFloat(val) : null;
        },
        ...currencyColumnMeta({ priority: 'low' }),
        size: 110,
        minSize: 80,
        maxSize: 160,
        header: t('columns.dividends'),
        cell: ({ row }) => {
          const perf = perfMap.get(row.original.id);
          if (!perf?.dividends) return <div className="text-right text-muted-foreground">—</div>;
          return <div className="text-right"><CurrencyDisplay value={parseFloat(perf.dividends)} /></div>;
        },
        enableSorting: true,
      },

      // ── Fees ──
      {
        id: 'fees',
        accessorFn: (row) => {
          const val = perfMap.get(row.id)?.fees;
          return val != null ? parseFloat(val) : null;
        },
        ...currencyColumnMeta({ priority: 'low' }),
        size: 100,
        minSize: 80,
        maxSize: 140,
        header: t('columns.fees'),
        cell: ({ row }) => {
          const perf = perfMap.get(row.original.id);
          if (!perf?.fees) return <div className="text-right text-muted-foreground">—</div>;
          return <div className="text-right"><CurrencyDisplay value={parseFloat(perf.fees)} /></div>;
        },
        enableSorting: true,
      },

      // ── Taxes ──
      {
        id: 'taxes',
        accessorFn: (row) => {
          const val = perfMap.get(row.id)?.taxes;
          return val != null ? parseFloat(val) : null;
        },
        ...currencyColumnMeta({ priority: 'low' }),
        size: 100,
        minSize: 80,
        maxSize: 140,
        header: t('columns.taxes'),
        cell: ({ row }) => {
          const perf = perfMap.get(row.original.id);
          if (!perf?.taxes) return <div className="text-right text-muted-foreground">—</div>;
          return <div className="text-right"><CurrencyDisplay value={parseFloat(perf.taxes)} /></div>;
        },
        enableSorting: true,
      },

      // ── Actions ──
      {
        id: 'actions',
        header: '',
        size: 48,
        minSize: 48,
        maxSize: 48,
        enableSorting: false,
        meta: { sticky: 'right', locked: true },
        cell: ({ row }) => (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7 cursor-pointer" onClick={(e) => e.stopPropagation()}>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()} onCloseAutoFocus={(e) => e.preventDefault()}>
              <DropdownMenuItem onClick={() => onEdit(row.original.id)}>
                <Pencil className="mr-2 h-4 w-4" />
                {tCommon('edit')}
              </DropdownMenuItem>
              <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => onDelete(row.original.id)}>
                <Trash2 className="mr-2 h-4 w-4" />
                {tCommon('delete')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ),
      },
    ];

    return columns;
  }, [statementMap, perfMap, totalSecurityValue, logoMap, onEdit, onDelete, t, tCommon, isPrivate]);
}
