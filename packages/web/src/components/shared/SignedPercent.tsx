import { formatPercentage } from '@/lib/formatters';
import { usePrivacy } from '@/context/privacy-context';
import { cn } from '@/lib/utils';

interface Props {
  value: number | null;
  className?: string;
}

/**
 * Signed fractional return cell. Convention per design-system-v1 §1.4:
 *   - positive → `▲ +N%` in `--qv-positive`
 *   - negative → `▼ −N%` (U+2212) in `--qv-negative`
 *   - zero     → `– 0%` in muted text
 *   - null     → em-dash in muted text
 * Privacy-aware. Tabular-nums via `.qv-numeric`.
 */
export function SignedPercent({ value, className }: Props) {
  const { isPrivate } = usePrivacy();

  if (value == null) {
    return <span className={cn('text-muted-foreground', className)}>—</span>;
  }

  if (isPrivate) {
    return <span className={cn('qv-numeric font-medium', className)}>••••••</span>;
  }

  if (value === 0) {
    return (
      <span className={cn('qv-numeric font-medium text-muted-foreground', className)}>
        – {formatPercentage(0)}
      </span>
    );
  }

  const positive = value > 0;
  const glyph = positive ? '▲' : '▼';
  const sign = positive ? '+' : '−';
  const magnitude = formatPercentage(Math.abs(value));

  return (
    <span
      className={cn('qv-numeric font-medium', className)}
      style={{ color: positive ? 'var(--qv-positive)' : 'var(--qv-negative)' }}
    >
      {glyph} {sign}{magnitude}
    </span>
  );
}
