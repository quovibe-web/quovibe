import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ChevronDown, Eye, EyeOff, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { CurrencyDisplay } from '@/components/shared/CurrencyDisplay';
import { SummaryStrip } from '@/components/shared/SummaryStrip';
import { useAccountDetail, useAccountHoldings, useAccounts, useDeactivateAccount, useDeleteAccount, useReactivateAccount } from '@/api/use-accounts';
import { AccountType, TransactionType, getAvailableTransactionTypes } from '@/lib/enums';
import { cn, txTypeKey } from '@/lib/utils';
import { StockSplitDialog } from '@/components/domain/StockSplitDialog';
import { CorporateEventDialog } from '@/components/domain/CorporateEventDialog';
import { AccountDetailTabs } from '@/components/domain/AccountDetailTabs';
import { SectionSkeleton } from '@/components/shared/SectionSkeleton';

export default function AccountDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation('accounts');
  const { t: tCommon } = useTranslation('common');
  const { t: tTx } = useTranslation('transactions');
  const [splitOpen, setSplitOpen] = useState(false);
  const [eventOpen, setEventOpen] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  const { data: account, isLoading, isFetching } = useAccountDetail(id ?? '');
  const { data: allAccounts = [], isLoading: accountsLoading } = useAccounts(true);
  const deactivateAccount = useDeactivateAccount();
  const reactivateAccount = useReactivateAccount();
  const deleteAccount = useDeleteAccount();

  const isPortfolio = account?.type === 'portfolio';
  const { data: holdings } = useAccountHoldings(isPortfolio ? (id ?? '') : '');

  const isRefetching = isFetching && !isLoading;
  const accountType = isPortfolio ? AccountType.SECURITIES : AccountType.DEPOSIT;
  const availableTypes = getAvailableTransactionTypes(accountType);

  // Portfolio split bar calculations
  const secValue = isPortfolio && holdings ? parseFloat(holdings.totalValue) : 0;
  const depositAccount = isPortfolio && account?.referenceAccountId
    ? allAccounts.find(a => a.id === account.referenceAccountId)
    : null;
  const cashValue = depositAccount ? parseFloat(depositAccount.balance) : 0;
  const totalValue = secValue + cashValue;
  const secPct = totalValue > 0 ? secValue / totalValue : 0.5;

  function handleConfirmDelete() {
    deleteAccount.mutate(account!.id, {
      onSuccess: () => {
        toast.success(tCommon('toasts.accountDeleted'));
        navigate('/accounts');
      },
      onError: (err) => {
        toast.error((err as Error).message ?? tCommon('toasts.errorDeleting'));
        setShowDeleteDialog(false);
      },
    });
  }

  function goToNewTransaction(type: TransactionType) {
    navigate(
      `/transactions/new?accountId=${id}&accountType=${account!.type}&type=${type}`,
    );
  }

  return (
    <div className={cn("qv-page space-y-6", isRefetching && 'opacity-60 transition-opacity duration-200')}>
    {(isLoading || accountsLoading) ? (
      <>
        <SectionSkeleton rows={2} />
        <SectionSkeleton rows={6} />
      </>
    ) : !account ? (
      <p className="text-muted-foreground">{tCommon('notFound')}</p>
    ) : (
      <>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-3">
        <div className="flex items-center gap-3 flex-wrap">
          {account.logoUrl && <img src={account.logoUrl} alt="" className="h-8 w-8 rounded-md object-contain" />}
          <div>
            <h1 className="text-lg font-semibold text-foreground tracking-tight">{account.name}</h1>
            <div className="flex items-center gap-2 mt-0.5">
              <Badge
                style={{
                  backgroundColor: account.type === 'account' ? 'var(--qv-positive)' : 'var(--qv-info)',
                  color: '#fff',
                }}
              >
                {account.type === 'account' ? t('types.deposit') : t('types.portfolio')}
              </Badge>
              <span className="text-sm text-muted-foreground">{account.currency}</span>
              {account.isRetired && (
                <span className="text-sm text-muted-foreground">{tCommon('retired')}</span>
              )}
            </div>
          </div>
        </div>

        <div className="sm:ml-auto flex items-center gap-2 flex-wrap">
          <Button
            variant="destructive"
            size="sm"
            onClick={() => {
              if (account.transactionCount > 0) {
                toast.error(t('actions.cannotDelete', { count: account.transactionCount }));
                return;
              }
              setShowDeleteDialog(true);
            }}
          >
            <Trash2 className="mr-1 h-4 w-4" /> {tCommon('delete')}
          </Button>

          {account.isRetired ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => reactivateAccount.mutate(account.id)}
            >
              <Eye className="mr-1 h-4 w-4" /> {t('actions.reactivate')}
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => deactivateAccount.mutate(account.id)}
            >
              <EyeOff className="mr-1 h-4 w-4" /> {t('actions.deactivate')}
            </Button>
          )}

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                {t('actions.newTransaction')} <ChevronDown className="ml-1 h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {availableTypes.map(tp => (
              <DropdownMenuItem key={tp} onClick={() => goToNewTransaction(tp)}>
                {tTx('types.' + txTypeKey(tp))}
              </DropdownMenuItem>
            ))}
            {isPortfolio && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setSplitOpen(true)}>
                  {t('menu.stockSplit')}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setEventOpen(true)}>
                  {t('menu.corporateEvent')}
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {isPortfolio && account.referenceAccountId && (
        <div className="space-y-3">
          {/* Split bar: securities vs cash */}
          <div className="flex h-1.5 rounded-full overflow-hidden">
            <div className="bg-primary" style={{ flex: secPct }} />
            <div className="bg-muted" style={{ flex: 1 - secPct }} />
          </div>

          <SummaryStrip
            items={[
              {
                label: t('card.totalValue'),
                value: (
                  <CurrencyDisplay
                    value={totalValue}
                    currency={account.currency}
                    className="text-lg font-semibold"
                  />
                ),
              },
              {
                label: t('card.securities'),
                value: (
                  <CurrencyDisplay
                    value={secValue}
                    currency={account.currency}
                    className="text-lg font-semibold"
                  />
                ),
              },
              {
                label: t('card.cash'),
                value: (
                  <CurrencyDisplay
                    value={cashValue}
                    currency={account.currency}
                    className="text-lg font-semibold"
                  />
                ),
              },
              {
                label: t('detail.referenceAccount'),
                value: (
                  <span className="text-sm font-semibold">
                    {depositAccount?.name ?? account.referenceAccountId}
                  </span>
                ),
              },
            ]}
            columns={4}
          />
        </div>
      )}

      <AccountDetailTabs
        accountId={id ?? ''}
        depositAccountId={isPortfolio ? (account.referenceAccountId ?? null) : null}
        isPortfolio={isPortfolio}
      />

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{tCommon('deleteConfirm.title')}</AlertDialogTitle>
            <AlertDialogDescription>
              {tCommon('deleteConfirm.description')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tCommon('deleteConfirm.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleConfirmDelete}
            >
              {tCommon('deleteConfirm.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <StockSplitDialog open={splitOpen} onOpenChange={setSplitOpen} />
      <CorporateEventDialog open={eventOpen} onOpenChange={setEventOpen} />
      </>
    )}
    </div>
  );
}
