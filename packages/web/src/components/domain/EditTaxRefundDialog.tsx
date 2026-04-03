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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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

const NONE = '__none__';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  transaction: TransactionListItem | null;
}

export function EditTaxRefundDialog({ open, onOpenChange, transaction }: Props) {
  const { t } = useTranslation('transactions');
  const { data: accounts = [] } = useAccounts();
  const { data: securities = [] } = useSecurities();
  const updateMutation = useUpdateTransaction();

  const cashAccounts = accounts.filter((a) => a.type === 'account');
  const [securityId, setSecurityId] = useState(NONE);
  const [accountId, setAccountId] = useState('');
  const [date, setDate] = useState<Date>(new Date());
  const [time, setTime] = useState<string>('00:00');
  const [calOpen, setCalOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');

  useEffect(() => {
    if (!transaction) return;
    setSecurityId(transaction.security ?? transaction.securityId ?? NONE);
    setAccountId(transaction.account ?? '');
    setDate(transaction.date ? new Date(transaction.date) : new Date());
    setTime(transaction.date && transaction.date.length > 10 ? transaction.date.slice(11, 16) : '00:00');
    setAmount(transaction.amount ?? '');
    setNote(transaction.note ?? '');
  }, [transaction]);

  const selectedAccount = cashAccounts.find((a) => a.id === accountId);
  const currency = selectedAccount?.currency ?? transaction?.currencyCode ?? 'EUR';

  function handleSave() {
    if (!transaction) return;
    if (!accountId) { toast.error(t('validation.selectAccount')); return; }
    const amtNum = parseFloat(amount);
    if (!amount || isNaN(amtNum) || amtNum < 0) { toast.error(t('validation.invalidAmount')); return; }

    updateMutation.mutate(
      {
        id: transaction.uuid,
        data: {
          type: 'TAX_REFUND',
          securityId: securityId !== NONE ? securityId : undefined,
          accountId,
          date: format(date, 'yyyy-MM-dd') + 'T' + time,
          amount: amtNum,
          note: note || undefined,
        },
      },
      {
        onSuccess: () => {
          toast.success(t('common:toasts.transactionUpdated'));
          onOpenChange(false);
        },
        onError: () => {
          toast.error(t('common:toasts.errorSaving'));
        },
      }
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('editTitles.taxRefund')}</DialogTitle>
          <DialogDescription className="sr-only">
            {t('editTitles.taxRefundDescription')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Security (optional) */}
          <div className="space-y-1">
            <Label>{t('form.security')}</Label>
            <Select value={securityId} onValueChange={setSecurityId}>
              <SelectTrigger autoFocus>
                <SelectValue placeholder={t('form.selectSecurity')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>{t('form.noSecurity')}</SelectItem>
                {securities.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Cash Account */}
          <div className="space-y-1">
            <Label>{t('form.cashAccount')}</Label>
            <Select value={accountId} onValueChange={setAccountId}>
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
                    onSelect={(d) => { if (d) { setDate(d); setCalOpen(false); } }}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
              <Input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="w-28"
              />
            </div>
          </div>

          {/* Credit Note (amount) */}
          <div className="space-y-1">
            <Label>{t('form.creditNote')}</Label>
            <div className="flex gap-2 items-center">
              <Input
                type="number"
                step="any"
                min="0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
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
              onChange={(e) => setNote(e.target.value)}
              placeholder={t('form.noteOptionalPlaceholder')}
              rows={3}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common:cancel')}
          </Button>
          <Button onClick={handleSave} disabled={updateMutation.isPending}>
            {updateMutation.isPending ? t('common:saving') : t('common:save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
