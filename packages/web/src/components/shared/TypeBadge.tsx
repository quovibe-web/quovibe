import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { getTransactionBadgeVariant, getTransactionLabelKey, TX_TYPE_ICON } from '@/lib/transaction-display';
import type { BadgeVariant } from '@/lib/transaction-display';

/** Semantic-token tint — Flexoki palette via design system vars (§1.3 + §1.5). */
const VARIANT_TINT: Record<BadgeVariant, string> = {
  profit: 'bg-[var(--qv-positive)]/12 text-[var(--qv-positive)] border-[var(--qv-positive)]/25',
  loss: 'bg-[var(--qv-negative)]/12 text-[var(--qv-negative)] border-[var(--qv-negative)]/25',
  dividend: 'bg-[var(--qv-warning)]/12 text-[var(--qv-warning)] border-[var(--qv-warning)]/25',
  neutral: 'bg-[var(--qv-surface-elevated)] text-[var(--qv-text-secondary)] border-[var(--qv-border-subtle)]',
};

interface TypeBadgeProps {
  type: string;
  direction?: 'inbound' | 'outbound' | null;
  accountContext?: 'global' | 'deposit' | 'securities';
}

export function TypeBadge({ type, direction, accountContext = 'global' }: TypeBadgeProps) {
  const { t } = useTranslation('transactions');
  const variant = getTransactionBadgeVariant(type, accountContext, direction);
  const Icon = TX_TYPE_ICON[type];
  const labelKey = getTransactionLabelKey(type, direction);

  return (
    <Badge variant={variant} className={`gap-1 text-xs rounded-md ${VARIANT_TINT[variant]}`}>
      {Icon && <Icon className="h-3 w-3" />}
      {t(labelKey)}
    </Badge>
  );
}
