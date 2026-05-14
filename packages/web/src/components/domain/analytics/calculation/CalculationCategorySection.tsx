import { forwardRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { CurrencyDisplay } from '@/components/shared/CurrencyDisplay';
import { formatDate } from '@/lib/formatters';
import type {
  CategoryDef,
  CategorySubRow,
  DrillDownTable,
  DrillDownColumn,
} from '@/lib/calculation-rows';
import type { CalculationBreakdownResponse } from '@quovibe/shared';
import { cn } from '@/lib/utils';

interface CalculationCategorySectionProps {
  category: CategoryDef;
  data: CalculationBreakdownResponse;
  expanded: boolean;
  density: 'comfortable' | 'dense';
  onToggle: () => void;
}

export const CalculationCategorySection = forwardRef<HTMLDivElement, CalculationCategorySectionProps>(
  function CalculationCategorySection({ category, data, expanded, density, onToggle }, ref) {
    const { t } = useTranslation('performance');
    const total = category.extractTotal(data);
    const totalNumeric = parseFloat(total);
    const subRows = category.extractSubRows(data);
    const tables = category.extractDrillDownTables(data);
    const hasContent = subRows.length > 0 || tables.some((tb) => tb.rows.length > 0 || tb.placeholderKey);

    return (
      <Card ref={ref} className="rounded-md" id={`calculation-section-${category.id}`}>
        <button
          type="button"
          className={cn(
            'w-full flex items-start justify-between gap-4 p-5 text-left',
            hasContent && 'cursor-pointer hover:bg-[var(--qv-surface-3)]/40 transition-colors',
            !hasContent && 'cursor-default',
          )}
          onClick={hasContent ? onToggle : undefined}
          aria-expanded={hasContent ? expanded : undefined}
        >
          <div className="flex-1 min-w-0">
            <div className="qv-eyebrow text-[var(--qv-text-faint)]">{t(category.eyebrowKey)}</div>
            <p className="text-sm text-muted-foreground mt-1">{t(category.descriptionKey)}</p>
          </div>
          <div className="flex items-center gap-3">
            <CurrencyDisplay
              value={category.colorSign === -1 ? -totalNumeric : totalNumeric}
              colorize={category.colorize}
              className="qv-numeric text-xl font-medium"
            />
            {hasContent && (
              expanded
                ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
                : <ChevronRight className="h-4 w-4 text-muted-foreground" />
            )}
          </div>
        </button>

        {expanded && hasContent && (
          <CardContent className="pt-0 space-y-6 border-t border-[var(--qv-border-subtle)]">
            {/* Sub-row aggregate list */}
            {subRows.length > 0 && (
              <div className="space-y-1 pt-4">
                {subRows.map((sub) => <SubRowLine key={sub.labelKey} sub={sub} colorSign={category.colorSign} />)}
              </div>
            )}

            {/* Drill-down tables */}
            {tables.map((table) => (
              <DrillDown
                key={table.titleKey}
                table={table}
                density={density}
                categoryColorSign={category.colorSign}
              />
            ))}
          </CardContent>
        )}
      </Card>
    );
  },
);

function SubRowLine({ sub, colorSign }: { sub: CategorySubRow; colorSign?: 1 | -1 }) {
  const { t } = useTranslation('performance');
  const numeric = parseFloat(sub.total);
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-sm text-[var(--qv-text-secondary)]">{t(sub.labelKey)}</span>
      <CurrencyDisplay
        value={colorSign === -1 ? -numeric : numeric}
        colorize={sub.colorize}
        className="qv-numeric text-sm"
      />
    </div>
  );
}

function DrillDown({
  table,
  density,
  categoryColorSign,
}: {
  table: DrillDownTable;
  density: 'comfortable' | 'dense';
  categoryColorSign?: 1 | -1;
}) {
  const { t } = useTranslation('performance');

  if (table.placeholderKey) {
    return (
      <div>
        <div className="qv-eyebrow text-[var(--qv-text-faint)] mb-2">{t(table.titleKey)}</div>
        <p className="text-sm italic text-muted-foreground">{t(table.placeholderKey)}</p>
      </div>
    );
  }

  if (table.rows.length === 0) return null;

  const cellPaddingY = density === 'dense' ? 'py-1' : 'py-2';
  const cellPaddingX = density === 'dense' ? 'px-2' : 'px-3';

  return (
    <div>
      <div className="qv-eyebrow text-[var(--qv-text-faint)] mb-2">{t(table.titleKey)}</div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--qv-border-subtle)]">
              {table.columns.map((col) => (
                <th
                  key={col.id}
                  className={cn(
                    'qv-eyebrow text-[var(--qv-text-faint)]',
                    cellPaddingX, cellPaddingY,
                    col.align === 'right' ? 'text-right' : 'text-left',
                  )}
                >
                  {t(col.labelKey)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, i) => (
              // native-ok: array index used as key, not financial calculation
              <tr key={i} className="border-b border-[var(--qv-border-subtle)] hover:bg-[var(--qv-surface-3)]">
                {table.columns.map((col) => (
                  <td
                    key={col.id}
                    className={cn(
                      cellPaddingX, cellPaddingY,
                      col.align === 'right' ? 'text-right' : 'text-left',
                    )}
                  >
                    <CellValue
                      value={row[col.id]}
                      column={col}
                      categoryColorSign={categoryColorSign}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CellValue({
  value,
  column,
  categoryColorSign,
}: {
  value: string | undefined;
  column: DrillDownColumn;
  categoryColorSign?: 1 | -1;
}) {
  if (value == null || value === '') return <span className="text-muted-foreground">—</span>;
  if (column.format === 'date') {
    return <span className="qv-numeric text-muted-foreground">{formatDate(value)}</span>;
  }
  if (column.format === 'currency') {
    const raw = parseFloat(value);
    // Frictions store fee/tax magnitudes positive; the section subtracts them, so
    // per-row display flips the sign too (matches ClassicView's `negate: true`).
    // Unary negation preserves the refund-vs-paid distinction (refund stored
    // negative flips to positive income).
    const display = categoryColorSign === -1 ? -raw : raw;
    return (
      <CurrencyDisplay
        value={display}
        colorize={!!column.colorize}
        className="qv-numeric"
      />
    );
  }
  return <span>{value}</span>;
}
