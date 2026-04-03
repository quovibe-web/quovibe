import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useWidgetConfig } from '@/context/widget-config-context';
import { useCalculation, useReportingPeriod } from '@/api/use-performance';
import { CALCULATION_ROWS } from '@/lib/calculation-rows';
import type { RowDef } from '@/lib/calculation-rows';
import { CurrencyDisplay } from '@/components/shared/CurrencyDisplay';
import { MetricCardSkeleton } from '@/components/shared/MetricCardSkeleton';
import { SectionSkeleton } from '@/components/shared/SectionSkeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { ChevronRight, ChevronDown, ChevronsUpDown, ChevronsDownUp } from 'lucide-react';
import { formatPercentage } from '@/lib/formatters';
import { formatDate } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import { usePrivacy } from '@/context/privacy-context';
import { CostMethod } from '@quovibe/shared';
import type { CalculationBreakdownResponse } from '@quovibe/shared';
import { resolveDataSeriesToParams } from '@/lib/data-series-utils';

interface CalculationBreakdownCardProps {
  mode: 'full' | 'compact';
}

export function CalculationBreakdownCard({ mode }: CalculationBreakdownCardProps) {
  const { dataSeries, periodOverride, options } = useWidgetConfig();
  const { periodStart: urlStart, periodEnd: urlEnd } = useReportingPeriod();

  const periodStart = periodOverride?.periodStart ?? urlStart;
  const periodEnd = periodOverride?.periodEnd ?? urlEnd;

  const dsParams = resolveDataSeriesToParams(dataSeries);
  const preTax = dsParams.preTax;
  // Extract costMethod from options or default
  const costMethod =
    typeof options.costMethod === 'string' &&
    Object.values(CostMethod).includes(options.costMethod as CostMethod)
      ? (options.costMethod as CostMethod)
      : CostMethod.MOVING_AVERAGE;

  const { data, isLoading, isError, error } = useCalculation(
    preTax,
    costMethod,
    periodStart,
    periodEnd,
    dsParams.filter,
    dsParams.withReference,
    dsParams.taxonomyId,
    dsParams.categoryId,
  );

  if (mode === 'compact') {
    return (
      <CompactView data={data} isLoading={isLoading} isError={isError} error={error} />
    );
  }

  return (
    <FullView data={data} isLoading={isLoading} isError={isError} error={error} />
  );
}

// ---------------------------------------------------------------------------
// Compact View
// ---------------------------------------------------------------------------

interface ViewProps {
  data: CalculationBreakdownResponse | undefined;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
}

function CompactView({ data, isLoading, isError, error }: ViewProps) {
  const { t } = useTranslation('performance');
  const { isPrivate } = usePrivacy();

  if (isLoading) {
    return <MetricCardSkeleton index={0} />;
  }

  if (isError) {
    return (
      <Alert variant="destructive">
        <AlertDescription>
          {error?.message ?? t('errors:unknown')}
        </AlertDescription>
      </Alert>
    );
  }

  if (!data) return null;

  return (
    <div className="space-y-1">
      {CALCULATION_ROWS.map((row) => {
        const total = row.extractTotal(data);
        if (total === null) return null;
        const displayValue = row.negate ? -parseFloat(total) : parseFloat(total);
        return (
          <div
            key={row.key}
            className="flex items-center justify-between py-1 text-sm"
          >
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs text-muted-foreground w-5 text-center">
                {row.sign}
              </span>
              <span className="text-muted-foreground">{t(row.i18nKey)}</span>
            </div>
            <CurrencyDisplay
              value={displayValue}
              colorize={row.colorSign}
              className="tabular-nums"
            />
          </div>
        );
      })}

      <Separator className="my-2" />

      <div className="flex items-center gap-3 pt-1">
        <MetricChip
          label={t('calculation.ttwror')}
          value={isPrivate ? '------' : formatPercentage(parseFloat(data.ttwror))}
        />
        <MetricChip
          label={t('calculation.irrAnn')}
          value={
            isPrivate
              ? '------'
              : data.irrConverged && data.irr !== null
                ? formatPercentage(parseFloat(data.irr))
                : 'N/A'
          }
        />
      </div>
    </div>
  );
}

function MetricChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-1.5 rounded-md bg-muted/50 px-2 py-1 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums">{value}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Full View
// ---------------------------------------------------------------------------

function FullView({ data, isLoading, isError, error }: ViewProps) {
  const { t } = useTranslation('performance');

  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  const toggleRow = (key: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const expandableKeys = useMemo(
    () =>
      CALCULATION_ROWS.filter(
        (r) => r.isExpandable && r.extractItems && data && r.extractItems(data).length > 0,
      ).map((r) => r.key),
    [data],
  );

  const expandAll = () => setExpandedRows(new Set(expandableKeys));
  const collapseAll = () => setExpandedRows(new Set());

  if (isLoading) {
    return <SectionSkeleton rows={9} />;
  }

  if (isError) {
    return (
      <Alert variant="destructive" className="w-full">
        <AlertDescription>
          {error?.message ?? t('errors:unknown')}
        </AlertDescription>
      </Alert>
    );
  }

  if (!data) return null;

  return (
    <div className="max-w-lg">
    <div className="space-y-1">
      {expandableKeys.length > 0 && (
        <div className="flex items-center gap-1 mb-4">
          <Button variant="ghost" size="sm" onClick={expandAll}>
            <ChevronsUpDown size={14} className="mr-1" />
            {t('calculation.expandAll')}
          </Button>
          <Button variant="ghost" size="sm" onClick={collapseAll}>
            <ChevronsDownUp size={14} className="mr-1" />
            {t('calculation.collapseAll')}
          </Button>
        </div>
      )}

      {CALCULATION_ROWS.map((row) => {
        const total = row.extractTotal(data);
        if (total === null) return null;

        const items = row.extractItems ? row.extractItems(data) : [];
        const isExpandable = row.isExpandable && items.length > 0;
        const isExpanded = expandedRows.has(row.key);

        return (
          <div key={row.key}>
            <FullRowHeader
              row={row}
              total={total}
              isExpandable={isExpandable}
              isExpanded={isExpanded}
              onToggle={() => toggleRow(row.key)}
            />

            {isExpanded && row.key !== 'interest' && (
              <ExpandedTable
                rowKey={row.key}
                items={items}
                data={data}
                negate={row.negate}
              />
            )}

            {isExpanded && row.key === 'interest' && (
              <div className="pl-10 pb-2">
                <span className="text-sm italic text-muted-foreground">
                  {t('calculation.interestNotItemized')}
                </span>
              </div>
            )}
          </div>
        );
      })}
    </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Full Row Header
// ---------------------------------------------------------------------------

interface FullRowHeaderProps {
  row: RowDef;
  total: string;
  isExpandable: boolean;
  isExpanded: boolean;
  onToggle: () => void;
}

function FullRowHeader({ row, total, isExpandable, isExpanded, onToggle }: FullRowHeaderProps) {
  const { t } = useTranslation('performance');

  const content = (
    <div
      className={cn(
        'flex items-center justify-between py-2 px-2 rounded-md',
        isExpandable && 'cursor-pointer hover:bg-muted/50',
      )}
      onClick={isExpandable ? onToggle : undefined}
      role={isExpandable ? 'button' : undefined}
      tabIndex={isExpandable ? 0 : undefined}
      aria-expanded={isExpandable ? isExpanded : undefined}
      onKeyDown={
        isExpandable
          ? (e: React.KeyboardEvent) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onToggle();
              }
            }
          : undefined
      }
    >
      <div className="flex items-center gap-2">
        {isExpandable ? (
          isExpanded ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )
        ) : (
          <span className="w-4" />
        )}
        <span className="font-mono text-xs text-muted-foreground w-5 text-center">
          {row.sign}
        </span>
        <span className="text-sm font-medium">{t(row.i18nKey)}</span>
      </div>
      <CurrencyDisplay
        value={row.negate ? -parseFloat(total) : parseFloat(total)}
        colorize={row.colorSign}
        className="text-sm font-medium tabular-nums"
      />
    </div>
  );

  return content;
}

// ---------------------------------------------------------------------------
// Expanded Table
// ---------------------------------------------------------------------------

interface ExpandedTableProps {
  rowKey: string;
  items: { label: string; amount: string; subLabel?: string }[];
  data: CalculationBreakdownResponse;
  negate?: boolean;
}

function ExpandedTable({ rowKey, items, negate }: ExpandedTableProps) {
  const { t } = useTranslation('performance');

  const showFxColumn = rowKey === 'capitalGains';
  const showDateColumn = rowKey === 'pnt';

  return (
    <div className="pl-10 pb-2">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('calculation.columnName')}</TableHead>
            <TableHead className="text-right">{t('calculation.columnAmount')}</TableHead>
            {showFxColumn && (
              <TableHead className="text-right">{t('calculation.thereofFx')}</TableHead>
            )}
            {showDateColumn && (
              <TableHead>{t('calculation.columnDate')}</TableHead>
            )}
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item, idx) => (
            <TableRow key={idx}>
              <TableCell>{item.i18nKey ? t(item.i18nKey) : item.label}</TableCell>
              <TableCell className="text-right">
                <CurrencyDisplay
                  value={negate ? -parseFloat(item.amount) : parseFloat(item.amount)}
                  colorize
                />
              </TableCell>
              {showFxColumn && (
                <TableCell className="text-right">
                  <CurrencyDisplay
                    value={parseFloat(item.subLabel ?? '0')}
                    colorize
                    className={
                      parseFloat(item.subLabel ?? '0') === 0
                        ? 'text-muted-foreground'
                        : undefined
                    }
                  />
                </TableCell>
              )}
              {showDateColumn && item.subLabel && (
                <TableCell className="text-muted-foreground">
                  {formatDate(item.subLabel)}
                </TableCell>
              )}
              {showDateColumn && !item.subLabel && <TableCell />}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
