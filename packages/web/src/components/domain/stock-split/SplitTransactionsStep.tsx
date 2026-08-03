import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { ColumnDef } from '@tanstack/react-table';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardContent } from '@/components/ui/card';
import { DataTable } from '@/components/shared/DataTable';
import { formatDate, formatShares } from '@/lib/formatters';
import { txTypeKey } from '@/lib/utils';
import { usePrivacy } from '@/context/privacy-context';
import { maskShares } from '@/lib/privacy';
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
  const { isPrivate } = usePrivacy();

  const columns = useMemo<ColumnDef<SplitPreviewTx>[]>(
    () => [
      // Explicit sizes: the default 150 per column overflows the wizard card at
      // five columns, and long account names then paint over the next cell.
      {
        accessorKey: 'date',
        header: () => t('split.columns.date'),
        size: 100,
        cell: ({ row }) => formatDate(row.original.date),
      },
      {
        accessorKey: 'type',
        header: () => t('split.columns.type'),
        size: 90,
        cell: ({ row }) => t(`transactions:types.${txTypeKey(row.original.type)}`),
      },
      {
        accessorKey: 'accountName',
        header: () => t('split.columns.account'),
        size: 170,
        cell: ({ row }) => (
          <span className="block truncate" title={row.original.accountName ?? undefined}>
            {row.original.accountName ?? '—'}
          </span>
        ),
      },
      {
        accessorKey: 'sharesOld',
        header: () => t('split.columns.sharesBefore'),
        size: 110,
        cell: ({ row }) => (
          <span className="qv-numeric block truncate">
            {maskShares(formatShares(row.original.sharesOld / 1e8), isPrivate)}
          </span>
        ),
      },
      {
        accessorKey: 'sharesNew',
        header: () => t('split.columns.sharesAfter'),
        size: 110,
        cell: ({ row }) => (
          <span className="qv-numeric font-medium block truncate">
            {maskShares(formatShares(row.original.sharesNew / 1e8), isPrivate)}
          </span>
        ),
      },
    ],
    [t, isPrivate],
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
            {t('split.nav.back')}
          </Button>
          <Button onClick={onNext}>{t('split.nav.next')}</Button>
        </div>
      </CardContent>
    </Card>
  );
}
