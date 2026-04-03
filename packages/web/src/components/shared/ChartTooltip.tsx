import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface ChartTooltipProps {
  children: ReactNode;
  label?: string;
  className?: string;
}

export function ChartTooltip({ children, label, className }: ChartTooltipProps) {
  return (
    <div
      style={{ animation: 'qv-fade-in 0.15s ease-out' }}
      className={cn(
        'rounded-lg border border-[var(--qv-border-strong)]',
        'bg-[var(--qv-surface)]/90 backdrop-blur-md',
        'px-3 py-2.5 text-sm text-foreground',
        'shadow-lg shadow-black/8',
        className,
      )}
    >
      {label && (
        <div className="mb-1.5 text-xs font-medium text-muted-foreground">{label}</div>
      )}
      <div className="space-y-1 tabular-nums">{children}</div>
    </div>
  );
}

interface ChartTooltipRowProps {
  color: string;
  label: string;
  value: string;
  dashed?: boolean;
}

export function ChartTooltipRow({ color, label, value, dashed }: ChartTooltipRowProps) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2 min-w-0">
        {dashed ? (
          <span className="inline-block w-3 h-0 border-t-2 border-dashed flex-shrink-0" style={{ borderColor: color }} />
        ) : (
          <span className="inline-block w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
        )}
        <span className="text-xs text-muted-foreground truncate">{label}</span>
      </div>
      <span className="text-sm font-semibold tabular-nums whitespace-nowrap">{value}</span>
    </div>
  );
}
