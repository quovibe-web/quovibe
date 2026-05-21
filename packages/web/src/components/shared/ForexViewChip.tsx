import { cn } from '@/lib/utils';
import { useForexView } from '@/context/forex-view-context';
import type { ForexSurface, ForexView } from '@quovibe/shared';

// ---------------------------------------------------------------------------
// Pure helper exports — testable in node env (no React dependency)
// ---------------------------------------------------------------------------

// Defaults mirror forexViewSchema from @quovibe/shared (Task 19).
// securityDetail → 'native' per Phase 1 invariant; all others → 'base'.
const DEFAULTS: Required<ForexView> = {
  dashboard: 'base',
  investments: 'base',
  securityDrawer: 'base',
  securityDetail: 'native',
  statement: 'base',
};

export function resolveForexView(
  state: Partial<ForexView>,
  surface: ForexSurface,
): 'base' | 'native' {
  return (state[surface] as 'base' | 'native' | undefined) ?? DEFAULTS[surface];
}

export function getDefaultsForSurface(surface: ForexSurface): 'base' | 'native' {
  return DEFAULTS[surface];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface Props {
  surface: ForexSurface;
  /** Portfolio base currency code, e.g. 'EUR'. */
  baseCurrency: string;
  /** Currency codes of all foreign-currency holdings visible on this surface. */
  nativeCurrencies: string[];
}

/**
 * Two-state segmented toggle: base currency ↔ native currency per surface.
 * Returns null when the portfolio has no foreign-currency holdings —
 * nothing to toggle.
 */
export function ForexViewChip({
  surface,
  baseCurrency,
  nativeCurrencies,
}: Props) {
  const { view, toggle } = useForexView(surface);

  const distinctForeign = Array.from(new Set(nativeCurrencies)).filter(
    (c) => c && c !== baseCurrency,
  );

  if (distinctForeign.length === 0) return null;

  const nativeLabel =
    distinctForeign.length === 1 ? distinctForeign[0] : 'NATIVE';

  return (
    <div
      role="group"
      aria-label="Currency display mode"
      className="inline-flex items-center rounded-md border border-input bg-background text-xs font-medium shadow-xs overflow-hidden"
    >
      <button
        type="button"
        aria-pressed={view === 'base'}
        aria-label={`Show in ${baseCurrency}`}
        onClick={() => view !== 'base' && toggle()}
        className={cn(
          'h-7 px-2.5 transition-colors cursor-pointer',
          view === 'base'
            ? 'bg-primary text-primary-foreground'
            : 'text-muted-foreground hover:bg-accent hover:text-foreground',
        )}
      >
        {baseCurrency}
      </button>
      <button
        type="button"
        aria-pressed={view === 'native'}
        aria-label={`Show in ${nativeLabel}`}
        onClick={() => view !== 'native' && toggle()}
        className={cn(
          'h-7 px-2.5 transition-colors cursor-pointer',
          view === 'native'
            ? 'bg-primary text-primary-foreground'
            : 'text-muted-foreground hover:bg-accent hover:text-foreground',
        )}
      >
        {nativeLabel}
      </button>
    </div>
  );
}
