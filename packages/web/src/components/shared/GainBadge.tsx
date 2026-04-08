import NumberFlow from '@number-flow/react';
import { usePrivacy } from '@/context/privacy-context';
import { cn } from '@/lib/utils';
import i18n from '@/i18n';

interface GainBadgeProps {
  /** Fractional value (e.g. 0.05 = 5%) */
  value: number;
  className?: string;
  /** Show sign display. Default: 'always' */
  signDisplay?: 'always' | 'auto' | 'never';
}

export function GainBadge({ value, className, signDisplay = 'always' }: GainBadgeProps) {
  const { isPrivate } = usePrivacy();
  const isPositive = value >= 0;

  if (isPrivate) {
    return (
      <span className={cn(
        'inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full bg-muted text-muted-foreground',
        className,
      )}>
        ----
      </span>
    );
  }

  return (
    <span className={cn(
      'inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full tabular-nums',
      isPositive
        ? 'bg-[var(--qv-positive)] text-[var(--qv-bg)]'
        : 'bg-[var(--qv-negative)] text-[var(--qv-bg)]',
      className,
    )}>
      <NumberFlow
        value={value}
        locales={i18n.language}
        format={{
          style: 'percent',
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
          signDisplay,
        }}
      />
    </span>
  );
}
