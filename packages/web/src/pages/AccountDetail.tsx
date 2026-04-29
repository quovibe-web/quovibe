import { useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { usePortfolio } from '@/context/PortfolioContext';
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
import { ChangeReferenceAccountDialog } from '@/components/domain/ChangeReferenceAccountDialog';
import { Pencil } from 'lucide-react';
import { SectionSkeleton } from '@/components/shared/SectionSkeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Label } from '@/components/ui/label';
import { TransactionForm, type TransactionFormValues } from '@/components/domain/TransactionForm';
import { useCreateTransaction } from '@/api/use-transactions';
import { useGuardedSubmit } from '@/hooks/use-guarded-submit';
import { preparePayload } from '@/lib/transaction-payload';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';

export default function AccountDetail() {
  useDocumentTitle('Account');
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const portfolio = usePortfolio();
  const { t } = useTranslation('accounts');
  const { t: tCommon } = useTranslation('common');
  const { t: tTx } = useTranslation('transactions');
  const [splitOpen, setSplitOpen] = useState(false);
  const [eventOpen, setEventOpen] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [changeRefOpen, setChangeRefOpen] = useState(false);
  const [newSheetOpen, setNewSheetOpen] = useState(false);
  const [newTxType, setNewTxType] = useState<TransactionType>(TransactionType.BUY);
  const newTxFormRef = useRef<HTMLFormElement>(null);
  const createMutation = useCreateTransaction();
  const { run: handleNewTxSubmit, inFlight: createInFlight } = useGuardedSubmit(
    async (values: TransactionFormValues) => {
      try {
        await createMutation.mutateAsync(preparePayload(values));
        toast.success(tCommon('toasts.transactionCreated'));
        setNewSheetOpen(false);
      } catch {
        // Global MutationCache error toast handles user-visible feedback.
      }
    },
  );

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
        navigate(`/p/${portfolio.id}/accounts`);
      },
      onError: () => {
        setShowDeleteDialog(false);
      },
    });
  }

  function openNewTransaction(type: TransactionType) {
    setNewTxType(type);
    setNewSheetOpen(true);
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
              <DropdownMenuItem key={tp} onClick={() => openNewTransaction(tp)}>
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
                  <button
                    type="button"
                    onClick={() => setChangeRefOpen(true)}
                    disabled={account.isRetired}
                    className="inline-flex items-center gap-1 text-sm font-semibold hover:text-primary disabled:cursor-not-allowed disabled:hover:text-foreground"
                    aria-label={t('actions.changeReferenceAccount')}
                  >
                    {depositAccount?.name ?? account.referenceAccountId}
                    {!account.isRetired && <Pencil className="h-3 w-3 opacity-60" />}
                  </button>
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
      {isPortfolio && account.referenceAccountId && (
        <ChangeReferenceAccountDialog
          open={changeRefOpen}
          onOpenChange={setChangeRefOpen}
          securitiesAccountId={account.id}
          currentReferenceAccountId={account.referenceAccountId}
          currency={account.currency ?? depositAccount?.currency ?? 'EUR'}
        />
      )}
      {/* New Transaction Sheet */}
      <Sheet open={newSheetOpen} onOpenChange={setNewSheetOpen}>
        <SheetContent side="right" className="sm:max-w-lg w-full flex flex-col">
          <SheetHeader>
            <SheetTitle>{tTx('newTransaction')}</SheetTitle>
          </SheetHeader>
          <div className="px-4 pb-2">
            <Label className="mb-1.5 block">{tTx('transactionType')}</Label>
            <Select value={newTxType} onValueChange={(v) => setNewTxType(v as TransactionType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {availableTypes.map((tp) => (
                  <SelectItem key={tp} value={tp}>{tTx('types.' + txTypeKey(tp))}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <ScrollArea className="flex-1 min-h-0 px-4">
            <TransactionForm
              key={newTxType}
              type={newTxType}
              onSubmit={handleNewTxSubmit}
              isSubmitting={createInFlight || createMutation.isPending}
              hideSubmitButton
              formRef={newTxFormRef}
              preselectedAccountId={id}
              serverError={createMutation.error}
            />
          </ScrollArea>
          <SheetFooter className="border-t px-4 py-3 flex-row justify-end gap-2">
            <Button variant="outline" onClick={() => setNewSheetOpen(false)}>
              {tCommon('cancel')}
            </Button>
            <Button
              onClick={() => newTxFormRef.current?.requestSubmit()}
              disabled={createInFlight || createMutation.isPending}
            >
              {createMutation.isPending ? tCommon('saving') : tCommon('save')}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
      </>
    )}
    </div>
  );
}
