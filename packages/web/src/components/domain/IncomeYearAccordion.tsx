import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { CurrencyDisplay } from '@/components/shared/CurrencyDisplay';
import { IncomeMonthSubheader } from './IncomeMonthSubheader';
import type { PaymentGroup } from '@/api/types';

interface IncomeYearAccordionProps {
  year: number;
  groups: PaymentGroup[];
  amountMode: 'gross' | 'net';
  isOpen: boolean;
  onToggle: () => void;
  isYTD: boolean;
  foldedMonths: Set<string>;
  onToggleFoldMonth: (bucket: string) => void;
}

export function IncomeYearAccordion({
  year,
  groups,
  amountMode,
  isOpen,
  onToggle,
  isYTD,
  foldedMonths,
  onToggleFoldMonth,
}: IncomeYearAccordionProps) {
  const { t } = useTranslation('reports');

  const totals = groups.reduce(
    (acc, g) => {
      const v = parseFloat(amountMode === 'gross' ? g.totalGross : g.totalNet);
      return { total: acc.total + v, count: acc.count + g.count };
    },
    { total: 0, count: 0 },
  );

  return (
    <div
      className={`rounded-md border ${isOpen ? 'border-[var(--color-primary)]/40' : 'border-[var(--qv-border-subtle)]'} mb-3 overflow-hidden bg-[var(--qv-surface)]`}
    >
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-[var(--qv-surface-3)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
        aria-expanded={isOpen}
      >
        <div className="flex items-center gap-3">
          {isOpen ? (
            <ChevronDown className="h-4 w-4 text-[var(--qv-text-secondary)]" />
          ) : (
            <ChevronRight className="h-4 w-4 text-[var(--qv-text-secondary)]" />
          )}
          <span className="font-display text-2xl font-medium" style={{ fontVariationSettings: '"opsz" 72' }}>
            {year}
          </span>
          {isYTD && (
            <Badge variant="outline" className="rounded-sm">
              {t('payments.detail.year.ytd')}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-4">
          <span className="qv-eyebrow text-[var(--qv-text-faint)]">
            {t('payments.detail.year.payments', { count: totals.count })}
          </span>
          <span className="qv-numeric font-medium text-base">
            <CurrencyDisplay value={totals.total} animated={false} />
          </span>
        </div>
      </button>
      {isOpen && (
        <div>
          {groups
            .slice()
            .sort((a, b) => b.bucket.localeCompare(a.bucket))
            .map((g) => (
              <IncomeMonthSubheader
                key={g.bucket}
                group={g}
                amountMode={amountMode}
                isFolded={foldedMonths.has(g.bucket)}
                onToggleFold={() => onToggleFoldMonth(g.bucket)}
              />
            ))}
        </div>
      )}
    </div>
  );
}
