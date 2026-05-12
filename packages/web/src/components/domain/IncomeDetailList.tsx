import {
  forwardRef,
  useImperativeHandle,
  useMemo,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { getYear } from 'date-fns';
import Decimal from 'decimal.js';
import { Receipt } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/shared/EmptyState';
import { IncomeYearAccordion } from './IncomeYearAccordion';
import { IncomeFilterBar } from './IncomeFilterBar';
import {
  bucketByYear,
  filterPayments,
  sortPayments,
  type DetailFilters,
  type DetailSort,
} from './IncomeDetailList.utils';
import type { PaymentGroup } from '@/api/types';

export interface IncomeDetailListHandle {
  scrollToMonth(bucket: string): void;
}

interface IncomeDetailListProps {
  combinedGroups: PaymentGroup[];
  amountMode: 'gross' | 'net';
  groupBy: 'month' | 'quarter' | 'year' | 'security' | 'type';
  filters: DetailFilters;
  sort: DetailSort;
  onFiltersChange: (filters: DetailFilters) => void;
  onSortChange: (sort: DetailSort) => void;
  onClearFilters: () => void;
  periodEnd: string;
}

export const IncomeDetailList = forwardRef<
  IncomeDetailListHandle,
  IncomeDetailListProps
>(function IncomeDetailList(
  {
    combinedGroups,
    amountMode,
    groupBy,
    filters,
    sort,
    onFiltersChange,
    onSortChange,
    onClearFilters,
    periodEnd,
  },
  ref,
) {
  const { t } = useTranslation('reports');

  const [openYears, setOpenYears] = useState<Map<number, boolean>>(new Map());
  const [foldedMonths, setFoldedMonths] = useState<Set<string>>(new Set());

  // Apply filter+sort to each group's payments; drop emptied groups.
  const processedGroups = useMemo<PaymentGroup[]>(() => {
    return combinedGroups
      .map((g) => {
        const filtered = filterPayments(g.payments, filters);
        const sorted = sortPayments(filtered, sort);
        const totalGross = sorted.reduce((s, p) => s.plus(p.grossAmount), new Decimal(0)).toString();
        const totalNet = sorted.reduce((s, p) => s.plus(p.netAmount), new Decimal(0)).toString();
        return {
          bucket: g.bucket,
          totalGross,
          totalNet,
          count: sorted.length,
          payments: sorted,
        };
      })
      .filter((g) => g.payments.length > 0);
  }, [combinedGroups, filters, sort]);

  const totalCount = useMemo(
    () => combinedGroups.reduce((s, g) => s + g.count, 0),
    [combinedGroups],
  );
  const filteredCount = useMemo(
    () => processedGroups.reduce((s, g) => s + g.count, 0),
    [processedGroups],
  );

  const availableSecurities = useMemo(() => {
    const map = new Map<string, string>();
    for (const g of combinedGroups) {
      for (const p of g.payments) {
        if (p.securityId && p.securityName && !map.has(p.securityId)) {
          map.set(p.securityId, p.securityName);
        }
      }
    }
    return Array.from(map.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [combinedGroups]);

  const yearMap = useMemo(() => bucketByYear(processedGroups), [processedGroups]);
  const sortedYears = useMemo(
    () => Array.from(yearMap.keys()).sort((a, b) => b - a),
    [yearMap],
  );
  const currentYear = getYear(new Date(periodEnd));

  const isYearOpen = (year: number): boolean => {
    if (openYears.has(year)) return openYears.get(year)!;
    return year === currentYear;
  };

  const toggleYear = (year: number) => {
    setOpenYears((prev) => {
      const current = prev.has(year) ? prev.get(year)! : year === currentYear;
      const next = new Map(prev);
      next.set(year, !current);
      return next;
    });
  };

  const toggleMonthFold = (bucket: string) => {
    setFoldedMonths((prev) => {
      const next = new Set(prev);
      if (next.has(bucket)) next.delete(bucket);
      else next.add(bucket);
      return next;
    });
  };

  useImperativeHandle(
    ref,
    () => ({
      scrollToMonth(bucket: string) {
        const m = /^(\d{4})/.exec(bucket);
        if (!m) return;
        const year = parseInt(m[1]!, 10);
        // Force-open the target year first
        setOpenYears((prev) => {
          const next = new Map(prev);
          next.set(year, true);
          return next;
        });
        // Unfold the month if it was folded
        setFoldedMonths((prev) => {
          if (!prev.has(bucket)) return prev;
          const next = new Set(prev);
          next.delete(bucket);
          return next;
        });
        // Scroll on the next frame so the just-mounted node exists
        requestAnimationFrame(() => {
          const el = document.getElementById(`income-month-${bucket}`);
          if (!el) return;
          el.scrollIntoView({ block: 'center', behavior: 'smooth' });
          el.classList.add('qv-bucket-flash');
          window.setTimeout(() => el.classList.remove('qv-bucket-flash'), 1400);
        });
      },
    }),
    [],
  );

  // Branch: time-bucket modes get the year-accordion shape.
  // Security/type modes keep the legacy flat per-bucket Cards (rendered by Payments.tsx).
  if (groupBy === 'security' || groupBy === 'type') {
    return null; // legacy detail rendering stays in Payments.tsx for these modes
  }

  if (combinedGroups.length === 0) {
    return <EmptyState icon={Receipt} title={t('payments.empty.noPayments')} />;
  }

  return (
    <div>
      <IncomeFilterBar
        filters={filters}
        sort={sort}
        totalCount={totalCount}
        filteredCount={filteredCount}
        availableSecurities={availableSecurities}
        onFiltersChange={onFiltersChange}
        onSortChange={onSortChange}
      />
      {processedGroups.length === 0 ? (
        <div className="border border-[var(--qv-border-subtle)] rounded-md p-6 flex flex-col items-center gap-3">
          <EmptyState icon={Receipt} title={t('payments.empty.filtered')} />
          <Button variant="ghost" onClick={onClearFilters}>
            {t('payments.empty.clearFilters')}
          </Button>
        </div>
      ) : (
        sortedYears.map((year) => (
          <IncomeYearAccordion
            key={year}
            year={year}
            groups={yearMap.get(year)!}
            amountMode={amountMode}
            isOpen={isYearOpen(year)}
            onToggle={() => toggleYear(year)}
            isYTD={year === currentYear}
            foldedMonths={foldedMonths}
            onToggleFoldMonth={toggleMonthFold}
          />
        ))
      )}
    </div>
  );
});
