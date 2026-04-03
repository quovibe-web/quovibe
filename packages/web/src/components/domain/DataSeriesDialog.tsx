import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useWidgetConfig } from '@/context/widget-config-context';
import { useDashboardConfig, useSaveDashboard } from '@/api/use-dashboard-config';
import { DataSeriesSelector } from './DataSeriesSelector';
import type { DataSeriesValue } from '@quovibe/shared';

interface DataSeriesDialogProps {
  widgetId: string;
  dashboardId: string;
  open: boolean;
  onClose: () => void;
}

export function DataSeriesDialog({
  widgetId,
  dashboardId,
  open,
  onClose,
}: DataSeriesDialogProps) {
  const { t } = useTranslation('dashboard');
  const { dataSeries, setDataSeries } = useWidgetConfig();
  const { data: dashConfig } = useDashboardConfig();
  const saveDashboard = useSaveDashboard();
  const [draft, setDraft] = useState<DataSeriesValue | null>(dataSeries);

  useEffect(() => {
    if (open) setDraft(dataSeries);
  }, [open, dataSeries]);

  function handleApply() {
    setDataSeries(draft);
    if (dashConfig) {
      const updatedDashboards = dashConfig.dashboards.map((dash) => {
        if (dash.id !== dashboardId) return dash;
        return {
          ...dash,
          widgets: dash.widgets.map((w) => {
            if (w.id !== widgetId) return w;
            return { ...w, config: { ...w.config, dataSeries: draft } };
          }),
        };
      });
      saveDashboard.mutate({
        dashboards: updatedDashboards,
        activeDashboard: dashConfig.activeDashboard,
      });
    }
    onClose();
  }

  function handleCancel() {
    setDraft(dataSeries);
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) handleCancel(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('dataSeries.dialogTitle')}</DialogTitle>
          <DialogDescription className="sr-only">
            {t('dataSeries.description')}
          </DialogDescription>
        </DialogHeader>
        <DataSeriesSelector value={draft} onChange={setDraft} />
        <DialogFooter>
          <Button variant="outline" onClick={handleCancel}>
            {t('cancel', { ns: 'common' })}
          </Button>
          <Button onClick={handleApply}>
            {t('apply', { ns: 'common' })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
