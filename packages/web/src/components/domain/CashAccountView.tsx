import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { ColumnDef } from '@tanstack/react-table';
import { ListX } from 'lucide-react';
import { useAccountDetail, useAccountTransactions } from '@/api/use-accounts';
import type { TransactionListItem } from '@/api/types';
import { DataTable } from '@/components/shared/DataTable';
import { dateColumnMeta, textColumnMeta, currencyColumnMeta } from '@/lib/column-factories';
import { CurrencyDisplay } from '@/components/shared/CurrencyDisplay';
import { SummaryStrip } from '@/components/shared/SummaryStrip';
import { EmptyState } from '@/components/shared/EmptyState';
import { SectionSkeleton } from '@/components/shared/SectionSkeleton';
import { Button } from '@/components/ui/button';
import { TypeBadge } from '@/components/shared/TypeBadge';
import { formatDate } from '@/lib/formatters';
import { getPageNumbers } from '@/lib/pagination';
import { getTransactionCashflowSign } from '@/lib/transaction-display';

const PAGE_SIZE = 25;

interface CashAccountViewProps {
  depositAccountId: string;
}

export function CashAccountView({ depositAccountId }: CashAccountViewProps) {
  const { t } = useTranslation('accounts');
  const { t: tCommon } = useTranslation('common');
  const { t: tTx } = useTranslation('transactions');
  const [page, setPage] = useState(1);

  const { data: account, isLoading: accountLoading } = useAccountDetail(depositAccountId);
  const { data: txPage, isLoading: txLoading } = useAccountTransactions(depositAccountId, page, PAGE_SIZE);

  const transactions = txPage?.data ?? [];
  const total = txPage?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const txColumns = useMemo<ColumnDef<TransactionListItem>[]>(
    () => [
      {
        accessorKey: 'date',
        ...dateColumnMeta(),
        header: tTx('columns.date'),
        cell: ({ getValue }) => formatDate(getValue<string>()),
      },
      {
        accessorKey: 'type',
        ...textColumnMeta(),
        header: tTx('columns.type'),
        cell: ({ row }) => (
          <TypeBadge
            type={row.original.type}
            direction={row.original.direction}
            accountContext="deposit"
          />
        ),
      },
      {
        accessorKey: 'amount',
        ...currencyColumnMeta(),
        header: tTx('columns.amount'),
        cell: ({ row }) => {
          const v = row.original.amount;
          if (!v) return '\u2014';
          const absValue = Math.abs(parseFloat(v));
          const sign = getTransactionCashflowSign(row.original.type, row.original.direction, 'deposit');
          const displayValue = sign === 0 ? absValue : absValue * sign;
          return (
            <CurrencyDisplay
              value={displayValue}
              currency={row.original.currencyCode ?? 'EUR'}
              colorize={sign !== 0}
            />
          );
        },
      },
      {
        accessorKey: 'note',
        ...textColumnMeta(),
        header: tTx('columns.note'),
        cell: ({ getValue }) => getValue<string | null>() ?? '',
      },
    ],
    [tTx],
  );

  if (accountLoading) {
    return <SectionSkeleton rows={3} />;
  }

  if (!account) return null;

  return (
    <div className="space-y-4">
      <SummaryStrip
        items={[
          {
            label: account.name,
            value: (
              <CurrencyDisplay
                value={parseFloat(account.balance)}
                currency={account.currency}
                colorize
                className="text-lg font-semibold"
              />
            ),
          },
          {
            label: t('detail.currency'),
            value: <span className="text-sm font-semibold">{account.currency ?? '\u2014'}</span>,
          },
        ]}
        columns={2}
      />

      {total === 0 && !txLoading ? (
        <EmptyState icon={ListX} title={t('detail.noTransactions')} />
      ) : (
        <DataTable columns={txColumns} data={transactions} isLoading={txLoading} skeletonRows={10} tableId="cash-transactions" defaultSorting={[{ id: 'date', desc: true }]} />
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>{tCommon('pagination.pageOf', { current: page, total: totalPages })}</span>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
              {tCommon('pagination.previous')}
            </Button>
            {getPageNumbers(page, totalPages).map((n, i) =>
              n === '\u2026' ? (
                <span key={`ellipsis-${i}`} className="px-2">{'\u2026'}</span>
              ) : (
                <Button
                  key={n}
                  variant={n === page ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setPage(n)}
                >
                  {n}
                </Button>
              ),
            )}
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
              {tCommon('pagination.next')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
