import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronRight } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { useWidgetConfig } from '@/context/widget-config-context';
import { useDashboardConfig, useSaveDashboard } from '@/api/use-dashboard-config';
import { useReportingPeriods } from '@/api/use-reporting-periods';
import { useFirstTransactionDate } from '@/api/use-transactions';
import { useReportingPeriod } from '@/api/use-performance';
import { DEFAULT_PERIODS, formatPeriodShortLabel, formatPeriodRange, getPeriodId, ALL_PERIOD_ID } from '@/lib/period-utils';
import { resolveReportingPeriod } from '@quovibe/shared';
import type { ReportingPeriodDef } from '@quovibe/shared';
import { cn } from '@/lib/utils';

interface PeriodOverrideDialogProps {
  widgetId: string;
  dashboardId: string;
  open: boolean;
  onClose: () => void;
}

export function PeriodOverrideDialog({
  widgetId,
  dashboardId,
  open,
  onClose,
}: PeriodOverrideDialogProps) {
  const { t } = useTranslation('dashboard');
  const { t: tSettings } = useTranslation('settings');
  const { periodOverride, setPeriodOverride } = useWidgetConfig();
  const { periodStart: globalStart, periodEnd: globalEnd } = useReportingPeriod();
  const { data: dashConfig } = useDashboardConfig();
  const saveDashboard = useSaveDashboard();
  const { data: periodsData } = useReportingPeriods();
  const { data: firstDateData } = useFirstTransactionDate();

  const [followGlobal, setFollowGlobal] = useState(true);
  const [selectedDef, setSelectedDef] = useState<ReportingPeriodDef | null>(null);
  const [customExpanded, setCustomExpanded] = useState(false);
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');

  // Reset dialog state when opened
  useEffect(() => {
    if (open) {
      const hasOverride = periodOverride !== null;
      setFollowGlobal(!hasOverride);
      setSelectedDef(hasOverride ? periodOverride.definition : null);
      setCustomExpanded(false);
      setCustomFrom('');
      setCustomTo('');
    }
  }, [open, periodOverride]);

  // Build available presets: default + custom + ALL
  const presets = useMemo(() => {
    const items: Array<{ def: ReportingPeriodDef; label: string; id: string }> = [];

    for (const def of DEFAULT_PERIODS) {
      items.push({ def, label: formatPeriodShortLabel(def, tSettings), id: getPeriodId(def) });
    }

    if (periodsData?.periods) {
      for (const p of periodsData.periods) {
        const id = getPeriodId(p.definition);
        // Skip duplicates with default periods
        if (!items.some((it) => it.id === id)) {
          items.push({ def: p.definition, label: formatPeriodShortLabel(p.definition, tSettings), id });
        }
      }
    }

    if (firstDateData?.date) {
      items.push({
        def: { type: 'since', date: firstDateData.date },
        label: t('periodOverride.all'),
        id: ALL_PERIOD_ID,
      });
    }

    return items;
  }, [periodsData, firstDateData, tSettings, t]);

  // Resolve preview
  const resolvedPreview = useMemo(() => {
    if (followGlobal) return { periodStart: globalStart, periodEnd: globalEnd };
    if (!selectedDef) return null;
    return resolveReportingPeriod(selectedDef);
  }, [followGlobal, selectedDef, globalStart, globalEnd]);

  const selectedId = selectedDef ? getPeriodId(selectedDef) : null;

  function selectPreset(def: ReportingPeriodDef) {
    setSelectedDef(def);
    setCustomExpanded(false);
  }

  function handleApply() {
    if (followGlobal) {
      setPeriodOverride(null);
      persistOverride(null);
    } else if (selectedDef) {
      setPeriodOverride(selectedDef);
      const resolved = resolveReportingPeriod(selectedDef);
      persistOverride({ definition: selectedDef, ...resolved });
    }
    onClose();
  }

  function persistOverride(override: unknown) {
    if (!dashConfig) return;
    const updatedDashboards = dashConfig.dashboards.map((dash) => {
      if (dash.id !== dashboardId) return dash;
      return {
        ...dash,
        widgets: dash.widgets.map((w) => {
          if (w.id !== widgetId) return w;
          return { ...w, config: { ...w.config, periodOverride: override } };
        }),
      };
    });
    saveDashboard.mutate({
      dashboards: updatedDashboards,
      activeDashboard: dashConfig.activeDashboard,
    });
  }

  function handleCancel() {
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) handleCancel(); }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('periodOverride.title')}</DialogTitle>
          <DialogDescription className="sr-only">
            {t('periodOverride.description')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Follow global toggle */}
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div className="space-y-0.5">
              <Label className="text-sm font-medium">{t('periodOverride.followGlobal')}</Label>
              <p className="text-xs text-muted-foreground">
                {t('periodOverride.currentGlobal', {
                  period: formatPeriodRange(globalStart, globalEnd),
                })}
              </p>
            </div>
            <Switch
              checked={followGlobal}
              onCheckedChange={(checked) => {
                setFollowGlobal(checked);
                if (checked) setSelectedDef(null);
              }}
            />
          </div>

          {/* Quick-pick pills (hidden when following global) */}
          {!followGlobal && (
            <>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
                  {t('periodOverride.quickSelect')}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {presets.map((p) => (
                    <button
                      key={p.id}
                      className={cn(
                        'rounded-md border px-3 py-1.5 text-sm transition-colors',
                        selectedId === p.id
                          ? 'bg-primary/15 text-primary border-primary/30 font-medium'
                          : 'text-muted-foreground border-border hover:text-foreground hover:bg-muted',
                      )}
                      onClick={() => selectPreset(p.def)}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Custom range expander */}
              <div>
                <button
                  className="flex items-center gap-1 text-xs text-primary hover:underline"
                  onClick={() => setCustomExpanded(!customExpanded)}
                >
                  <ChevronRight
                    className={cn('h-3 w-3 transition-transform', customExpanded && 'rotate-90')}
                  />
                  {t('periodOverride.customRange')}
                </button>

                {customExpanded && (
                  <div className="mt-3 flex gap-3">
                    <div className="flex-1 space-y-1">
                      <Label className="text-xs">{t('periodOverride.from')}</Label>
                      <Input
                        type="date"
                        value={customFrom}
                        onChange={(e) => {
                          setCustomFrom(e.target.value);
                          if (e.target.value && customTo) {
                            const def: ReportingPeriodDef = { type: 'fromTo', from: e.target.value, to: customTo };
                            setSelectedDef(def);
                          }
                        }}
                        className="h-8 text-sm"
                      />
                    </div>
                    <div className="flex-1 space-y-1">
                      <Label className="text-xs">{t('periodOverride.to')}</Label>
                      <Input
                        type="date"
                        value={customTo}
                        onChange={(e) => {
                          setCustomTo(e.target.value);
                          if (customFrom && e.target.value) {
                            const def: ReportingPeriodDef = { type: 'fromTo', from: customFrom, to: e.target.value };
                            setSelectedDef(def);
                          }
                        }}
                        className="h-8 text-sm"
                      />
                    </div>
                  </div>
                )}
              </div>
            </>
          )}

          {/* Live preview */}
          {resolvedPreview && (
            <div className="flex items-center gap-2 rounded-lg border bg-muted/50 p-3">
              <span className="text-primary text-base">&#128339;</span>
              <div>
                <p className="text-xs text-muted-foreground">{t('periodOverride.resolvedPeriod')}</p>
                <p className="text-sm font-medium">
                  {formatPeriodRange(resolvedPreview.periodStart, resolvedPreview.periodEnd)}
                </p>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleCancel}>
            {t('periodOverride.cancel')}
          </Button>
          <Button onClick={handleApply} disabled={!followGlobal && !selectedDef}>
            {t('periodOverride.apply')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
