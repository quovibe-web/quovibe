import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronUp, ChevronDown, Trash2, Plus } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  useReportingPeriods,
  useDeleteReportingPeriod,
  useReorderReportingPeriods,
} from '@/api/use-reporting-periods';
import { NewPeriodDialog } from '@/components/domain/NewPeriodDialog';
import { formatPeriodLabel } from '@/lib/period-utils';
import { formatDate } from '@/lib/formatters';
import { usePreferences } from '@/api/use-preferences';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ManagePeriodsDialog({ open, onOpenChange }: Props) {
  const { t } = useTranslation('settings');
  const { t: tRaw } = useTranslation();
  const { data } = useReportingPeriods();
  const { data: prefs } = usePreferences();
  const fiscalYear = prefs?.fiscalYear;
  const { mutate: deletePeriod, isPending: isDeleting } = useDeleteReportingPeriod();
  const { mutate: reorderPeriods, isPending: isReordering } = useReorderReportingPeriods();
  const [newPeriodOpen, setNewPeriodOpen] = useState(false);

  const periods = data?.periods ?? [];
  const isBusy = isDeleting || isReordering;

  function handleMoveUp(index: number) {
    if (index === 0) return;
    const defs = periods.map((p) => p.definition);
    const next = [...defs];
    [next[index - 1], next[index]] = [next[index], next[index - 1]];
    reorderPeriods(next);
  }

  function handleMoveDown(index: number) {
    if (index === periods.length - 1) return;
    const defs = periods.map((p) => p.definition);
    const next = [...defs];
    [next[index], next[index + 1]] = [next[index + 1], next[index]];
    reorderPeriods(next);
  }

  function handleDelete(index: number) {
    deletePeriod(index);
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('periods.title')}</DialogTitle>
            <DialogDescription className="sr-only">
              {t('periods.title')}
            </DialogDescription>
          </DialogHeader>

          {periods.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {t('periods.noPeriods')}
            </p>
          ) : (
            <ScrollArea className="max-h-72">
              <ul className="space-y-1 py-1">
                {periods.map((p, i) => (
                  <li
                    key={i}
                    className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted/50"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">
                        {formatPeriodLabel(p.definition, tRaw, fiscalYear)}
                      </p>
                      <p className="text-[10px] text-muted-foreground font-mono tabular-nums">
                        {formatDate(p.resolved.periodStart)} — {formatDate(p.resolved.periodEnd)}
                      </p>
                    </div>
                    <div className="flex items-center gap-0.5 shrink-0">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => handleMoveUp(i)}
                        disabled={i === 0 || isBusy}
                        title={t('periods.moveUp')}
                        aria-label={t('periods.moveUp')}
                      >
                        <ChevronUp className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => handleMoveDown(i)}
                        disabled={i === periods.length - 1 || isBusy}
                        title={t('periods.moveDown')}
                        aria-label={t('periods.moveDown')}
                      >
                        <ChevronDown className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => handleDelete(i)}
                        disabled={isBusy}
                        title={t('periods.deletePeriod')}
                        aria-label={t('periods.deletePeriod')}
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </ScrollArea>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              className="gap-1.5"
              onClick={() => setNewPeriodOpen(true)}
            >
              <Plus className="h-4 w-4" />
              {t('periods.newPeriod')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <NewPeriodDialog open={newPeriodOpen} onOpenChange={setNewPeriodOpen} />
    </>
  );
}
