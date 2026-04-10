import { useState, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  rectSortingStrategy,
  horizontalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { restrictToHorizontalAxis } from '@dnd-kit/modifiers';
import { motion } from 'framer-motion';
import { Plus, GripVertical, MoreHorizontal, Columns3 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
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
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { useDashboardConfig, useSaveDashboard } from '@/api/use-dashboard-config';
import { nanoid } from 'nanoid';
import { getWidgetDef, CHART_WIDGET_TYPES } from '@/lib/widget-registry';
import { DASHBOARD_TEMPLATES, applyTemplate, type DashboardTemplate } from '@/lib/dashboard-templates';
import { useAccounts } from '@/api/use-accounts';
import { useTaxonomies } from '@/api/use-taxonomies';
import { useSecurities } from '@/api/use-securities';
import { WidgetShell } from '@/components/domain/WidgetShell';
import { WidgetCatalogDialog } from '@/components/domain/WidgetCatalogDialog';
import { WidgetConfigProvider } from '@/context/widget-config-context';
import type { Dashboard, DashboardWidget } from '@quovibe/shared';
import { DashboardHero } from '@/components/domain/DashboardHero';
import { DashboardMetricsStrip } from '@/components/domain/DashboardMetricsStrip';

// ---------------------------------------------------------------------------
// SortableWidget — wraps WidgetShell with dnd-kit sortable
// ---------------------------------------------------------------------------

interface SortableWidgetProps {
  widget: DashboardWidget;
  dashboardId: string;
  index: number;
  onDelete: (widgetId: string) => void;
  onTitleChange: (widgetId: string, title: string) => void;
  onSpanChange: (widgetId: string, span: 1 | 2 | 3) => void;
  columns: 'auto' | 2 | 3 | 4 | 5;
  compact?: boolean;
}

function SortableWidget({ widget, dashboardId, index, onDelete, onTitleChange, onSpanChange, columns, compact = false }: SortableWidgetProps) {
  const { t } = useTranslation('dashboard');
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: widget.id });

  const effectiveSpan = columns === 'auto' ? widget.span : Math.min(widget.span, columns) as 1 | 2 | 3;

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition: isDragging ? transition : undefined,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : undefined,
    gridColumn: `span ${effectiveSpan}`,
  };

  const def = getWidgetDef(widget.type);
  if (!def) {
    return (
      <div ref={setNodeRef} style={style}>
        <WidgetConfigProvider initialConfig={widget.config}>
          <WidgetShell
            widgetId={widget.id}
            dashboardId={dashboardId}
            widgetType={widget.type}
            title={`Unknown: ${widget.type}`}
            capabilities={{ hasDataSeries: false, hasPeriodOverride: false, hasCustomOptions: false }}
            onDelete={() => onDelete(widget.id)}
            onTitleChange={(newTitle) => onTitleChange(widget.id, newTitle)}
            onSpanChange={(span) => onSpanChange(widget.id, span)}
            currentSpan={effectiveSpan}
            maxSpan={columns === 'auto' ? 3 : columns as number > 3 ? 3 : columns as 2 | 3}
            dragHandleListeners={listeners}
            dragHandleAttributes={attributes}
            index={index}
            compact={compact}
          >
            <div className="flex items-center justify-center h-full min-h-[120px] text-sm text-muted-foreground">
              {t('unknownWidget', { type: widget.type })}
            </div>
          </WidgetShell>
        </WidgetConfigProvider>
      </div>
    );
  }

  const title = widget.title ?? t(def.i18nKey);
  const WidgetComponent = def.component;

  return (
    <div ref={setNodeRef} style={style}>
      <WidgetConfigProvider initialConfig={widget.config}>
        <WidgetShell
          widgetId={widget.id}
          dashboardId={dashboardId}
          widgetType={widget.type}
          title={title}
          qualifierKey={def.qualifierKey}
          capabilities={def.capabilities}
          onDelete={() => onDelete(widget.id)}
          onTitleChange={(newTitle) => onTitleChange(widget.id, newTitle)}
          onSpanChange={(span) => onSpanChange(widget.id, span)}
          currentSpan={effectiveSpan}
          maxSpan={columns === 'auto' ? 3 : Math.min(columns, 3) as 2 | 3}
          dragHandleListeners={listeners}
          dragHandleAttributes={attributes}
          index={index}
          compact={compact}
        >
          <Suspense
            fallback={
              <div className="flex items-center justify-center h-full min-h-[120px]">
                <Skeleton className="h-8 w-24" />
              </div>
            }
          >
            <WidgetComponent />
          </Suspense>
        </WidgetShell>
      </WidgetConfigProvider>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SortableTab — wraps a dashboard tab with dnd-kit sortable (handle on grip)
// ---------------------------------------------------------------------------

interface SortableTabProps {
  dashboard: Dashboard;
  isActive: boolean;
  sortable: boolean;
  isRenaming: boolean;
  renameValue: string;
  onRenameChange: (v: string) => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
  onSwitchTab: () => void;
  onStartRename: () => void;
  onDuplicate: () => void;
  onDelete: (() => void) | null;
  hasOverriddenWidgets: boolean;
  onResetWidgets: () => void;
}

function SortableTab({
  dashboard,
  isActive,
  sortable,
  isRenaming,
  renameValue,
  onRenameChange,
  onCommitRename,
  onCancelRename,
  onSwitchTab,
  onStartRename,
  onDuplicate,
  onDelete,
  hasOverriddenWidgets,
  onResetWidgets,
}: SortableTabProps) {
  const { t } = useTranslation('dashboard');
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: dashboard.id, disabled: !sortable });
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition: isDragging ? transition : undefined,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <>
      <div ref={setNodeRef} style={style} className="group flex items-center shrink-0">
        {sortable && (
          <span
            className={cn(
              'cursor-grab text-muted-foreground transition-opacity duration-150',
              isDragging ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
            )}
            {...attributes}
            {...listeners}
          >
            <GripVertical className="h-3.5 w-3.5" />
          </span>
        )}
        {isRenaming ? (
          <Input
            autoFocus
            value={renameValue}
            onChange={(e) => onRenameChange(e.target.value)}
            onBlur={onCommitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onCommitRename();
              if (e.key === 'Escape') onCancelRename();
            }}
            className="h-8 w-32 text-sm"
          />
        ) : (
          <button
            className={cn(
              'relative px-3 py-2 md:py-1.5 text-sm font-medium rounded-full transition-colors whitespace-nowrap focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none',
              !isActive && 'text-muted-foreground hover:text-foreground hover:bg-muted',
            )}
            onClick={onSwitchTab}
          >
            {isActive && (
              <motion.div
                layoutId="dashboard-tab-indicator"
                className="absolute inset-0 rounded-full bg-primary"
                transition={{ type: 'spring', stiffness: 500, damping: 35 }}
              />
            )}
            <span className={cn('relative z-10', isActive ? 'text-primary-foreground' : '')}>
              {dashboard.name}
            </span>
          </button>
        )}
        {/* Kebab menu — visible on active, hover-reveal on inactive */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                'h-6 w-6 shrink-0 ml-0.5 transition-opacity duration-150',
                isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
              )}
              aria-label={t('tabActions')}
            >
              <MoreHorizontal className="h-3.5 w-3.5 text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onSelect={onStartRename}>
              {t('renameDashboard')}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onDuplicate}>
              {t('duplicateDashboard')}
            </DropdownMenuItem>
            {hasOverriddenWidgets && (
              <DropdownMenuItem onSelect={onResetWidgets}>
                {t('resetWidgetsToGlobal')}
              </DropdownMenuItem>
            )}
            {onDelete && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={() => setDeleteConfirmOpen(true)}>
                  {t('deleteDashboard')}
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {/* Delete confirmation dialog */}
      {onDelete && (
        <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
          <AlertDialogContent size="sm">
            <AlertDialogHeader>
              <AlertDialogTitle>{t('deleteDashboardConfirm')}</AlertDialogTitle>
              <AlertDialogDescription>
                {t('deleteDashboardConfirmDesc', { name: dashboard.name })}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t('cancel', { ns: 'common' })}</AlertDialogCancel>
              <AlertDialogAction variant="destructive" onClick={onDelete}>
                {t('deleteDashboard')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Dashboard page
// ---------------------------------------------------------------------------

export default function Dashboard() {
  const { t } = useTranslation('dashboard');
  const { data, isLoading } = useDashboardConfig();
  const { mutate: save } = useSaveDashboard();

  // Prefetch data for DataSeriesDialog (populate cache at mount)
  useAccounts(false);
  useTaxonomies();
  useSecurities(false);

  const [newDashOpen, setNewDashOpen] = useState(false);
  const [newDashName, setNewDashName] = useState('');
  const [renamingTabId, setRenamingTabId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);

  const widgetSensors = useSensors(useSensor(PointerSensor));
  const tabSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const dashboards = data?.dashboards ?? [];
  const activeDashboard = data?.activeDashboard ?? null;
  const activeDash = dashboards.find((d) => d.id === activeDashboard) ?? dashboards[0] ?? null;

  // ---- Helpers to save mutated dashboards ----

  function saveDashboards(next: Dashboard[], nextActiveId?: string) {
    save({
      dashboards: next,
      activeDashboard: nextActiveId ?? activeDashboard,
    });
  }

  function updateActiveDashboard(updater: (d: Dashboard) => Dashboard) {
    if (!activeDash) return;
    const next = dashboards.map((d) => (d.id === activeDash.id ? updater(d) : d));
    saveDashboards(next);
  }

  function updateMetricsStripIds(ids: string[]) {
    updateActiveDashboard((d) => ({ ...d, metricsStripIds: ids }));
  }

  // ---- Tab actions ----

  function switchTab(id: string) {
    save({ dashboards, activeDashboard: id });
  }

  function createDashboard() {
    const name = newDashName.trim();
    if (!name) return;
    const id = crypto.randomUUID();
    const template = selectedTemplate
      ? DASHBOARD_TEMPLATES.find((t) => t.id === selectedTemplate)
      : null;
    const widgets = template ? applyTemplate(template) : [];
    const newDash: Dashboard = { id, name, widgets };
    saveDashboards([...dashboards, newDash], id);
    setNewDashOpen(false);
    setNewDashName('');
    setSelectedTemplate(null);
  }

  function duplicateDashboard(src: Dashboard) {
    const id = crypto.randomUUID();
    const dup: Dashboard = {
      id,
      name: `${src.name} (copy)`,
      widgets: src.widgets.map((w) => ({ ...w, id: crypto.randomUUID() })),
    };
    saveDashboards([...dashboards, dup], id);
  }

  function deleteDashboard(id: string) {
    if (dashboards.length <= 1) return;
    const next = dashboards.filter((d) => d.id !== id);
    const nextActive = activeDashboard === id ? next[0].id : activeDashboard;
    saveDashboards(next, nextActive);
  }

  function commitRename(id: string) {
    const trimmed = renameValue.trim();
    if (trimmed) {
      const next = dashboards.map((d) => (d.id === id ? { ...d, name: trimmed } : d));
      saveDashboards(next);
    }
    setRenamingTabId(null);
  }

  function handleTabDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIdx = dashboards.findIndex((d) => d.id === active.id);
    const newIdx = dashboards.findIndex((d) => d.id === over.id);
    if (oldIdx === -1 || newIdx === -1) return;
    const reordered = arrayMove(dashboards, oldIdx, newIdx);
    saveDashboards(reordered);
  }

  // ---- Widget actions ----

  function deleteWidget(widgetId: string) {
    updateActiveDashboard((d) => ({
      ...d,
      widgets: d.widgets.filter((w) => w.id !== widgetId),
    }));
  }

  function changeWidgetTitle(widgetId: string, title: string) {
    updateActiveDashboard((d) => ({
      ...d,
      widgets: d.widgets.map((w) => (w.id === widgetId ? { ...w, title } : w)),
    }));
  }

  function changeWidgetSpan(widgetId: string, span: 1 | 2 | 3) {
    updateActiveDashboard((d) => ({
      ...d,
      widgets: d.widgets.map((w) => (w.id === widgetId ? { ...w, span } : w)),
    }));
  }

  function changeColumns(value: 'auto' | 2 | 3 | 4 | 5) {
    updateActiveDashboard((d) => ({ ...d, columns: value }));
  }

  function resetAllWidgetPeriods() {
    updateActiveDashboard((d) => ({
      ...d,
      widgets: d.widgets.map((w) => ({
        ...w,
        config: { ...w.config, periodOverride: null },
      })),
    }));
  }

  function applyTemplateToCurrent(template: DashboardTemplate) {
    updateActiveDashboard((d) => ({
      ...d,
      widgets: applyTemplate(template),
    }));
  }

  function addWidget(type: string) {
    const def = getWidgetDef(type);
    if (!def) return;
    updateActiveDashboard((d) => ({
      ...d,
      widgets: [
        ...d.widgets,
        {
          id: nanoid(),
          type,
          title: null,
          span: def.defaultSpan,
          config: structuredClone(def.defaultConfig),
        },
      ],
    }));
    setCatalogOpen(false);
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    updateActiveDashboard((d) => {
      const oldIdx = d.widgets.findIndex((w) => w.id === active.id);
      const newIdx = d.widgets.findIndex((w) => w.id === over.id);
      if (oldIdx === -1 || newIdx === -1) return d;
      // Only allow reorder within the same zone
      const activeIsChart = CHART_WIDGET_TYPES.has(d.widgets[oldIdx].type);
      const overIsChart = CHART_WIDGET_TYPES.has(d.widgets[newIdx].type);
      if (activeIsChart !== overIsChart) return d;
      return { ...d, widgets: arrayMove(d.widgets, oldIdx, newIdx) };
    });
  }

  const canSort = dashboards.length > 1;
  const chartWidgets = activeDash?.widgets.filter((w) => CHART_WIDGET_TYPES.has(w.type)) ?? [];
  const detailWidgets = activeDash?.widgets.filter((w) => !CHART_WIDGET_TYPES.has(w.type)) ?? [];
  const chartIds = chartWidgets.map((w) => w.id);
  const detailIds = detailWidgets.map((w) => w.id);

  function renderTabList() {
    if (!activeDash) return null;
    const hasOverrides = activeDash.widgets.some((w) => w.config.periodOverride != null);
    return dashboards.map((d) => (
      <SortableTab
        key={d.id}
        dashboard={d}
        isActive={d.id === activeDash.id}
        sortable={canSort}
        isRenaming={renamingTabId === d.id}
        renameValue={renameValue}
        onRenameChange={setRenameValue}
        onCommitRename={() => commitRename(d.id)}
        onCancelRename={() => setRenamingTabId(null)}
        onSwitchTab={() => switchTab(d.id)}
        onStartRename={() => {
          setRenameValue(d.name);
          setRenamingTabId(d.id);
        }}
        onDuplicate={() => duplicateDashboard(d)}
        onDelete={canSort ? () => deleteDashboard(d.id) : null}
        hasOverriddenWidgets={d.id === activeDash.id && hasOverrides}
        onResetWidgets={resetAllWidgetPeriods}
      />
    ));
  }

  function renderTabs() {
    if (!canSort) return renderTabList();
    return (
      <DndContext
        sensors={tabSensors}
        collisionDetection={closestCenter}
        modifiers={[restrictToHorizontalAxis]}
        onDragEnd={handleTabDragEnd}
      >
        <SortableContext
          items={dashboards.map((d) => d.id)}
          strategy={horizontalListSortingStrategy}
        >
          {renderTabList()}
        </SortableContext>
      </DndContext>
    );
  }

  return (
    <div className="qv-page space-y-6">
      {(isLoading || !data || !activeDash) ? (
        <div className="space-y-6">
          <Skeleton className="h-8 w-48" />
          <div
            className="grid gap-4"
            style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(320px, 100%), 1fr))' }}
          >
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-[180px] rounded-lg" />
            ))}
          </div>
        </div>
      ) : (
      <>
      {/* ── Tab bar ── */}
      <div className="flex items-center gap-1 border-b border-border pb-2 overflow-x-auto scrollbar-hide">
        {renderTabs()}

        {/* Spacer pushes action buttons to the right */}
        <div className="flex-1" />

        <div className="flex items-center gap-1 shrink-0">
          {/* Column count selector */}
          <Select
            value={String(activeDash.columns ?? 'auto')}
            onValueChange={(v) => changeColumns(v === 'auto' ? 'auto' : Number(v) as 2 | 3 | 4 | 5)}
          >
            <SelectTrigger className="h-7 w-auto gap-1 px-2 text-xs text-muted-foreground border-0 shadow-none bg-transparent hover:bg-accent hover:text-accent-foreground">
              <Columns3 className="h-3.5 w-3.5" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              <SelectItem value="auto">{t('gridColumnsAuto')}</SelectItem>
              <SelectItem value="2">2</SelectItem>
              <SelectItem value="3">3</SelectItem>
              <SelectItem value="4">4</SelectItem>
              <SelectItem value="5">5</SelectItem>
            </SelectContent>
          </Select>

          <span className="text-border">|</span>

          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs text-muted-foreground"
            onClick={() => setCatalogOpen(true)}
          >
            <Plus className="h-3.5 w-3.5 mr-1" />
            {t('addWidget')}
          </Button>

          <span className="text-border">|</span>

          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0 text-muted-foreground"
            onClick={() => setNewDashOpen(true)}
            title={t('addDashboard')}
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* ── Hero + Metrics Strip ── */}
      <div style={{ animation: 'qv-stagger-in 0.4s ease-out both' }}>
        <DashboardHero />
      </div>
      <div style={{ animation: 'qv-stagger-in 0.4s ease-out both', animationDelay: '80ms' }}>
        <DashboardMetricsStrip
          metricIds={activeDash.metricsStripIds}
          onMetricIdsChange={updateMetricsStripIds}
        />
      </div>
      <div className="border-b border-border" />

      {/* ── Widget zones ── */}
      {activeDash.widgets.length === 0 ? (
        <div className="flex flex-col items-center py-16 gap-6">
          <div className="text-center max-w-md">
            <h2 className="text-lg font-semibold text-foreground">{t('templates.getStarted')}</h2>
            <p className="text-sm text-muted-foreground mt-1">{t('templates.getStartedDesc')}</p>
          </div>
          <div className="grid grid-cols-2 gap-3 max-w-lg w-full">
            {DASHBOARD_TEMPLATES.map((tmpl, i) => {
              const Icon = tmpl.icon;
              return (
                <button
                  key={tmpl.id}
                  onClick={() => applyTemplateToCurrent(tmpl)}
                  className="bg-card border border-border rounded-lg p-4 text-left hover:border-primary/50 hover:shadow-sm cursor-pointer transition-all"
                  style={{ animation: 'qv-stagger-in 0.4s ease-out both', animationDelay: `${i * 50}ms` }}
                >
                  <Icon className="h-5 w-5 text-primary mb-2" />
                  <div className="text-sm font-medium text-foreground">{t(tmpl.i18nKey)}</div>
                  <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{t(tmpl.descriptionKey)}</p>
                  <div className="text-xs text-muted-foreground mt-2">
                    {t('templates.widgetCount', { count: tmpl.widgetTypes.length })}
                  </div>
                </button>
              );
            })}
          </div>
          <button
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => setCatalogOpen(true)}
          >
            {t('templates.startFromScratch')}
          </button>
        </div>
      ) : (
        <DndContext sensors={widgetSensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          {/* Charts zone */}
          {chartWidgets.length > 0 && (
            <SortableContext items={chartIds} strategy={rectSortingStrategy}>
              <div className="space-y-4" style={{ animation: 'qv-stagger-in 0.4s ease-out both', animationDelay: '160ms' }}>
                {chartWidgets.map((widget, i) => (
                  <SortableWidget
                    key={widget.id}
                    widget={{ ...widget, span: 3 }}
                    dashboardId={activeDash.id}
                    index={i}
                    onDelete={deleteWidget}
                    onTitleChange={changeWidgetTitle}
                    onSpanChange={changeWidgetSpan}
                    columns="auto"
                  />
                ))}
              </div>
            </SortableContext>
          )}

          {/* Detail zone */}
          {detailWidgets.length > 0 && (
            <SortableContext items={detailIds} strategy={rectSortingStrategy}>
              <div
                className="grid gap-2 qv-dashboard-grid"
                style={{
                  gridTemplateColumns: (activeDash.columns ?? 'auto') === 'auto'
                    ? 'repeat(auto-fill, minmax(min(220px, 100%), 1fr))'
                    : `repeat(${activeDash.columns}, 1fr)`,
                  animation: 'qv-stagger-in 0.4s ease-out both',
                  animationDelay: '240ms',
                }}
              >
                {detailWidgets.map((widget, i) => (
                  <SortableWidget
                    key={widget.id}
                    widget={widget}
                    dashboardId={activeDash.id}
                    index={i}
                    onDelete={deleteWidget}
                    onTitleChange={changeWidgetTitle}
                    onSpanChange={changeWidgetSpan}
                    columns={activeDash.columns ?? 'auto'}
                    compact
                  />
                ))}
              </div>
            </SortableContext>
          )}
        </DndContext>
      )}

      {/* ── New dashboard dialog ── */}
      <Dialog open={newDashOpen} onOpenChange={(open) => { setNewDashOpen(open); if (!open) setSelectedTemplate(null); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('addDashboard')}</DialogTitle>
            <DialogDescription className="sr-only">
              {t('addDashboardDescription')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="new-dashboard-name">{t('dashboardName')}</Label>
              <Input
                id="new-dashboard-name"
                value={newDashName}
                onChange={(e) => setNewDashName(e.target.value)}
                placeholder={t('dashboardName')}
                onKeyDown={(e) => { if (e.key === 'Enter') createDashboard(); }}
                autoFocus
              />
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2">{t('templates.startFromTemplate')}</p>
              <div className="space-y-1.5">
                {DASHBOARD_TEMPLATES.map((tmpl) => {
                  const Icon = tmpl.icon;
                  const isSelected = selectedTemplate === tmpl.id;
                  return (
                    <button
                      key={tmpl.id}
                      onClick={() => setSelectedTemplate(isSelected ? null : tmpl.id)}
                      className={cn(
                        'w-full flex items-center gap-3 p-2.5 rounded-lg border text-left transition-all',
                        isSelected
                          ? 'border-primary bg-primary/5'
                          : 'border-border hover:border-border-strong',
                      )}
                    >
                      <Icon className="h-4 w-4 text-primary shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium">{t(tmpl.i18nKey)}</div>
                      </div>
                      <span className="text-xs text-muted-foreground shrink-0">
                        {t('templates.widgetCount', { count: tmpl.widgetTypes.length })}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewDashOpen(false)}>
              {t('cancel', { ns: 'common' })}
            </Button>
            <Button onClick={createDashboard} disabled={!newDashName.trim()}>
              {t('create', { ns: 'common' })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <WidgetCatalogDialog
        open={catalogOpen}
        onClose={() => setCatalogOpen(false)}
        onAdd={addWidget}
      />
      </>
      )}
    </div>
  );
}
