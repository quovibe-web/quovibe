import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Trash2, Undo2 } from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';
import { readSplitDetails, formatSplitRatio, invertRatio } from '@quovibe/shared';

import { Button } from '@/components/ui/button';
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
import { DataTable } from '@/components/shared/DataTable';
import { formatDate } from '@/lib/formatters';
import { usePortfolio } from '@/context/PortfolioContext';
import { useSecurityEvents, useDeleteSecurityEvent } from '@/api/use-security-events';
import type { SecurityEventItem } from '@/api/types';

const STOCK_SPLIT = 'STOCK_SPLIT';

interface SecurityEventsSectionProps {
  securityId: string;
}

export function SecurityEventsSection({ securityId }: SecurityEventsSectionProps) {
  const { t } = useTranslation('securities');
  const navigate = useNavigate();
  const portfolio = usePortfolio();
  const { data: events = [], isLoading } = useSecurityEvents(securityId);
  const deleteEvent = useDeleteSecurityEvent();

  const [pendingDelete, setPendingDelete] = useState<SecurityEventItem | null>(null);

  /**
   * Undo is a navigation, never a server call. A stored event may have been
   * applied by this app, imported from a portfolio file where it was already
   * applied before export, or written by an older build that recorded the
   * marker without touching any data — and nothing distinguishes the three.
   * Sending the user through the wizard's preview means they always see which
   * rows will actually move before anything is written.
   */
  function undoSplit(event: SecurityEventItem): void {
    const ratio = readSplitDetails(event.details);
    if (!ratio) return;
    const inverted = invertRatio(ratio);
    const params = new URLSearchParams({
      securityId,
      exDate: event.date.slice(0, 10),
      newShares: inverted.newShares.toString(),
      oldShares: inverted.oldShares.toString(),
    });
    navigate(`/p/${portfolio.id}/securities/split?${params.toString()}`);
  }

  function confirmDelete(): void {
    if (!pendingDelete) return;
    deleteEvent.mutate(
      { securityId, eventId: pendingDelete.id },
      {
        onSuccess: () => {
          toast.success(t('split.events.deleted'));
          setPendingDelete(null);
        },
        onError: () => setPendingDelete(null),
      },
    );
  }

  const columns = useMemo<ColumnDef<SecurityEventItem>[]>(
    () => [
      {
        accessorKey: 'date',
        header: () => t('split.events.columns.date'),
        cell: ({ row }) => formatDate(row.original.date),
      },
      {
        accessorKey: 'type',
        header: () => t('split.events.columns.type'),
        cell: ({ row }) =>
          row.original.type === STOCK_SPLIT
            ? t('split.events.typeStockSplit')
            : row.original.type,
      },
      {
        accessorKey: 'details',
        header: () => t('split.events.columns.details'),
        cell: ({ row }) => {
          if (row.original.type !== STOCK_SPLIT) return row.original.details;
          const ratio = readSplitDetails(row.original.details);
          // Unparseable details render raw rather than throwing.
          if (!ratio) return row.original.details;
          const label = ratio.newShares.gt(ratio.oldShares)
            ? t('split.events.forwardLabel')
            : t('split.events.reverseLabel');
          return (
            <span className="qv-numeric">
              {formatSplitRatio(ratio)} · <span className="not-qv-numeric">{label}</span>
            </span>
          );
        },
      },
      {
        id: 'actions',
        header: () => '',
        cell: ({ row }) => {
          const canUndo =
            row.original.type === STOCK_SPLIT && readSplitDetails(row.original.details) !== null;
          return (
            <div className="flex justify-end gap-1">
              {canUndo && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => undoSplit(row.original)}
                  title={t('split.events.undo')}
                  aria-label={t('split.events.undo')}
                >
                  <Undo2 className="h-4 w-4" />
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setPendingDelete(row.original)}
                title={t('split.events.delete')}
                aria-label={t('split.events.delete')}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          );
        },
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, securityId, portfolio.id],
  );

  return (
    <div className="space-y-3">
      <span className="text-sm font-medium">{t('split.events.title')}</span>

      {!isLoading && events.length === 0 ? (
        <p className="text-sm text-[var(--qv-text-secondary)]">{t('split.events.empty')}</p>
      ) : (
        <DataTable columns={columns} data={events} isLoading={isLoading} />
      )}

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('split.events.deleteTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete?.type === STOCK_SPLIT
                ? t('split.events.deleteWarning')
                : t('split.events.deleteGeneric')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common:cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>{t('common:delete')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
