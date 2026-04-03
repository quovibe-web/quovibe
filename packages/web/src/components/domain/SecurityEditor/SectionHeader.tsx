import { cn } from '@/lib/utils';
import type { CompletenessStatus } from '@/lib/security-completeness';

interface SectionHeaderProps {
  title: string;
  id: string;
  status?: CompletenessStatus;
  statusLabel?: string;
}

const STATUS_COLORS: Record<CompletenessStatus, string> = {
  'complete': 'bg-[var(--qv-success)]',
  'needs-attention': 'bg-[var(--qv-warning)]',
  'minimal': 'bg-transparent',
};

export function SectionHeader({ title, id, status, statusLabel }: SectionHeaderProps) {
  return (
    <div id={id} className="flex items-center gap-2 pt-5 pb-3 sticky top-0 bg-background z-10 border-b border-border">
      {status && status !== 'minimal' && (
        <span
          className={cn('h-2 w-2 rounded-full shrink-0', STATUS_COLORS[status])}
          aria-label={statusLabel}
        />
      )}
      <h3 className="text-sm font-semibold text-foreground tracking-tight">{title}</h3>
    </div>
  );
}
