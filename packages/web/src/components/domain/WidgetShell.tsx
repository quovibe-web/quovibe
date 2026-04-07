import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { GripHorizontal, MoreHorizontal, Clock, X } from 'lucide-react';
import { Card, CardHeader, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { WidgetDefBase } from '@quovibe/shared';
import type { SyntheticListenerMap } from '@dnd-kit/core/dist/hooks/utilities';
import { DataSeriesDialog } from './DataSeriesDialog';
import { PeriodOverrideDialog } from './PeriodOverrideDialog';
import { BenchmarkWidgetConfigDialog } from './BenchmarkWidgetConfigDialog';
import { WatchlistWidgetConfigDialog } from './WatchlistWidgetConfigDialog';
import { useWidgetConfig } from '@/context/widget-config-context';
import { useResolveSeriesLabel } from '@/api/use-performance';
import { useWidgetKpiMeta } from '@/hooks/use-widget-kpi-meta';
import { useDashboardConfig, useSaveDashboard } from '@/api/use-dashboard-config';
import { formatPeriodShortLabel } from '@/lib/period-utils';

interface WidgetShellProps {
  widgetId: string;
  dashboardId: string;
  widgetType: string;
  title: string;
  /** i18n key for the qualifier shown next to the title (e.g. 'widget.qualifier.cumulative') */
  qualifierKey?: string | null;
  capabilities: WidgetDefBase['capabilities'];
  onDelete: () => void;
  onTitleChange: (newTitle: string) => void;
  dragHandleListeners?: SyntheticListenerMap;
  dragHandleAttributes?: Record<string, unknown>;
  /** Index for stagger-in animation delay */
  index?: number;
  /** Optional toolbar rendered in the header row (e.g. chart type switcher) */
  toolbar?: React.ReactNode;
  children: React.ReactNode;
}

export function WidgetShell({
  widgetId,
  dashboardId,
  widgetType,
  title,
  qualifierKey,
  capabilities,
  onDelete,
  onTitleChange,
  dragHandleListeners,
  dragHandleAttributes,
  index = 0,
  toolbar,
  children,
}: WidgetShellProps) {
  const { t } = useTranslation('dashboard');
  const { t: tSettings } = useTranslation('settings');
  const [editing, setEditing] = useState(false);
  const [dataSeriesOpen, setDataSeriesOpen] = useState(false);
  const [periodDialogOpen, setPeriodDialogOpen] = useState(false);
  const [optionsDialogOpen, setOptionsDialogOpen] = useState(false);
  const { data: dashConfig } = useDashboardConfig();
  const saveDashboard = useSaveDashboard();
  const [editValue, setEditValue] = useState(title);
  const inputRef = useRef<HTMLInputElement>(null);

  // Resolve qualifier for LINE 1 (next to title)
  const { qualifier } = useWidgetKpiMeta(qualifierKey ?? null);

  // Resolve data series label for LINE 2
  const { dataSeries, periodOverride, setPeriodOverride, options, setOptions } = useWidgetConfig();
  const { data: resolvedSeries } = useResolveSeriesLabel(dataSeries);
  const dataSeriesLabel = dataSeries === null
    ? t('dataSeries.entirePortfolio')
    : dataSeries.type === 'portfolio'
      ? t('dataSeries.entirePortfolio')
      : resolvedSeries?.label ?? '…';

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  function clearPeriodOverride() {
    setPeriodOverride(null);
    if (!dashConfig) return;
    const updatedDashboards = dashConfig.dashboards.map((dash) => {
      if (dash.id !== dashboardId) return dash;
      return {
        ...dash,
        widgets: dash.widgets.map((w) => {
          if (w.id !== widgetId) return w;
          return { ...w, config: { ...w.config, periodOverride: null } };
        }),
      };
    });
    saveDashboard.mutate({
      dashboards: updatedDashboards,
      activeDashboard: dashConfig.activeDashboard,
    });
  }

  function commitEdit() {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== title) {
      onTitleChange(trimmed);
    } else {
      setEditValue(title);
    }
    setEditing(false);
  }

  return (
    <>
      <Card
        className="group relative h-full flex flex-col bg-card border border-border rounded-lg transition-colors duration-200"
        style={{ animation: 'qv-stagger-in 0.5s ease-out both', animationDelay: `${index * 60}ms` }}
      >
        {/* LINE 1 — Widget type label + drag handle + kebab menu */}
        <CardHeader className="flex flex-row items-center gap-2 space-y-0 pb-0 pt-2.5 px-4">
          <div
            className="cursor-grab active:cursor-grabbing touch-none"
            {...dragHandleListeners}
            {...dragHandleAttributes}
          >
            <GripHorizontal className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity duration-150" />
          </div>
          {editing ? (
            <Input
              ref={inputRef}
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={commitEdit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitEdit();
                if (e.key === 'Escape') {
                  setEditValue(title);
                  setEditing(false);
                }
              }}
              className="h-5 text-sm font-medium px-1"
            />
          ) : (
            <>
              <span
                className="text-sm text-muted-foreground font-medium cursor-pointer hover:text-foreground transition-colors"
                onClick={() => {
                  setEditValue(title);
                  setEditing(true);
                }}
              >
                {title}
              </span>
              {/* qualifier removed — title abbreviation (cum./ann.) already conveys the info */}
            </>
          )}
          {/* Data series label — inline with title */}
          {dataSeriesLabel && (
            <span className="text-sm text-primary truncate">{dataSeriesLabel}</span>
          )}
          {periodOverride && (
            <span
              className="inline-flex items-center gap-1 bg-primary/10 text-primary border border-primary/20 rounded-full px-2 py-0.5 text-xs cursor-pointer hover:bg-primary/20 transition-colors shrink-0"
              onClick={() => setPeriodDialogOpen(true)}
            >
              <Clock className="h-3 w-3" />
              {formatPeriodShortLabel(periodOverride.definition, tSettings)}
              <button
                className="hover:text-destructive ml-0.5"
                aria-label={t('periodOverride.clear')}
                onClick={(e) => {
                  e.stopPropagation();
                  clearPeriodOverride();
                }}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          )}
          {/* Optional toolbar slot */}
          {toolbar}
          {/* Spacer pushes kebab to the right */}
          <div className="flex-1" />
          {/* Kebab menu — always visible */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0 bg-muted/50 border border-border/50 rounded-md"
                aria-label={t('widgetActions')}
              >
                <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {capabilities.hasDataSeries && (
                <DropdownMenuItem onSelect={() => setDataSeriesOpen(true)}>
                  {t('dataSeriesMenuItem')}
                </DropdownMenuItem>
              )}
              {capabilities.hasPeriodOverride && (
                <DropdownMenuItem onSelect={() => setPeriodDialogOpen(true)}>
                  {t('period')}
                </DropdownMenuItem>
              )}
              {capabilities.hasCustomOptions && (
                <DropdownMenuItem onSelect={() => setOptionsDialogOpen(true)}>
                  {t('widget.configure')}
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={onDelete}>
                {t('deleteWidget')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </CardHeader>
        {/* LINE 2 removed — data series label merged into LINE 1 */}
        <CardContent className="flex-1 pt-0">
          {children}
        </CardContent>
      </Card>
      <DataSeriesDialog
        widgetId={widgetId}
        dashboardId={dashboardId}
        open={dataSeriesOpen}
        onClose={() => setDataSeriesOpen(false)}
      />
      <PeriodOverrideDialog
        widgetId={widgetId}
        dashboardId={dashboardId}
        open={periodDialogOpen}
        onClose={() => setPeriodDialogOpen(false)}
      />
      {widgetType === 'watchlist' ? (
        <WatchlistWidgetConfigDialog
          open={optionsDialogOpen}
          onClose={() => setOptionsDialogOpen(false)}
          currentWatchlistId={options.watchlistId as number | undefined}
          onSelect={(watchlistId) => {
            const newOptions = { ...options, watchlistId };
            setOptions(newOptions);
            if (!dashConfig) return;
            const updatedDashboards = dashConfig.dashboards.map((dash) => {
              if (dash.id !== dashboardId) return dash;
              return {
                ...dash,
                widgets: dash.widgets.map((w) => {
                  if (w.id !== widgetId) return w;
                  return { ...w, config: { ...w.config, options: newOptions } };
                }),
              };
            });
            saveDashboard.mutate({
              dashboards: updatedDashboards,
              activeDashboard: dashConfig.activeDashboard,
            });
          }}
        />
      ) : (
        <BenchmarkWidgetConfigDialog
          open={optionsDialogOpen}
          onClose={() => setOptionsDialogOpen(false)}
          currentSecurityId={options.benchmarkSecurityId as string | undefined}
          onSelect={(securityId) => {
            const newOptions = { ...options, benchmarkSecurityId: securityId };
            setOptions(newOptions);
            if (!dashConfig) return;
            const updatedDashboards = dashConfig.dashboards.map((dash) => {
              if (dash.id !== dashboardId) return dash;
              return {
                ...dash,
                widgets: dash.widgets.map((w) => {
                  if (w.id !== widgetId) return w;
                  return { ...w, config: { ...w.config, options: newOptions } };
                }),
              };
            });
            saveDashboard.mutate({
              dashboards: updatedDashboards,
              activeDashboard: dashConfig.activeDashboard,
            });
          }}
        />
      )}
    </>
  );
}
