import { createContext, useContext, type ReactNode } from 'react';
import type { ForexView, ForexSurface } from '@quovibe/shared';
import { usePreferences, useUpdatePreferences } from '@/api/use-preferences';

// Defaults mirror forexViewSchema from @quovibe/shared (Task 19).
// securityDetail → 'native' per Phase 1 invariant; all others → 'base'.
const DEFAULTS: Required<ForexView> = {
  dashboard: 'base',
  investments: 'base',
  securityDrawer: 'base',
  securityDetail: 'native',
  statement: 'base',
};

interface ForexViewCtx {
  state: Partial<ForexView>;
  setView: (surface: ForexSurface, view: 'base' | 'native') => void;
}

const ForexViewContext = createContext<ForexViewCtx | null>(null);

export function ForexViewProvider({ children }: { children: ReactNode }) {
  const { data: preferences } = usePreferences();
  const updateMut = useUpdatePreferences();
  const state: Partial<ForexView> = preferences?.forexView ?? {};

  // Send only the forexView partial — PUT /api/settings/preferences accepts
  // a partial merge, so the entire preferences blob is not needed on the wire.
  const ctx: ForexViewCtx = {
    state,
    setView: (surface, view) => {
      updateMut.mutate({ forexView: { ...state, [surface]: view } });
    },
  };

  return (
    <ForexViewContext.Provider value={ctx}>{children}</ForexViewContext.Provider>
  );
}

export function useForexView(surface: ForexSurface) {
  const ctx = useContext(ForexViewContext);
  if (!ctx) throw new Error('useForexView requires ForexViewProvider');
  const view = (ctx.state[surface] as 'base' | 'native' | undefined) ?? DEFAULTS[surface];
  return {
    view,
    toggle: () => ctx.setView(surface, view === 'base' ? 'native' : 'base'),
  };
}
