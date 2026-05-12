import { useTranslation } from 'react-i18next';
import { CurrencyDisplay } from '@/components/shared/CurrencyDisplay';
import { IncomePaymentRow } from './IncomePaymentRow';
import type { PaymentGroup } from '@/api/types';

interface IncomeMonthSubheaderProps {
  group: PaymentGroup;
  amountMode: 'gross' | 'net';
  isFolded: boolean;
  onToggleFold: () => void;
}

const MONTH_LONG_FMT = new Intl.DateTimeFormat(undefined, {
  month: 'long',
  year: 'numeric',
});

function formatMonthLabel(bucket: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(bucket);
  if (!m) return bucket;
  const d = new Date(parseInt(m[1]!, 10), parseInt(m[2]!, 10) - 1, 1);
  return MONTH_LONG_FMT.format(d).toUpperCase();
}

export function IncomeMonthSubheader({
  group,
  amountMode,
  isFolded,
  onToggleFold,
}: IncomeMonthSubheaderProps) {
  const { t } = useTranslation('reports');
  const total = parseFloat(
    amountMode === 'gross' ? group.totalGross : group.totalNet,
  );

  return (
    <div id={`income-month-${group.bucket}`} className="scroll-mt-20">
      <button
        type="button"
        onClick={onToggleFold}
        className="w-full sticky top-0 z-10 flex items-center justify-between px-4 py-2 bg-[var(--qv-surface-elevated)] border-b border-[var(--qv-border-subtle)] hover:bg-[var(--qv-surface-3)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
        aria-expanded={!isFolded}
      >
        <span className="qv-eyebrow text-[var(--qv-text-display)]">
          {formatMonthLabel(group.bucket)}
        </span>
        <span className="qv-numeric font-medium text-sm">
          <CurrencyDisplay value={total} animated={false} />
        </span>
      </button>
      {!isFolded && (
        <div>
          {group.payments.map((p) => (
            <IncomePaymentRow key={p.id} payment={p} amountMode={amountMode} />
          ))}
        </div>
      )}
      {/* count helper for screen readers when folded */}
      {isFolded && (
        <div className="sr-only">{t('payments.detail.year.payments', { count: group.count })}</div>
      )}
    </div>
  );
}
