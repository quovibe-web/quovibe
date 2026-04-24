import { useState, useRef, useEffect, createContext, useContext } from 'react';
import { cn } from '@/lib/utils';
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
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Check } from 'lucide-react';
import type { WidgetDefBase } from '@quovibe/shared';
import type { SyntheticListenerMap } from '@dnd-kit/core/dist/hooks/utilities';
import { DataSeriesDialog } from './DataSeriesDialog';
import { PeriodOverrideDialog } from './PeriodOverrideDialog';
import { BenchmarkWidgetConfigDialog } from './BenchmarkWidgetConfigDialog';
import { WatchlistWidgetConfigDialog } from './WatchlistWidgetConfigDialog';
import { useWidgetConfig } from '@/context/widget-config-context';
import { useResolveSeriesLabel } from '@/api/use-performance';
import { useWidgetKpiMeta } from '@/hooks/use-widget-kpi-meta';
import { useDashboard, useUpdateDashboard, type DashboardItem } from '@/api/use-dashboards';
import { formatPeriodShortLabel } from '@/lib/period-utils';

/* ── Toolbar portal context ──────────────────────────────────────── */

interface WidgetShellContextValue {
  toolbarTarget: HTMLElement | null;
}

const WidgetShellContext = createContext<WidgetShellContextValue>({ toolbarTarget: null });

/** Hook for child widgets to portal toolbar content into the WidgetShell header. */
export function useWidgetToolbarPortal(): HTMLElement | null {
  return useContext(WidgetShellContext).toolbarTarget;
}

/* ── Component ───────────────────────────────────────────────────── */

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
  onSpanChange?: (span: 1 | 2 | 3) => void;
  currentSpan?: 1 | 2 | 3;
  maxSpan?: 2 | 3;
  dragHandleListeners?: SyntheticListenerMap;
  dragHandleAttributes?: Record<string, unknown>;
  /** Index for stagger-in animation delay */
  index?: number;
  /** Compact mode for detail zone — reduced padding and text */
  compact?: boolean;
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
  onSpanChange,
  currentSpan = 1,
  maxSpan = 3,
  dragHandleListeners,
  dragHandleAttributes,
  index = 0,
  compact = false,
  children,
}: WidgetShellProps) {
  const { t } = useTranslation('dashboard');
  const { t: tSettings } = useTranslation('settings');
  const [editing, setEditing] = useState(false);
  const [dataSeriesOpen, setDataSeriesOpen] = useState(false);
  const [periodDialogOpen, setPeriodDialogOpen] = useState(false);
  const [optionsDialogOpen, setOptionsDialogOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const { data: dashboard } = useDashboard(dashboardId);
  const updateDashboard = useUpdateDashboard();

  /** Patch this widget's config on the current dashboard. */
  function patchWidgetConfig(configUpdater: (cfg: Record<string, unknown>) => Record<string, unknown>) {
    if (!dashboard) return;
    const widgets = (dashboard.widgets as DashboardItem['widgets']).map((raw) => {
      const w = raw as { id: string; config?: Record<string, unknown> };
      if (w.id !== widgetId) return raw;
      return { ...w, config: configUpdater(w.config ?? {}) };
    });
    updateDashboard.mutate({ id: dashboardId, input: { widgets } });
  }
  const [editValue, setEditValue] = useState(title);
  const inputRef = useRef<HTMLInputElement>(null);
  const [toolbarEl, setToolbarEl] = useState<HTMLElement | null>(null);

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
    patchWidgetConfig((cfg) => ({ ...cfg, periodOverride: null }));
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
        className={cn(
          'group relative h-full flex flex-col bg-card border border-border rounded-lg transition-colors duration-200 overflow-hidden',
          compact && 'qv-compact-widget',
        )}
        style={{ animation: 'qv-stagger-in 0.4s ease-out both', animationDelay: `${index * 50}ms` }}
      >
        {/* Header — title row + data series row */}
        <CardHeader className={cn(
          'flex flex-row items-start gap-2 space-y-0 pb-0',
          compact ? 'pt-2.5 px-4 md:pt-2 md:px-3' : 'pt-2.5 px-4',
        )}>
          {/* Drag handle */}
          <div
            className="cursor-grab active:cursor-grabbing touch-none pt-0.5 shrink-0"
            {...dragHandleListeners}
            {...dragHandleAttributes}
          >
            <GripHorizontal className={cn(
              'text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity duration-150',
              compact ? 'h-3 w-3' : 'h-4 w-4',
            )} />
          </div>

          {/* Left block — title on line 1, data series + period pill on line 2 */}
          <div className="flex-1 min-w-0 flex flex-col gap-0.5">
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
              <span
                className="text-sm text-muted-foreground font-medium cursor-pointer hover:text-foreground transition-colors leading-tight"
                onClick={() => {
                  setEditValue(title);
                  setEditing(true);
                }}
              >
                {title}
              </span>
            )}
            {/* Data series label + period pill — second line */}
            {(dataSeriesLabel || periodOverride) && (
              <div className="flex items-center gap-1.5 flex-wrap">
                {dataSeriesLabel && (
                  <span className="text-xs text-primary leading-tight">{dataSeriesLabel}</span>
                )}
                {periodOverride && (
                  <span
                    className="inline-flex items-center gap-1 bg-primary/10 text-primary border border-primary/20 rounded-full px-2 py-0.5 text-xs cursor-pointer hover:bg-primary/20 transition-colors"
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
              </div>
            )}
          </div>

          {/* Right block — toolbar portal + kebab, pinned to top-right */}
          <div className="flex items-center gap-1 shrink-0">
            {/* Toolbar portal target — chart widgets render their controls here via createPortal */}
            <div ref={setToolbarEl} className="flex items-center gap-4" />
            {/* Kebab menu */}
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
                {onSpanChange && (
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>{t('widgetSize')}</DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                      {([1, 2, 3] as const).map((s) => (
                        <DropdownMenuItem
                          key={s}
                          onSelect={() => onSpanChange(s)}
                          disabled={s > maxSpan}
                          className="flex items-center gap-2"
                        >
                          <Check className={cn('h-3.5 w-3.5', currentSpan === s ? 'opacity-100' : 'opacity-0')} />
                          {t(s === 1 ? 'widgetSizeSmall' : s === 2 ? 'widgetSizeMedium' : 'widgetSizeLarge')}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={() => setDeleteConfirmOpen(true)}>
                  {t('deleteWidget')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </CardHeader>
        <CardContent className={cn('flex-1 flex flex-col', compact ? 'pt-0 px-4 pb-[13px] md:px-3 md:pb-[9px]' : 'pt-0')}>
          <WidgetShellContext.Provider value={{ toolbarTarget: toolbarEl }}>
            {children}
          </WidgetShellContext.Provider>
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
            patchWidgetConfig((cfg) => ({ ...cfg, options: newOptions }));
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
            patchWidgetConfig((cfg) => ({ ...cfg, options: newOptions }));
          }}
        />
      )}
      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>{t('deleteWidgetConfirm')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('deleteWidgetConfirmDesc', { name: title })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('cancel', { ns: 'common' })}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={onDelete}>
              {t('deleteWidget')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
