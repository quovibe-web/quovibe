import { useState, useCallback, type ReactNode } from 'react';
import { Outlet, NavLink, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '@/components/shared/PageHeader';
import { AnalyticsContext } from '@/context/analytics-context';
import { cn } from '@/lib/utils';

const TABS = [
  { path: '/analytics/calculation', labelKey: 'analytics.tabs.calculation' },
  { path: '/analytics/chart', labelKey: 'analytics.tabs.chart' },
  { path: '/analytics/income', labelKey: 'analytics.tabs.income' },
] as const;

export default function Analytics() {
  const { t } = useTranslation('performance');
  const location = useLocation();
  const [actions, setActionsState] = useState<ReactNode>(null);
  const [subtitle, setSubtitleState] = useState('');

  const setActions = useCallback((node: ReactNode) => setActionsState(node), []);
  const setSubtitle = useCallback((text: string) => setSubtitleState(text), []);

  // Preserve period params when switching tabs
  const periodSearch = location.search;

  return (
    <div className="qv-page space-y-6">
      <PageHeader
        title={t('analytics.title')}
        subtitle={subtitle || undefined}
        actions={actions}
      />

      {/* Tab strip */}
      <nav className="inline-flex rounded-full border border-border bg-muted/50 p-0.5">
        {TABS.map((tab) => (
          <NavLink
            key={tab.path}
            to={{ pathname: tab.path, search: periodSearch }}
            className={({ isActive }) =>
              cn(
                'px-4 py-1.5 text-xs font-medium rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none',
                isActive
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )
            }
          >
            {t(tab.labelKey)}
          </NavLink>
        ))}
      </nav>

      {/* Active tab content */}
      <AnalyticsContext.Provider value={{ setActions, setSubtitle }}>
        <Outlet />
      </AnalyticsContext.Provider>
    </div>
  );
}
