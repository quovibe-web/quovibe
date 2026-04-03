import { useState, useEffect } from 'react';
import { format } from 'date-fns';
import { CalendarIcon } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAccounts } from '@/api/use-accounts';
import { useSecurities } from '@/api/use-securities';
import { useUpdateTransaction } from '@/api/use-transactions';
import type { TransactionListItem } from '@/api/types';
import { getDateLocale } from '@/lib/formatters';
import { txTypeKey } from '@/lib/utils';
import { useUnsavedChangesGuard } from '@/hooks/use-unsaved-changes-guard';
import { UnsavedChangesAlert } from '@/components/shared/UnsavedChangesAlert';

// Types that use "Credit Note" (incoming money)
const CREDIT_NOTE_TYPES = new Set(['DEPOSIT', 'DIVIDEND', 'INTEREST', 'FEES_REFUND']);

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  transaction: TransactionListItem | null;
}

export function EditCashDialog({ open, onOpenChange, transaction }: Props) {
  const { t } = useTranslation('transactions');
  const { data: accounts = [] } = useAccounts();
  const { data: securities = [] } = useSecurities();
  const updateMutation = useUpdateTransaction();

  const cashAccounts = accounts.filter((a) => a.type === 'account');
  const hasSecurity = transaction?.type === 'DIVIDEND';
  const amountLabel = transaction && CREDIT_NOTE_TYPES.has(transaction.type)
    ? t('form.creditNote')
    : t('form.debitNote');

  const [accountId, setAccountId] = useState('');
  const [securityId, setSecurityId] = useState('');
  const [date, setDate] = useState<Date>(new Date());
  const [time, setTime] = useState<string>('00:00');
  const [calOpen, setCalOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [isDirty, setIsDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { guardedOpenChange, showDialog, setShowDialog, discard } =
    useUnsavedChangesGuard(isDirty, onOpenChange);

  useEffect(() => {
    if (!transaction) return;
    setAccountId(transaction.account ?? '');
    setSecurityId(transaction.security ?? transaction.securityId ?? '');
    setDate(transaction.date ? new Date(transaction.date) : new Date());
    setTime(transaction.date && transaction.date.length > 10 ? transaction.date.slice(11, 16) : '00:00');
    setAmount(transaction.amount ?? '');
    setNote(transaction.note ?? '');
    setIsDirty(false);
    setError(null);
  }, [transaction]);

  const selectedAccount = cashAccounts.find((a) => a.id === accountId);
  const currency = selectedAccount?.currency ?? transaction?.currencyCode ?? 'EUR';

  function handleSave() {
    if (!transaction) return;
    if (!accountId) { setError(t('validation.selectAccount')); return; }
    if (hasSecurity && !securityId) { setError(t('validation.selectSecurity')); return; }
    const amtNum = parseFloat(amount);
    if (!amount || isNaN(amtNum) || amtNum < 0) { setError(t('validation.invalidAmount')); return; }

    setError(null);
    updateMutation.mutate(
      {
        id: transaction.uuid,
        data: {
          type: transaction.type as never,
          accountId,
          date: format(date, 'yyyy-MM-dd') + 'T' + time,
          amount: amtNum,
          securityId: hasSecurity ? securityId : undefined,
          note: note || undefined,
        },
      },
      {
        onSuccess: () => {
          toast.success(t('common:toasts.transactionUpdated'));
          setIsDirty(false);
          onOpenChange(false);
        },
        onError: () => {
          setError(t('common:toasts.errorSaving'));
        },
      }
    );
  }

  const dialogTitle = transaction?.type
    ? t('editTitles.' + txTypeKey(transaction.type))
    : '';

  return (
    <>
      <Sheet open={open} onOpenChange={guardedOpenChange}>
        <SheetContent
          side="right"
          className="w-full sm:max-w-lg p-0 flex flex-col"
          showCloseButton={true}
        >
          <SheetHeader className="px-6 pt-6 pb-2 shrink-0">
            <SheetTitle>{dialogTitle}</SheetTitle>
            <SheetDescription className="sr-only">
              {dialogTitle}
            </SheetDescription>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto px-6 min-h-0">
            <div className="space-y-4 py-2">
              {/* Security — only for DIVIDEND */}
              {hasSecurity && (
                <div className="space-y-1">
                  <Label>{t('form.security')}</Label>
                  <Select value={securityId} onValueChange={(v) => { setSecurityId(v); setIsDirty(true); }}>
                    <SelectTrigger>
                      <SelectValue placeholder={t('form.selectSecurity')} />
                    </SelectTrigger>
                    <SelectContent>
                      {securities.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Cash Account */}
              <div className="space-y-1">
                <Label>{t('form.cashAccount')}</Label>
                <Select value={accountId} onValueChange={(v) => { setAccountId(v); setIsDirty(true); }}>
                  <SelectTrigger>
                    <SelectValue placeholder={t('form.selectAccount')} />
                  </SelectTrigger>
                  <SelectContent>
                    {cashAccounts.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.name} ({a.currency})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Date */}
              <div className="space-y-1">
                <Label>{t('common:date')}</Label>
                <div className="flex items-center gap-2">
                  <Popover open={calOpen} onOpenChange={setCalOpen}>
                    <PopoverTrigger asChild>
                      <Button variant="outline" className="flex-1 justify-start">
                        <CalendarIcon className="h-4 w-4 mr-2" />
                        {format(date, 'P', { locale: getDateLocale() })}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0">
                      <Calendar
                        mode="single"
                        selected={date}
                        onSelect={(d) => { if (d) { setDate(d); setIsDirty(true); setCalOpen(false); } }}
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>
                  <Input
                    type="time"
                    value={time}
                    onChange={(e) => { setTime(e.target.value); setIsDirty(true); }}
                    className="w-28"
                  />
                </div>
              </div>

              {/* Amount */}
              <div className="space-y-1">
                <Label>{amountLabel}</Label>
                <div className="flex gap-2 items-center">
                  <Input
                    type="number"
                    step="any"
                    min="0"
                    value={amount}
                    onChange={(e) => { setAmount(e.target.value); setIsDirty(true); }}
                    placeholder="0.00"
                    className="flex-1"
                  />
                  <span className="text-sm text-muted-foreground w-10">{currency}</span>
                </div>
              </div>

              {/* Note */}
              <div className="space-y-1">
                <Label>{t('common:note')}</Label>
                <Textarea
                  value={note}
                  onChange={(e) => { setNote(e.target.value); setIsDirty(true); }}
                  placeholder={t('form.noteOptionalPlaceholder')}
                  rows={3}
                />
              </div>
            </div>
            <div className="h-4" />
          </div>

          {error && (
            <p className="text-sm text-destructive px-6 py-1 shrink-0">{error}</p>
          )}

          <SheetFooter className="border-t px-6 py-3 shrink-0 flex flex-row gap-2">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={() => guardedOpenChange(false)}
            >
              {t('common:cancel')}
            </Button>
            <Button
              type="button"
              className="flex-1"
              onClick={handleSave}
              disabled={updateMutation.isPending}
            >
              {updateMutation.isPending ? t('common:saving') : t('common:save')}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <UnsavedChangesAlert
        open={showDialog}
        onOpenChange={setShowDialog}
        onDiscard={discard}
      />
    </>
  );
}
