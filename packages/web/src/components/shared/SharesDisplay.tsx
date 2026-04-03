import { usePrivacy } from '@/context/privacy-context';
import { useDisplayPreferences } from '@/hooks/use-display-preferences';
import { formatShares } from '@/lib/formatters';
import { cn } from '@/lib/utils';

interface SharesDisplayProps {
  value: string | number | null | undefined;
  className?: string;
}

export function SharesDisplay({ value, className }: SharesDisplayProps) {
  const { isPrivate } = usePrivacy();
  const { sharesPrecision } = useDisplayPreferences();
  const num = typeof value === 'number' ? value : parseFloat(value ?? '0');
  if (!value || num === 0) return <span className={className}>—</span>;
  if (isPrivate) return <span className={className}>•••</span>;
  return <span className={cn('tabular-nums', className)}>{formatShares(num, { sharesPrecision })}</span>;
}
