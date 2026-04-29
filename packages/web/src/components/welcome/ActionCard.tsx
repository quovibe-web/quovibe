import type { ElementType } from 'react';
import { ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';

export type ActionCardAccent = 'primary' | 'teal' | 'orange';

export const ACCENT_VAR: Record<ActionCardAccent, string> = {
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
        'rounded-xl border bg-card px-5 py-5 text-left',
        !disabled && 'cursor-pointer',
        disabled && 'cursor-not-allowed opacity-60',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'absolute inset-y-0 left-0 w-1 origin-center',
          'scale-y-[0.3] group-hover:scale-y-100 group-focus-visible:scale-y-100',
          'transition-transform duration-300 ease-out',
        )}
        style={{ background: accentVar }}
      />
      <span
        aria-hidden
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg"
        style={{
          background: `color-mix(in srgb, ${accentVar} 14%, transparent)`,
          color: accentVar,
        }}
      >
        <Icon size={20} strokeWidth={1.75} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-lg leading-tight" style={{ fontFamily: 'var(--font-display)' }}>
            {title}
          </span>
          {badge && (
            <span
              className="rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider"
              style={{
                color: accentVar,
                background: `color-mix(in srgb, ${accentVar} 12%, transparent)`,
              }}
            >
              {badge}
            </span>
          )}
        </span>
        <span className="text-sm text-muted-foreground leading-snug">{description}</span>
        <span
          className={cn(
            'mt-2 inline-flex items-center gap-1.5 text-sm font-medium',
            'transition-colors',
          )}
          style={{ color: accentVar }}
        >
          {cta}
        </span>
      </span>
      <span
        aria-hidden
        className={cn(
          'flex h-9 w-9 shrink-0 items-center justify-center self-center rounded-full border',
          'transition-all duration-200 group-hover:translate-x-0.5',
          'group-hover:border-transparent',
        )}
        style={{
          borderColor: `color-mix(in srgb, ${accentVar} 40%, transparent)`,
          background: 'transparent',
        }}
      >
        <ArrowRight
          size={16}
          className="transition-colors"
          style={{ color: accentVar }}
        />
      </span>
    </button>
  );
}
