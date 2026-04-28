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

export function EditTransferDialog({ open, onOpenChange, transaction }: Props) {
  const { t } = useTranslation('transactions');
  const { t: tCommon } = useTranslation('common');
  const updateMutation = useUpdateTransaction();
  const { data: txDetail } = useTransactionDetail(open ? (transaction?.uuid ?? null) : null);
  const formRef = useRef<HTMLFormElement>(null);
  const [isDirty, setIsDirty] = useState(false);
  const { guardedOpenChange, showDialog, setShowDialog, discard } =
    useUnsavedChangesGuard(isDirty, onOpenChange);

  // Reset dirty when transaction changes (sheet reopened with different row).
  useEffect(() => { setIsDirty(false); }, [transaction?.uuid]);

  const initialValues = useMemo<Partial<TransactionFormValues> | undefined>(() => {
    if (!transaction) return undefined;
    const fx = extractFxFromUnits(txDetail?.units);
    return {
      date: transaction.date ?? undefined,
      accountId: transaction.account ?? undefined,
      crossAccountId: transaction.crossAccountId ?? undefined,
      amount: transaction.amount ?? undefined,
      note: transaction.note ?? undefined,
      fxRate: fx.fxRate || undefined,
    };
  }, [transaction, txDetail]);

  const { run, inFlight } = useGuardedSubmit(async (values: TransactionFormValues) => {
    if (!transaction) return;
    try {
      await updateMutation.mutateAsync({
        id: transaction.uuid,
        data: preparePayload(values),
      });
      toast.success(tCommon('toasts.transactionUpdated'));
      setIsDirty(false);
      onOpenChange(false);
    } catch {
      // serverError prop surfaces inline via TransactionForm; suppressGlobalErrorToast
      // is set on the mutation so the global toast does not double-fire.
    }
  });

  // Key the form on both uuid and whether txDetail has loaded. This ensures
  // RHF receives the correct fxRate default when detail arrives asynchronously
  // (cross-currency transfers need the stored rate to pre-populate the field).
  const formKey = `${transaction?.uuid ?? 'none'}:${txDetail ? '1' : '0'}`;

  return (
    <>
      <Sheet open={open} onOpenChange={guardedOpenChange}>
        <SheetContent side="right" className="w-full sm:max-w-lg p-0 flex flex-col" showCloseButton>
          <SheetHeader className="px-6 pt-6 pb-2 shrink-0">
            <SheetTitle>{t('editTitles.transferBetweenAccounts')}</SheetTitle>
            <SheetDescription className="sr-only">
              {t('editTitles.transferBetweenAccounts')}
            </SheetDescription>
          </SheetHeader>

          <ScrollArea className="flex-1 min-h-0 px-6">
            {transaction && (
              <TransactionForm
                key={formKey}
                type={TransactionType.TRANSFER_BETWEEN_ACCOUNTS}
                initialValues={initialValues}
                onSubmit={run}
                isSubmitting={inFlight || updateMutation.isPending}
                hideSubmitButton
                formRef={formRef}
                serverError={updateMutation.error}
                onDirtyChange={setIsDirty}
              />
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
