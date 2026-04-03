import { useState, useMemo, useRef } from 'react';
import { format, parse, isValid } from 'date-fns';
import { CalendarIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { TransactionType } from '@/lib/enums';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { useAccounts } from '@/api/use-accounts';
import { useSecurities } from '@/api/use-securities';
import { AddInstrumentDialog } from '@/components/domain/AddInstrumentDialog';
import { SecurityEditor } from '@/components/domain/SecurityEditor';
import { getDateLocale } from '@/lib/formatters';

interface FieldConfig {
  security: 'required' | 'optional' | false;
  shares: boolean;
  amount: boolean;
  price: boolean;
  fees: boolean;
  taxes: boolean;
  accountId: boolean;
  crossAccountId: boolean;
  note: boolean;
}

// Transaction types that require a portfolio (securities) account
const PORTFOLIO_ONLY_TYPES = new Set([
  TransactionType.BUY,
  TransactionType.SELL,
  TransactionType.DELIVERY_INBOUND,
  TransactionType.DELIVERY_OUTBOUND,
  TransactionType.SECURITY_TRANSFER,
]);

// Transaction types that only apply to deposit (cash) accounts
const CASH_ONLY_TYPES = new Set([
  TransactionType.DEPOSIT,
  TransactionType.REMOVAL,
  TransactionType.DIVIDEND,
  TransactionType.INTEREST,
  TransactionType.INTEREST_CHARGE,
  TransactionType.FEES,
  TransactionType.FEES_REFUND,
  TransactionType.TAXES,
  TransactionType.TAX_REFUND,
]);

const FIELD_CONFIG: Record<TransactionType, FieldConfig> = {
  [TransactionType.BUY]: { security: 'required', shares: true, amount: false, price: true, fees: true, taxes: true, accountId: true, crossAccountId: false, note: true },
  [TransactionType.SELL]: { security: 'required', shares: true, amount: false, price: true, fees: true, taxes: true, accountId: true, crossAccountId: false, note: true },
  [TransactionType.DELIVERY_INBOUND]: { security: 'required', shares: true, amount: false, price: true, fees: true, taxes: false, accountId: true, crossAccountId: false, note: true },
  [TransactionType.DELIVERY_OUTBOUND]: { security: 'required', shares: true, amount: false, price: true, fees: false, taxes: false, accountId: true, crossAccountId: false, note: true },
  [TransactionType.DEPOSIT]: { security: false, shares: false, amount: true, price: false, fees: false, taxes: false, accountId: true, crossAccountId: false, note: true },
  [TransactionType.REMOVAL]: { security: false, shares: false, amount: true, price: false, fees: false, taxes: false, accountId: true, crossAccountId: false, note: true },
  [TransactionType.DIVIDEND]: { security: 'optional', shares: false, amount: true, price: false, fees: true, taxes: true, accountId: true, crossAccountId: false, note: true },
  [TransactionType.INTEREST]: { security: false, shares: false, amount: true, price: false, fees: false, taxes: false, accountId: true, crossAccountId: false, note: true },
  [TransactionType.INTEREST_CHARGE]: { security: false, shares: false, amount: true, price: false, fees: false, taxes: false, accountId: true, crossAccountId: false, note: true },
  [TransactionType.FEES]: { security: 'optional', shares: false, amount: true, price: false, fees: false, taxes: false, accountId: true, crossAccountId: false, note: true },
  [TransactionType.FEES_REFUND]: { security: 'optional', shares: false, amount: true, price: false, fees: false, taxes: false, accountId: true, crossAccountId: false, note: true },
  [TransactionType.TAXES]: { security: false, shares: false, amount: true, price: false, fees: false, taxes: false, accountId: true, crossAccountId: false, note: true },
  [TransactionType.TAX_REFUND]: { security: false, shares: false, amount: true, price: false, fees: false, taxes: false, accountId: true, crossAccountId: false, note: true },
  [TransactionType.SECURITY_TRANSFER]: { security: 'required', shares: true, amount: false, price: false, fees: true, taxes: false, accountId: true, crossAccountId: true, note: true },
  [TransactionType.TRANSFER_BETWEEN_ACCOUNTS]: { security: false, shares: false, amount: true, price: false, fees: false, taxes: false, accountId: true, crossAccountId: true, note: true },
};

export interface TransactionFormValues {
  date: string;
  type: TransactionType;
  securityId?: string;
  shares?: string;
  amount?: string;
  price?: string;
  fees?: string;
  taxes?: string;
  accountId?: string;
  crossAccountId?: string;
  note?: string;
}

interface TransactionFormProps {
  type: TransactionType;
  initialValues?: Partial<TransactionFormValues>;
  onSubmit: (values: TransactionFormValues) => void;
  isSubmitting?: boolean;
  preselectedAccountId?: string;
  hideSubmitButton?: boolean;
  formRef?: React.Ref<HTMLFormElement>;
}

export function TransactionForm({ type, initialValues, onSubmit, isSubmitting, preselectedAccountId, hideSubmitButton, formRef }: TransactionFormProps) {
  const { t } = useTranslation('transactions');
  const cfg = FIELD_CONFIG[type];
  const { data: accounts = [] } = useAccounts();
  const { data: securities = [] } = useSecurities();
  const [addInstrumentOpen, setAddInstrumentOpen] = useState(false);
  const [createEmptyOpen, setCreateEmptyOpen] = useState(false);

  const filteredAccounts = useMemo(() => {
    if (PORTFOLIO_ONLY_TYPES.has(type)) return accounts.filter(a => a.type === 'portfolio');
    if (CASH_ONLY_TYPES.has(type)) return accounts.filter(a => a.type === 'account');
    return accounts;
  }, [accounts, type]);

  // Cross-account dropdown: SECURITY_TRANSFER → portfolio, TRANSFER_BETWEEN_ACCOUNTS → deposit
  const filteredCrossAccounts = useMemo(() => {
    if (type === TransactionType.SECURITY_TRANSFER) return accounts.filter(a => a.type === 'portfolio');
    if (type === TransactionType.TRANSFER_BETWEEN_ACCOUNTS) return accounts.filter(a => a.type === 'account');
    return accounts;
  }, [accounts, type]);

  const [date, setDate] = useState<Date>(
    initialValues?.date ? new Date(initialValues.date) : new Date()
  );
  const [dateText, setDateText] = useState<string>(() =>
    format(initialValues?.date ? new Date(initialValues.date) : new Date(), 'P', { locale: getDateLocale() })
  );
  const dateInputRef = useRef<HTMLInputElement>(null);
  const [time, setTime] = useState<string>(
    initialValues?.date && initialValues.date.length > 10
      ? initialValues.date.slice(11, 16)
      : '00:00'
  );
  const [calOpen, setCalOpen] = useState(false);
  const [fields, setFields] = useState<Omit<TransactionFormValues, 'date' | 'type'>>({
    securityId: initialValues?.securityId ?? '',
    shares: initialValues?.shares ?? '',
    amount: initialValues?.amount ?? '',
    price: initialValues?.price ?? '',
    fees: initialValues?.fees ?? '',
    taxes: initialValues?.taxes ?? '',
    accountId: initialValues?.accountId ?? preselectedAccountId ?? '',
    crossAccountId: initialValues?.crossAccountId ?? '',
    note: initialValues?.note ?? '',
  });

  function set(key: keyof typeof fields, value: string) {
    setFields((prev) => ({ ...prev, [key]: value }));
  }

  function handleInstrumentCreated(id: string) {
    setAddInstrumentOpen(false);
    setCreateEmptyOpen(false);
    set('securityId', id);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    // Required field validation
    if (cfg.security === 'required' && !fields.securityId) {
      toast.error(t('validation.securityRequired'));
      return;
    }
    if (cfg.shares && !fields.shares) {
      toast.error(t('validation.sharesRequired'));
      return;
    }
    if ((cfg.amount || cfg.price) && !fields.amount && !fields.price) {
      toast.error(t('validation.amountRequired'));
      return;
    }
    if (cfg.accountId && !fields.accountId) {
      toast.error(t('validation.accountRequired'));
      return;
    }
    if (cfg.crossAccountId && !fields.crossAccountId) {
      toast.error(t('validation.targetRequired'));
      return;
    }

    onSubmit({
      type,
      date: format(date, 'yyyy-MM-dd') + 'T' + time,
      ...fields,
    });
  }

  const showSharesAndPrice = cfg.shares && cfg.price;
  const showFeesAndTaxes = cfg.fees && cfg.taxes;

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="space-y-3">
      {/* Date & Time */}
      <div className="space-y-1">
        <Label>{t('form.dateTime')}</Label>
        <div className="flex gap-2">
          <Popover open={calOpen} onOpenChange={setCalOpen}>
            <div className="relative flex-1">
              <Input
                ref={dateInputRef}
                value={dateText}
                onChange={(e) => {
                  setDateText(e.target.value);
                  const locale = getDateLocale();
                  const parsed = parse(e.target.value, 'P', new Date(), { locale });
                  if (isValid(parsed) && parsed.getFullYear() >= 1900 && parsed.getFullYear() <= 2100) {
                    setDate(parsed);
                  }
                }}
                onBlur={() => {
                  setDateText(format(date, 'P', { locale: getDateLocale() }));
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    setDateText(format(date, 'P', { locale: getDateLocale() }));
                    dateInputRef.current?.blur();
                  }
                }}
                className="pr-9"
                placeholder={format(new Date(), 'P', { locale: getDateLocale() })}
              />
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute right-0 top-0 h-full w-9 rounded-l-none"
                  type="button"
                >
                  <CalendarIcon className="h-4 w-4" />
                </Button>
              </PopoverTrigger>
            </div>
            <PopoverContent className="w-auto p-0">
              <Calendar
                mode="single"
                selected={date}
                onSelect={(d) => {
                  if (d) {
                    setDate(d);
                    setDateText(format(d, 'P', { locale: getDateLocale() }));
                    setCalOpen(false);
                  }
                }}
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

      {/* Security */}
      {cfg.security !== false && (
        <div className="space-y-1">
          <Label>{t('form.security')} {cfg.security === 'optional' ? t('common:optional') : ''}</Label>
          <Select value={fields.securityId} onValueChange={(v) => {
            if (v === '__create_new__') {
              setAddInstrumentOpen(true);
              return;
            }
            set('securityId', v);
          }}>
            <SelectTrigger>
              <SelectValue placeholder={t('form.selectSecurity')} />
            </SelectTrigger>
            <SelectContent>
              {securities.map((s) => (
                <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
              ))}
              {securities.length > 0 && <Separator className="my-1" />}
              <SelectItem value="__create_new__" className="text-primary font-medium">
                {t('form.createNewInstrument')}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Shares + Price side-by-side when both visible */}
      {showSharesAndPrice ? (
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label>{t('columns.shares')}</Label>
            <Input
              type="number"
              step="any"
              value={fields.shares}
              onChange={(e) => set('shares', e.target.value)}
              placeholder="0.00"
            />
          </div>
          <div className="space-y-1">
            <Label>{t('form.pricePerShare')}</Label>
            <Input
              type="number"
              step="any"
              value={fields.price}
              onChange={(e) => set('price', e.target.value)}
              placeholder="0.00"
            />
          </div>
        </div>
      ) : (
        <>
          {cfg.shares && (
            <div className="space-y-1">
              <Label>{t('columns.shares')}</Label>
              <Input
                type="number"
                step="any"
                value={fields.shares}
                onChange={(e) => set('shares', e.target.value)}
                placeholder="0.00"
              />
            </div>
          )}
          {cfg.price && (
            <div className="space-y-1">
              <Label>{t('form.pricePerShare')}</Label>
              <Input
                type="number"
                step="any"
                value={fields.price}
                onChange={(e) => set('price', e.target.value)}
                placeholder="0.00"
              />
            </div>
          )}
        </>
      )}

      {/* Amount */}
      {cfg.amount && (
        <div className="space-y-1">
          <Label>{t('form.amount')}</Label>
          <Input
            type="number"
            step="any"
            value={fields.amount}
            onChange={(e) => set('amount', e.target.value)}
            placeholder="0.00"
          />
        </div>
      )}

      {/* Fees + Taxes side-by-side when both visible */}
      {showFeesAndTaxes ? (
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label>{t('form.feesOptional')}</Label>
            <Input
              type="number"
              step="any"
              value={fields.fees}
              onChange={(e) => set('fees', e.target.value)}
              placeholder="0.00"
            />
          </div>
          <div className="space-y-1">
            <Label>{t('form.taxesOptional')}</Label>
            <Input
              type="number"
              step="any"
              value={fields.taxes}
              onChange={(e) => set('taxes', e.target.value)}
              placeholder="0.00"
            />
          </div>
        </div>
      ) : (
        <>
          {cfg.fees && (
            <div className="space-y-1">
              <Label>{t('form.feesOptional')}</Label>
              <Input
                type="number"
                step="any"
                value={fields.fees}
                onChange={(e) => set('fees', e.target.value)}
                placeholder="0.00"
              />
            </div>
          )}
          {cfg.taxes && (
            <div className="space-y-1">
              <Label>{t('form.taxesOptional')}</Label>
              <Input
                type="number"
                step="any"
                value={fields.taxes}
                onChange={(e) => set('taxes', e.target.value)}
                placeholder="0.00"
              />
            </div>
          )}
        </>
      )}

      {/* Account */}
      {cfg.accountId && (
        <div className="space-y-1">
          <Label>{cfg.crossAccountId ? t('form.fromAccount') : t('form.account')}</Label>
          <Select
            value={fields.accountId}
            onValueChange={(v) => set('accountId', v)}
            disabled={!!preselectedAccountId}
          >
            <SelectTrigger>
              <SelectValue placeholder={t('form.selectAccount')} />
            </SelectTrigger>
            <SelectContent>
              {filteredAccounts.map((a) => (
                <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Cross Account */}
      {cfg.crossAccountId && (
        <div className="space-y-1">
          <Label>{t('form.toAccount')}</Label>
          <Select value={fields.crossAccountId} onValueChange={(v) => set('crossAccountId', v)}>
            <SelectTrigger>
              <SelectValue placeholder={t('form.selectAccount')} />
            </SelectTrigger>
            <SelectContent>
              {filteredCrossAccounts.map((a) => (
                <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Note */}
      {cfg.note && (
        <div className="space-y-1">
          <Label>{t('form.noteOptional')}</Label>
          <Input
            value={fields.note}
            onChange={(e) => set('note', e.target.value)}
            placeholder={t('form.noteOptionalPlaceholder')}
          />
        </div>
      )}

      {!hideSubmitButton && (
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? t('common:saving') : t('common:save')}
        </Button>
      )}

      {/* Add Instrument Dialog — opened from security selector */}
      {cfg.security !== false && (
        <>
          <AddInstrumentDialog
            open={addInstrumentOpen}
            onOpenChange={setAddInstrumentOpen}
            onCreated={handleInstrumentCreated}
            onCreateEmpty={() => {
              setAddInstrumentOpen(false);
              setCreateEmptyOpen(true);
            }}
          />
          {createEmptyOpen && (
            <SecurityEditor
              mode="create"
              open={createEmptyOpen}
              onOpenChange={(open) => { if (!open) setCreateEmptyOpen(false); }}
              onCreated={handleInstrumentCreated}
            />
          )}
        </>
      )}
    </form>
  );
}
