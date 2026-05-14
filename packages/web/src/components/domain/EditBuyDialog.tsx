import { useState, useEffect, useMemo, useRef } from 'react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { SubmitButton } from '@/components/shared/SubmitButton';
import { TransactionForm, type TransactionFormValues } from '@/components/domain/TransactionForm';
import { useUpdateTransaction, useTransactionDetail } from '@/api/use-transactions';
import { useAccounts } from '@/api/use-accounts';
import { useGuardedSubmit } from '@/hooks/use-guarded-submit';
import { useUnsavedChangesGuard } from '@/hooks/use-unsaved-changes-guard';
import { UnsavedChangesAlert } from '@/components/shared/UnsavedChangesAlert';
import { extractFxFromUnits } from '@/lib/fx-utils';
import { TransactionType } from '@/lib/enums';
import { preparePayload } from '@/lib/transaction-payload';
import type { TransactionListItem } from '@/api/types';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  transaction: TransactionListItem | null;
}

export function EditBuyDialog({ open, onOpenChange, transaction }: Props) {
  const { t } = useTranslation('transactions');
  const { t: tCommon } = useTranslation('common');
  const updateMutation = useUpdateTransaction();
  const { data: accounts = [] } = useAccounts();
  const { data: txDetail } = useTransactionDetail(open ? (transaction?.uuid ?? null) : null);
  const formRef = useRef<HTMLFormElement>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [isValid, setIsValid] = useState(false);
  const { guardedOpenChange, showDialog, setShowDialog, discard } =
    useUnsavedChangesGuard(isDirty, onOpenChange);

  // Reset dirty when transaction changes (sheet reopened with different row).
  useEffect(() => { setIsDirty(false); }, [transaction?.uuid]);

  // BUY ppxml2db convention: amount = gross + fees + taxes → gross = amount - fees - taxes.
  // Derive price = gross / shares for the form's shares + price decomposition.
  const initialValues = useMemo<Partial<TransactionFormValues> | undefined>(() => {
    if (!transaction || !txDetail) return undefined;
    const fx = extractFxFromUnits(txDetail.units);
    const feeUnit = txDetail.units?.find((u) => u.type === 'FEE');
    const taxUnit = txDetail.units?.find((u) => u.type === 'TAX');
    const feeAmount = feeUnit?.amount != null ? Math.abs(parseFloat(String(feeUnit.amount))) : 0;
    const taxAmount = taxUnit?.amount != null ? Math.abs(parseFloat(String(taxUnit.amount))) : 0;
    const sharesNum = transaction.shares != null ? parseFloat(String(transaction.shares)) : 0;
    const amountNum = transaction.amount != null ? parseFloat(String(transaction.amount)) : 0;
    const gross = amountNum - feeAmount - taxAmount;
    const priceStr = sharesNum > 0 ? String(gross / sharesNum) : '';

    const portfolio = accounts.find((a) => a.id === (transaction.account ?? ''));
    const crossAccountId = transaction.crossAccountId ?? portfolio?.referenceAccountId ?? '';

    return {
      date: transaction.date ?? undefined,
      securityId: transaction.security ?? transaction.securityId ?? undefined,
      accountId: transaction.account ?? undefined,
      crossAccountId: crossAccountId || undefined,
      shares: transaction.shares != null ? String(transaction.shares) : undefined,
      price: priceStr || undefined,
      fees: feeAmount > 0 ? String(feeAmount) : undefined,
      taxes: taxAmount > 0 ? String(taxAmount) : undefined,
      fxRate: fx.fxRate || undefined,
      feesFx: fx.feesFx || undefined,
      taxesFx: fx.taxesFx || undefined,
      note: transaction.note ?? undefined,
    };
  }, [transaction, txDetail, accounts]);

  const { run, inFlight } = useGuardedSubmit(async (values: TransactionFormValues) => {
    if (!transaction) return;
    try {
      await updateMutation.mutateAsync({ id: transaction.uuid, data: preparePayload(values) });
      toast.success(tCommon('toasts.transactionUpdated'));
      setIsDirty(false);
      onOpenChange(false);
    } catch {
      // serverError prop surfaces inline via TransactionForm; suppressGlobalErrorToast
      // is set on the mutation so the global toast does not double-fire.
    }
  });

  const saveDisabled = !isValid || inFlight || updateMutation.isPending;
  const formKey = transaction?.uuid ?? 'none';

  return (
    <>
      <Sheet open={open} onOpenChange={guardedOpenChange}>
        <SheetContent side="right" className="w-full sm:max-w-lg p-0 flex flex-col" showCloseButton>
          <SheetHeader className="px-6 pt-6 pb-2 shrink-0">
            <SheetTitle>{t('editTitles.buy')}</SheetTitle>
            <SheetDescription className="sr-only">{t('editTitles.buy')}</SheetDescription>
          </SheetHeader>

          <ScrollArea className="flex-1 min-h-0 px-6">
            {transaction && txDetail && (
              <TransactionForm
                key={formKey}
                type={TransactionType.BUY}
                initialValues={initialValues}
                onSubmit={run}
                isSubmitting={inFlight || updateMutation.isPending}
                hideSubmitButton
                formRef={formRef}
                serverError={updateMutation.error}
                onDirtyChange={setIsDirty}
                onValidityChange={setIsValid}
              />
            )}
            {transaction && !txDetail && (
              <div className="px-4 py-6 text-sm text-muted-foreground">{tCommon('loading')}</div>
            )}
          </ScrollArea>

          <SheetFooter className="border-t px-6 py-3 shrink-0 flex flex-row gap-2">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={() => guardedOpenChange(false)}
            >
              {tCommon('cancel')}
            </Button>
            <SubmitButton
              type="button"
              className="flex-1"
              mutation={{ isPending: inFlight || updateMutation.isPending }}
              disabled={saveDisabled}
              onClick={() => formRef.current?.requestSubmit()}
            >
              {tCommon('save')}
            </SubmitButton>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <UnsavedChangesAlert open={showDialog} onOpenChange={setShowDialog} onDiscard={discard} />
    </>
  );
}
