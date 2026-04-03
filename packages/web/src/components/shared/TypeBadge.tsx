import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { getTransactionBadgeVariant, getTransactionLabelKey, TX_TYPE_ICON } from '@/lib/transaction-display';
import type { BadgeVariant } from '@/lib/transaction-display';

/** Muted tint overrides — desaturated bg + matching text for both themes */
const VARIANT_TINT: Record<BadgeVariant, string> = {
  profit: 'bg-emerald-500/10 text-emerald-700 border-emerald-500/20 dark:text-emerald-400 dark:bg-emerald-500/10 dark:border-emerald-500/20',
  loss: 'bg-rose-500/10 text-rose-700 border-rose-500/20 dark:text-rose-400 dark:bg-rose-500/10 dark:border-rose-500/20',
  dividend: 'bg-amber-500/10 text-amber-700 border-amber-500/20 dark:text-amber-400 dark:bg-amber-500/10 dark:border-amber-500/20',
  neutral: 'bg-muted text-muted-foreground border-border',
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
