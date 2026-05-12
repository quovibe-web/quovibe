import { useState, useCallback, type ReactNode } from 'react';
import { Outlet, NavLink, useLocation, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { PageHeader } from '@/components/shared/PageHeader';
import { AnalyticsContext } from '@/context/analytics-context';
import { cn } from '@/lib/utils';

const TABS = [
  { path: 'calculation', labelKey: 'analytics.tabs.calculation' },
  { path: 'chart', labelKey: 'analytics.tabs.chart' },
  { path: 'income', labelKey: 'analytics.tabs.income' },
] as const;

export default function Analytics() {
  const { t } = useTranslation('performance');
  const location = useLocation();
  const { portfolioId } = useParams<{ portfolioId: string }>();
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
      <nav className="flex items-center gap-1 border-b border-[var(--qv-border-subtle)]">
        {TABS.map((tab) => (
          <NavLink
            key={tab.path}
            to={{ pathname: `/p/${portfolioId}/analytics/${tab.path}`, search: periodSearch }}
            end={false}
            className={({ isActive }) =>
              cn(
                'relative px-3 py-2 text-sm font-medium transition-colors whitespace-nowrap focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none focus-visible:rounded-sm',
                isActive
                  ? 'text-[var(--qv-text-display)]'
                  : 'text-muted-foreground hover:text-foreground',
              )
            }
          >
            {({ isActive }) => (
              <>
                <span className="relative z-10">{t(tab.labelKey)}</span>
                {isActive && (
                  <motion.div
                    layoutId="analytics-tab-indicator"
                    className="absolute left-2 right-2 -bottom-px h-[2px] bg-[var(--color-primary)]"
                    transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
                  />
                )}
              </>
            )}
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
