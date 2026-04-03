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

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  transaction: TransactionListItem | null;
}

export function EditDeliveryDialog({ open, onOpenChange, transaction }: Props) {
  const { t } = useTranslation('transactions');
  const { data: accounts = [] } = useAccounts();
  const { data: securities = [] } = useSecurities();
  const updateMutation = useUpdateTransaction();

  const portfolioAccounts = accounts.filter((a) => a.type === 'portfolio');
  const title = transaction?.type
    ? t('editTitles.' + txTypeKey(transaction.type))
    : '';

  const [accountId, setAccountId] = useState('');
  const [securityId, setSecurityId] = useState('');
  const [date, setDate] = useState<Date>(new Date());
  const [time, setTime] = useState<string>('00:00');
  const [calOpen, setCalOpen] = useState(false);
  const [shares, setShares] = useState('');
  const [price, setPrice] = useState('');
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
    const sharesVal = transaction.shares ? Math.abs(parseFloat(transaction.shares)).toString() : '';
    setShares(sharesVal);
    // ppxml2db convention: DELIVERY_INBOUND amount = gross + fees + taxes
    // DELIVERY_OUTBOUND amount = gross - fees - taxes
    // Reconstruct gross to derive price per share
    const netAmount = parseFloat(transaction.amount ?? '0');
    const isOutflow = transaction.type === 'DELIVERY_INBOUND';
    const grossAmount = isOutflow ? netAmount : netAmount; // no fees/taxes on deliveries typically
    if (grossAmount > 0 && sharesVal && parseFloat(sharesVal) > 0) {
      const priceVal = grossAmount / parseFloat(sharesVal);
      setPrice(priceVal.toFixed(4));
    } else {
      setPrice('');
    }
    setNote(transaction.note ?? '');
    setIsDirty(false);
    setError(null);
  }, [transaction]);

  function handleSave() {
    if (!transaction) return;
    if (!accountId) { setError(t('validation.selectPortfolioAccount')); return; }
    if (!securityId) { setError(t('validation.selectSecurity')); return; }
    const sharesNum = parseFloat(shares);
    if (!shares || isNaN(sharesNum) || sharesNum <= 0) { setError(t('validation.sharesMustBePositive')); return; }

    const priceNum = price ? parseFloat(price) : 0;
    const amount = priceNum > 0 ? sharesNum * priceNum : 0;

    setError(null);
    updateMutation.mutate(
      {
        id: transaction.uuid,
        data: {
          type: transaction.type as never,
          accountId,
          securityId,
          date: format(date, 'yyyy-MM-dd') + 'T' + time,
          shares: sharesNum,
          amount,
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

  const selectedAccount = portfolioAccounts.find((a) => a.id === accountId);
  const currency = selectedAccount?.currency ?? transaction?.currencyCode ?? 'EUR';
  const sharesNum = parseFloat(shares);
  const priceNum = parseFloat(price);
  const marketValue = !isNaN(sharesNum) && !isNaN(priceNum) ? (sharesNum * priceNum).toFixed(2) : '—';

  return (
    <>
      <Sheet open={open} onOpenChange={guardedOpenChange}>
        <SheetContent
          side="right"
          className="w-full sm:max-w-lg p-0 flex flex-col"
          showCloseButton={true}
        >
          <SheetHeader className="px-6 pt-6 pb-2 shrink-0">
            <SheetTitle>{title}</SheetTitle>
            <SheetDescription className="sr-only">
              {title}
            </SheetDescription>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto px-6 min-h-0">
            <div className="space-y-4 py-2">
              {/* Portfolio Account */}
              <div className="space-y-1">
                <Label>{t('form.securitiesAccount')}</Label>
                <Select value={accountId} onValueChange={(v) => { setAccountId(v); setIsDirty(true); }}>
                  <SelectTrigger>
                    <SelectValue placeholder={t('form.selectAccount')} />
                  </SelectTrigger>
                  <SelectContent>
                    {portfolioAccounts.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Security */}
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

              {/* Shares */}
              <div className="space-y-1">
                <Label>{t('columns.shares')}</Label>
                <Input
                  type="number"
                  step="any"
                  min="0"
                  value={shares}
                  onChange={(e) => { setShares(e.target.value); setIsDirty(true); }}
                  placeholder="0"
                />
              </div>

              {/* Price per share (optional) */}
              <div className="space-y-1">
                <Label>{t('form.pricePerShareOptional')}</Label>
                <div className="flex gap-2 items-center">
                  <Input
                    type="number"
                    step="any"
                    min="0"
                    value={price}
                    onChange={(e) => { setPrice(e.target.value); setIsDirty(true); }}
                    placeholder="0.00"
                    className="flex-1"
                  />
                  <span className="text-sm text-muted-foreground w-10">{currency}</span>
                </div>
                {price && shares && (
                  <p className="text-xs text-muted-foreground">{t('form.marketValue')} {marketValue} {currency}</p>
                )}
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
