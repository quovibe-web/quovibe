import { useState, useMemo, useRef, useEffect } from 'react';
import { SecurityAvatar } from '@/components/shared/SecurityAvatar';
import { AccountAvatar } from '@/components/shared/AccountAvatar';
import { format, parse, isValid } from 'date-fns';
import { CalendarIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { TransactionType } from '@/lib/enums';
import { Button } from '@/components/ui/button';
import { SubmitButton } from '@/components/shared/SubmitButton';
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
import { useFxRate } from '@/api/use-fx';
import { computeFxAmounts } from '@/lib/fx-utils';
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

// Transaction types that use a portfolio + deposit (cash) cross-account
const BUY_SELL_TYPES = new Set([TransactionType.BUY, TransactionType.SELL]);

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
  [TransactionType.BUY]: { security: 'required', shares: true, amount: false, price: true, fees: true, taxes: true, accountId: true, crossAccountId: true, note: true },
  [TransactionType.SELL]: { security: 'required', shares: true, amount: false, price: true, fees: true, taxes: true, accountId: true, crossAccountId: true, note: true },
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
  fxRate?: string;
  fxCurrencyCode?: string;
  currencyCode?: string;
  feesFx?: string;
  taxesFx?: string;
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

  // Cross-account dropdown: SECURITY_TRANSFER → portfolio, TRANSFER_BETWEEN_ACCOUNTS / BUY / SELL → deposit
  const filteredCrossAccounts = useMemo(() => {
    if (type === TransactionType.SECURITY_TRANSFER) return accounts.filter(a => a.type === 'portfolio');
    if (type === TransactionType.TRANSFER_BETWEEN_ACCOUNTS) return accounts.filter(a => a.type === 'account');
    if (BUY_SELL_TYPES.has(type)) return accounts.filter(a => a.type === 'account');
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

  // Auto-populate crossAccountId from the portfolio's referenceAccount on BUY/SELL
  useEffect(() => {
    if (!BUY_SELL_TYPES.has(type)) return;
    if (fields.crossAccountId) return; // already set
    const portfolio = accounts.find(a => a.id === fields.accountId);
    if (portfolio?.referenceAccountId) {
      set('crossAccountId', portfolio.referenceAccountId);
    }
  }, [fields.accountId, fields.crossAccountId, accounts, type]);

  // Detect cross-currency: compare security currency vs cash account currency
  const selectedSecurity = securities.find(s => s.id === fields.securityId);
  const selectedCashAccount = filteredCrossAccounts.find(a => a.id === fields.crossAccountId);
  const securityCurrency = selectedSecurity?.currency ?? null;
  const cashCurrency = selectedCashAccount?.currency ?? null;
  const isCrossCurrency = !!(securityCurrency && cashCurrency && securityCurrency !== cashCurrency);

  // Fetch exchange rate when cross-currency (deposit->security convention)
  const fxDateStr = format(date, 'yyyy-MM-dd');
  const { data: fxData } = useFxRate(
    isCrossCurrency ? cashCurrency : null,
    isCrossCurrency ? securityCurrency : null,
    isCrossCurrency ? fxDateStr : null,
  );

  // Auto-fill fxRate from API; intentionally omits fields.fxRate from deps to avoid overwriting user edits
  useEffect(() => {
    if (isCrossCurrency && fxData?.rate && !fields.fxRate) {
      set('fxRate', fxData.rate);
    }
  }, [fxData?.rate, isCrossCurrency]); // eslint-disable-line react-hooks/exhaustive-deps

  // Computed FX amounts
  const fxRateVal = fields.fxRate ? parseFloat(fields.fxRate) : 0;
  const grossSecurity = (parseFloat(fields.shares || '0') || 0) * (parseFloat(fields.price || '0') || 0);
  const feesFxNum = parseFloat(fields.feesFx || '0') || 0;
  const taxesFxNum = parseFloat(fields.taxesFx || '0') || 0;
  const fx = computeFxAmounts({
    isCrossCurrency, fxRate: fxRateVal, grossSecurity,
    feesFx: feesFxNum, taxesFx: taxesFxNum,
    feesDeposit: parseFloat(fields.fees || '0') || 0,
    taxesDeposit: parseFloat(fields.taxes || '0') || 0,
  });

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

    const fxFields: Partial<TransactionFormValues> = {};
    if (isCrossCurrency && fields.fxRate) {
      fxFields.fxRate = fields.fxRate;
      fxFields.fxCurrencyCode = securityCurrency ?? undefined;
      fxFields.currencyCode = cashCurrency ?? undefined;
    }

    onSubmit({
      type,
      date: format(date, 'yyyy-MM-dd') + 'T' + time,
      ...fields,
      ...fxFields,
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
                <SelectItem key={s.id} value={s.id}>
                  <div className="flex items-center gap-2">
                    <SecurityAvatar name={s.name ?? ''} logoUrl={s.logoUrl} size="xs" />
                    <span>{s.name}</span>
                  </div>
                </SelectItem>
              ))}
              {securities.length > 0 && <Separator className="my-1" />}
              <SelectItem value="__create_new__" className="text-primary font-medium">
                {t('form.createNewInstrument')}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Account */}
      {cfg.accountId && (
        <div className="space-y-1">
          <Label>
            {BUY_SELL_TYPES.has(type)
              ? t('form.securitiesAccount')
              : cfg.crossAccountId
                ? t('form.fromAccount')
                : t('form.account')}
          </Label>
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
                <SelectItem key={a.id} value={a.id}>
                  <div className="flex items-center gap-2">
                    <AccountAvatar name={a.name} logoUrl={a.logoUrl} size="xs" />
                    <span>{a.name}</span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Cross Account */}
      {cfg.crossAccountId && (
        <div className="space-y-1">
          <Label>
            {BUY_SELL_TYPES.has(type) ? t('form.cashAccount') : t('form.toAccount')}
          </Label>
          <Select value={fields.crossAccountId} onValueChange={(v) => set('crossAccountId', v)}>
            <SelectTrigger>
              <SelectValue placeholder={t('form.selectAccount')} />
            </SelectTrigger>
            <SelectContent>
              {filteredCrossAccounts.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  <div className="flex items-center gap-2">
                    <AccountAvatar name={a.name} logoUrl={a.logoUrl} size="xs" />
                    <span>{a.name}</span>
                  </div>
                </SelectItem>
              ))}
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

      {/* Fees + Taxes side-by-side when both visible (hidden when FX section is showing) */}
      {!(BUY_SELL_TYPES.has(type) && isCrossCurrency) && (
        <>
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
        </>
      )}

      {/* FX Section — cross-currency BUY/SELL only */}
      {BUY_SELL_TYPES.has(type) && isCrossCurrency && (
        <div className="rounded-md border bg-muted/30 p-3 space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">
              {t('form.grossInSecurityCcy', { ccy: securityCurrency })}
            </span>
            <span className="font-medium">{grossSecurity.toFixed(2)} {securityCurrency}</span>
          </div>

          <div className="space-y-1">
            <Label>{t('form.exchangeRate')} ({cashCurrency}/{securityCurrency})</Label>
            <Input
              type="number"
              step="any"
              value={fields.fxRate ?? ''}
              onChange={(e) => set('fxRate', e.target.value)}
              placeholder={t('form.fxRatePlaceholder')}
            />
          </div>

          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">
              {t('form.convertedGross', { ccy: cashCurrency })}
            </span>
            <span className="font-medium">{fx.grossDeposit.toFixed(2)} {cashCurrency}</span>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>{t('form.feesInCcy', { ccy: securityCurrency })}</Label>
              <Input type="number" step="any" value={fields.feesFx ?? ''} onChange={(e) => set('feesFx', e.target.value)} placeholder="0.00" />
            </div>
            <div className="space-y-1">
              <Label>{t('form.feesInCcy', { ccy: cashCurrency })}</Label>
              <Input type="number" step="any" value={fields.fees ?? ''} onChange={(e) => set('fees', e.target.value)} placeholder="0.00" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>{t('form.taxesInCcy', { ccy: securityCurrency })}</Label>
              <Input type="number" step="any" value={fields.taxesFx ?? ''} onChange={(e) => set('taxesFx', e.target.value)} placeholder="0.00" />
            </div>
            <div className="space-y-1">
              <Label>{t('form.taxesInCcy', { ccy: cashCurrency })}</Label>
              <Input type="number" step="any" value={fields.taxes ?? ''} onChange={(e) => set('taxes', e.target.value)} placeholder="0.00" />
            </div>
          </div>
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
        <SubmitButton type="submit" mutation={{ isPending: !!isSubmitting }}>
          {t('common:save')}
        </SubmitButton>
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
