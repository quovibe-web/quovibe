import type { ElementType } from 'react';
import { ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';

// `accent` maps each lobby card to a canonical Flexoki swatch:
//   primary → `--color-primary` (blue-600 light / blue-400 dark)
//   teal    → `--color-chart-2` (Flexoki cyan `#3AA99F`)
//   orange  → `--color-chart-3` (Flexoki orange `#DA702C`)
// Lobby is a sanctioned §1.3 exception: no charts/data viz competing for the
// color budget, three peer actions benefit from per-card wayfinding signal.
// Color encoding is paired with a Lucide glyph for redundant categorical
// signal (color-blind-safe). DO NOT extend this exception to Shell-wrapped
// pages — chart colors stay reserved for data viz everywhere else.
export type ActionCardAccent = 'primary' | 'teal' | 'orange';

const ACCENT_VAR: Record<ActionCardAccent, string> = {
  primary: 'var(--color-primary)',
  teal: 'var(--color-chart-2)',
  orange: 'var(--color-chart-3)',
};

export interface ActionCardProps {
  accent: ActionCardAccent;
  icon: ElementType;
  title: string;
  description: string;
  cta: string;
  badge?: string;
  disabled?: boolean;
  onClick: () => void;
}

export function ActionCard({
  accent,
  icon: Icon,
  title,
  description,
  cta,
  badge,
  disabled,
  onClick,
}: ActionCardProps) {
  const accentVar = ACCENT_VAR[accent];

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'qv-card-interactive group relative flex w-full items-start gap-4 overflow-hidden',
        'rounded-md border border-[var(--qv-border-subtle)] bg-card px-5 py-5 text-left',
        !disabled && 'cursor-pointer',
        disabled && 'cursor-not-allowed opacity-60',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'absolute inset-y-0 left-0 w-[2px] origin-center',
          'scale-y-[0.3] group-hover:scale-y-100 group-focus-visible:scale-y-100',
          'transition-transform duration-300 ease-out',
        )}
        style={{ backgroundColor: accentVar }}
      />
      <span
        aria-hidden
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-[var(--qv-surface-elevated)]"
        style={{ color: accentVar }}
      >
        <Icon size={20} strokeWidth={1.75} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="flex flex-wrap items-center gap-2">
          <span
            className="text-xl font-medium leading-tight text-[var(--qv-text-display)]"
            style={{
              fontFamily: 'var(--font-display)',
              fontVariationSettings: '"opsz" 72',
              letterSpacing: '-0.01em',
            }}
          >
            {title}
          </span>
          {badge && (
            <Badge variant="outline" className="qv-eyebrow rounded-sm px-2 py-0.5">
              {badge}
            </Badge>
          )}
        </span>
        <span className="text-sm leading-snug text-[var(--qv-text-secondary)]">
          {description}
        </span>
        <span
          className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium transition-colors"
          style={{ color: accentVar }}
        >
          {cta}
        </span>
      </span>
      <span
        aria-hidden
        className={cn(
          'flex h-9 w-9 shrink-0 items-center justify-center self-center rounded-sm border border-[var(--qv-border)] text-[var(--qv-text-secondary)]',
          'transition-all duration-200 group-hover:translate-x-0.5',
          'group-hover:[border-color:var(--accent-color)] group-hover:[color:var(--accent-color)]',
        )}
        style={{ ['--accent-color' as string]: accentVar }}
      >
        <ArrowRight size={16} />
      </span>
    </button>
  );
}
