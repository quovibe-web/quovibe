import { useState, useMemo } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { ColumnDef } from '@tanstack/react-table';
import { ListX, TrendingUp } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAccountTransactions } from '@/api/use-accounts';
import type { TransactionListItem } from '@/api/types';
import { DataTable } from '@/components/shared/DataTable';
import { dateColumnMeta, textColumnMeta, currencyColumnMeta } from '@/lib/column-factories';
import { CurrencyDisplay } from '@/components/shared/CurrencyDisplay';
import { EmptyState } from '@/components/shared/EmptyState';
import { Button } from '@/components/ui/button';
import { TypeBadge } from '@/components/shared/TypeBadge';
import { CashAccountView } from '@/components/domain/CashAccountView';
import { formatDate } from '@/lib/formatters';
import { getPageNumbers } from '@/lib/pagination';
import { getTransactionCashflowSign } from '@/lib/transaction-display';

const PAGE_SIZE = 25;

interface AccountDetailTabsProps {
  accountId: string;
  depositAccountId: string | null;
  isPortfolio: boolean;
}

export function AccountDetailTabs({ accountId, depositAccountId, isPortfolio }: AccountDetailTabsProps) {
  const { t } = useTranslation('accounts');
  const { t: tCommon } = useTranslation('common');
  const { t: tTx } = useTranslation('transactions');
  const [page, setPage] = useState(1);

  const { data: txPage, isLoading: txLoading } = useAccountTransactions(accountId, page, PAGE_SIZE);
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
            accountContext={isPortfolio ? 'securities' : 'deposit'}
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
          const sign = getTransactionCashflowSign(row.original.type, row.original.direction, isPortfolio ? 'securities' : 'deposit');
          if (!isPortfolio) {
            const displayValue = sign === 0 ? absValue : absValue * sign;
            return (
              <CurrencyDisplay
                value={displayValue}
                currency={row.original.currencyCode}
                colorize={sign !== 0}
              />
            );
          }
          return (
            <CurrencyDisplay
              value={absValue}
              currency={row.original.currencyCode}
              colorize={sign !== 0}
              colorSign={sign !== 0 ? sign : undefined}
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
    [tTx, isPortfolio],
  );

  const location = useLocation();
  const { portfolioId } = useParams<{ portfolioId: string }>();
  const periodSearch = location.search;

  const defaultTab = 'cash';

  const transactionsContent = (
    <div className="space-y-4">
      {total === 0 && !txLoading ? (
        <EmptyState icon={ListX} title={t('detail.noTransactions')} />
      ) : (
        <DataTable columns={txColumns} data={transactions} isLoading={txLoading} skeletonRows={10} tableId="account-transactions" defaultSorting={[{ id: 'date', desc: true }]} />
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

  return (
    <div className="space-y-4">
      {isPortfolio && (
        <Link
          to={`/p/${portfolioId}/investments${periodSearch ? periodSearch + '&' : '?'}account=${accountId}`}
          className="flex items-center gap-2 px-4 py-3 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-accent/50 rounded-lg border border-border w-fit transition-colors"
        >
          <TrendingUp className="h-4 w-4" />
          {t('detail.viewHoldings')} →
        </Link>
      )}

      <Tabs defaultValue={defaultTab}>
        <TabsList>
          {(isPortfolio ? depositAccountId : true) && (
            <TabsTrigger value="cash">{t('detail.tabs.cashAccount')}</TabsTrigger>
          )}
          <TabsTrigger value="transactions">{t('detail.tabs.transactions')}</TabsTrigger>
        </TabsList>

        {isPortfolio && depositAccountId && (
          <TabsContent value="cash">
            <CashAccountView depositAccountId={depositAccountId} />
          </TabsContent>
        )}

        {!isPortfolio && (
          <TabsContent value="cash">
            <CashAccountView depositAccountId={accountId} />
          </TabsContent>
        )}

        <TabsContent value="transactions">
          {transactionsContent}
        </TabsContent>
      </Tabs>
    </div>
  );
}
