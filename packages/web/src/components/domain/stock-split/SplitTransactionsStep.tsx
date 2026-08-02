import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { ColumnDef } from '@tanstack/react-table';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardContent } from '@/components/ui/card';
import { DataTable } from '@/components/shared/DataTable';
import { formatDate, formatShares } from '@/lib/formatters';
import { txTypeKey } from '@/lib/utils';
import type { SplitPreviewTx } from '@/api/use-stock-split';

interface SplitTransactionsStepProps {
  transactions: SplitPreviewTx[];
  changeTransactions: boolean;
  onToggle: (value: boolean) => void;
  onBack: () => void;
  onNext: () => void;
}

export function SplitTransactionsStep({
  transactions,
  changeTransactions,
  onToggle,
  onBack,
  onNext,
}: SplitTransactionsStepProps) {
  const { t } = useTranslation('securities');

  const columns = useMemo<ColumnDef<SplitPreviewTx>[]>(
    () => [
      {
        accessorKey: 'date',
        header: () => t('split.columns.date'),
        cell: ({ row }) => formatDate(row.original.date),
      },
      {
        accessorKey: 'type',
        header: () => t('split.columns.type'),
        cell: ({ row }) => t(`transactions:types.${txTypeKey(row.original.type)}`),
      },
      {
        accessorKey: 'accountName',
        header: () => t('split.columns.account'),
        cell: ({ row }) => row.original.accountName ?? '—',
      },
      {
        accessorKey: 'sharesOld',
        header: () => t('split.columns.sharesBefore'),
        cell: ({ row }) => (
          <span className="qv-numeric">{formatShares(row.original.sharesOld / 1e8)}</span>
        ),
      },
      {
        accessorKey: 'sharesNew',
        header: () => t('split.columns.sharesAfter'),
        cell: ({ row }) => (
          <span className="qv-numeric font-medium">
            {formatShares(row.original.sharesNew / 1e8)}
          </span>
        ),
      },
    ],
    [t],
  );

  return (
    <Card>
      <CardContent className="pt-6 space-y-6">
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={changeTransactions}
            onCheckedChange={(v) => onToggle(v === true)}
            aria-label={t('split.convertTransactions')}
          />
          {t('split.convertTransactions')}
        </label>

        {transactions.length === 0 ? (
          <p className="text-sm text-[var(--qv-text-secondary)]">{t('split.noTransactions')}</p>
        ) : (
          <DataTable columns={columns} data={transactions} pagination pageSize={25} />
        )}

        <div className="flex justify-between">
          <Button variant="outline" onClick={onBack}>
            {t('common:back')}
          </Button>
          <Button onClick={onNext}>{t('common:next')}</Button>
        </div>
      </CardContent>
    </Card>
  );
}
