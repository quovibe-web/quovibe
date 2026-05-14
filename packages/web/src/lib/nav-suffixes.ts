import {
  LayoutDashboard,
  Landmark,
  TrendingUp,
  ArrowLeftRight,
  BarChart3,
  Layers,
  GitBranch,
  List,
  Settings,
  SlidersHorizontal,
  Upload,
} from 'lucide-react';

export type NavItem = {
  to: string;
  labelKey: string;
  icon: React.ElementType;
  end?: boolean;
};

export type NavSection = { sectionKey: string; items: NavItem[] };

// Single source of truth for the portfolio-scoped left-nav. Suffixes under
// /p/:portfolioId/*. `scopePath(pid, suffix)` turns them into absolute URLs
// at render time. Consumed by Sidebar (Desktop / Collapsed / Drawer) and
// CommandPalette so the two surfaces can't drift.
export const NAV_SUFFIXES: NavSection[] = [
  {
    sectionKey: 'sections.main',
    items: [
      { to: '', labelKey: 'items.dashboard', icon: LayoutDashboard, end: true },
      { to: 'watchlists', labelKey: 'items.watchlists', icon: List },
    ],
  },
  {
    sectionKey: 'sections.data',
    items: [
      { to: 'accounts', labelKey: 'items.accounts', icon: Landmark },
      { to: 'investments', labelKey: 'items.investments', icon: TrendingUp },
      { to: 'transactions', labelKey: 'items.transactions', icon: ArrowLeftRight },
      { to: 'import', labelKey: 'items.import', icon: Upload },
    ],
  },
  {
    sectionKey: 'sections.analysis',
    items: [
      { to: 'analytics', labelKey: 'items.analytics', icon: BarChart3, end: false },
    ],
  },
  {
    sectionKey: 'sections.taxonomies',
    items: [
      { to: 'allocation', labelKey: 'items.assetAllocation', icon: Layers },
      { to: 'taxonomies/data-series', labelKey: 'items.dataSeries', icon: GitBranch },
    ],
  },
  {
    sectionKey: 'sections.system',
    items: [
      { to: '/settings', labelKey: 'items.preferences', icon: SlidersHorizontal },
      { to: 'settings/data', labelKey: 'items.settings', icon: Settings },
    ],
  },
];

/** Mobile bottom-nav — consultation pages only. Suffixes; prefixed at render. */
export const MOBILE_NAV_SUFFIXES: NavItem[] = [
  { to: '', labelKey: 'items.dashboard', icon: LayoutDashboard, end: true },
  { to: 'investments', labelKey: 'items.investments', icon: TrendingUp },
  { to: 'transactions', labelKey: 'items.transactions', icon: ArrowLeftRight },
  { to: 'analytics', labelKey: 'items.analytics', icon: BarChart3 },
];

export function scopePath(portfolioId: string, suffix: string): string {
  if (suffix.startsWith('/')) return suffix;
  return suffix ? `/p/${portfolioId}/${suffix}` : `/p/${portfolioId}`;
}

export function scopeItems(portfolioId: string, items: NavItem[]): NavItem[] {
  return items.map(i => ({ ...i, to: scopePath(portfolioId, i.to) }));
}

export function scopeSections(portfolioId: string, sections: NavSection[]): NavSection[] {
  return sections.map(s => ({ ...s, items: scopeItems(portfolioId, s.items) }));
}
