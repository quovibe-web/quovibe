import { useState, useMemo, useRef, useEffect, useId } from 'react';
import { useForm, useWatch, type Resolver } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { SecurityAvatar } from '@/components/shared/SecurityAvatar';
import { AccountAvatar } from '@/components/shared/AccountAvatar';
import { format, parse, isValid } from 'date-fns';
import { CalendarIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { TransactionType } from '@/lib/enums';
import { CASH_ONLY_ROUTED_TYPES, PRICED_SHARE_TYPES } from '@quovibe/shared';
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
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { useAccounts } from '@/api/use-accounts';
import { useSecurities } from '@/api/use-securities';
import { useFxRate } from '@/api/use-fx';
import { computeFxAmounts } from '@/lib/fx-utils';
import { AddInstrumentDialog } from '@/components/domain/AddInstrumentDialog';
import { SecurityEditor } from '@/components/domain/SecurityEditor';
import { getDateLocale } from '@/lib/formatters';
import {
  buildTransactionFormSchema,
  type TransactionFormShape,
} from './transaction-form.schema';
import { extractServerFieldErrors } from './transaction-server-error';

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

// Transaction types tied to a portfolio (securities) account. Aliases the
// shared PRICED_SHARE_TYPES set — both name BUY/SELL/DELIVERY_*/SECURITY_TRANSFER.
const PORTFOLIO_ONLY_TYPES = PRICED_SHARE_TYPES;

const BUY_SELL_TYPES = new Set([TransactionType.BUY, TransactionType.SELL]);

// Cash-only types (deposit account). Aliases the shared
// CASH_ONLY_ROUTED_TYPES set — same membership.
const CASH_ONLY_TYPES = CASH_ONLY_ROUTED_TYPES;

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
  [TransactionType.SECURITY_TRANSFER]: { security: 'required', shares: true, amount: false, price: true, fees: true, taxes: false, accountId: true, crossAccountId: true, note: true },
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
  // The mutation error from `useCreateTransaction` / `useUpdateTransaction`,
  // passed through verbatim. The form parses field-tagged Zod issues out of
  // it and surfaces them inline via `<FormMessage>`. Generic non-field codes
  // are NOT consumed here — the global MutationCache toast still handles them.
  serverError?: unknown;
}

function defaultFormValues(
  type: TransactionType,
  initialValues: Partial<TransactionFormValues> | undefined,
  preselectedAccountId: string | undefined,
): TransactionFormShape {
  return {
    type,
    securityId: initialValues?.securityId ?? '',
    accountId: initialValues?.accountId ?? preselectedAccountId ?? '',
    crossAccountId: initialValues?.crossAccountId ?? '',
    shares: initialValues?.shares ?? '',
    amount: initialValues?.amount ?? '',
    price: initialValues?.price ?? '',
    fees: initialValues?.fees ?? '',
    taxes: initialValues?.taxes ?? '',
    fxRate: initialValues?.fxRate ?? '',
    feesFx: initialValues?.feesFx ?? '',
    taxesFx: initialValues?.taxesFx ?? '',
    note: initialValues?.note ?? '',
  };
}

export function TransactionForm({
  type,
  initialValues,
  onSubmit,
  isSubmitting,
  preselectedAccountId,
  hideSubmitButton,
  formRef,
  serverError,
}: TransactionFormProps) {
  const { t, i18n } = useTranslation('transactions');
  const cfg = FIELD_CONFIG[type];
  const uid = useId();
  const fieldId = (name: string) => `${uid}-${name}`;
  const { data: accounts = [] } = useAccounts();
  const { data: securities = [] } = useSecurities();
  const [addInstrumentOpen, setAddInstrumentOpen] = useState(false);
  const [createEmptyOpen, setCreateEmptyOpen] = useState(false);

  // Date / time stay outside RHF — calendar popover + locale parsing is local
  // state, not a validated form field. They are merged into the wire payload
  // on submit.
  const [date, setDate] = useState<Date>(
    initialValues?.date ? new Date(initialValues.date) : new Date(),
  );
  const [dateText, setDateText] = useState<string>(() =>
    format(initialValues?.date ? new Date(initialValues.date) : new Date(), 'P', { locale: getDateLocale() }),
  );
  const dateInputRef = useRef<HTMLInputElement>(null);
  const [time, setTime] = useState<string>(
    initialValues?.date && initialValues.date.length > 10
      ? initialValues.date.slice(11, 16)
      : '00:00',
  );
  const [calOpen, setCalOpen] = useState(false);

  const filteredAccounts = useMemo(() => {
    if (PORTFOLIO_ONLY_TYPES.has(type)) return accounts.filter(a => a.type === 'portfolio');
    if (CASH_ONLY_TYPES.has(type)) return accounts.filter(a => a.type === 'account');
    // TRANSFER_BETWEEN_ACCOUNTS source must be a deposit account — server rejects
    // a portfolio source, so the dropdown filter mirrors the backend invariant.
    if (type === TransactionType.TRANSFER_BETWEEN_ACCOUNTS) return accounts.filter(a => a.type === 'account');
    return accounts;
  }, [accounts, type]);

  // The form schema depends on isCrossCurrency, which is derived from form
  // state — useForm's `resolver` is bound at creation, so we route through a
  // stable resolver that reads the latest schema from a ref. The schema-rebuild
  // useEffect below calls form.trigger() to re-validate against the new rules.
  const schemaRef = useRef<ReturnType<typeof buildTransactionFormSchema> | null>(null);
  const stableResolver = useMemo<Resolver<TransactionFormShape>>(
    () => async (values, context, options) => {
      if (!schemaRef.current) {
        return { values, errors: {} };
      }
      return zodResolver(schemaRef.current)(values, context, options);
    },
    [],
  );

  const form = useForm<TransactionFormShape>({
    defaultValues: defaultFormValues(type, initialValues, preselectedAccountId),
    mode: 'onBlur',
    reValidateMode: 'onChange',
    resolver: stableResolver,
  });

  // Surface server-side Zod field errors as inline `<FormMessage>` on the
  // offending field. Without this, route-layer 400s (cross-currency
  // `fxRate` gate, post-Zod schema fixes that diverge from the client
  // schema, etc.) are visible only as a global toast — the user has to
  // map a sentence back to a field. RHF's onChange revalidate clears the
  // server-flagged error as soon as the user touches the field.
  useEffect(() => {
    if (!serverError) return;
    for (const { field, message } of extractServerFieldErrors(serverError)) {
      form.setError(field, { type: 'server', message });
    }
  }, [serverError, form]);

  const watchedAccountId = useWatch({ control: form.control, name: 'accountId' }) ?? '';
  const watchedCrossAccountId = useWatch({ control: form.control, name: 'crossAccountId' }) ?? '';
  const watchedSecurityId = useWatch({ control: form.control, name: 'securityId' }) ?? '';
  const watchedFxRate = useWatch({ control: form.control, name: 'fxRate' }) ?? '';
  const watchedShares = useWatch({ control: form.control, name: 'shares' }) ?? '';
  const watchedPrice = useWatch({ control: form.control, name: 'price' }) ?? '';
  const watchedFees = useWatch({ control: form.control, name: 'fees' }) ?? '';
  const watchedTaxes = useWatch({ control: form.control, name: 'taxes' }) ?? '';
  const watchedFeesFx = useWatch({ control: form.control, name: 'feesFx' }) ?? '';
  const watchedTaxesFx = useWatch({ control: form.control, name: 'taxesFx' }) ?? '';

  const filteredCrossAccounts = useMemo(() => {
    let base: typeof accounts;
    if (type === TransactionType.SECURITY_TRANSFER) base = accounts.filter(a => a.type === 'portfolio');
    else if (type === TransactionType.TRANSFER_BETWEEN_ACCOUNTS) base = accounts.filter(a => a.type === 'account');
    else if (BUY_SELL_TYPES.has(type)) base = accounts.filter(a => a.type === 'account');
    else base = accounts;
    if (
      (type === TransactionType.TRANSFER_BETWEEN_ACCOUNTS || type === TransactionType.SECURITY_TRANSFER) &&
      watchedAccountId
    ) {
      return base.filter(a => a.id !== watchedAccountId);
    }
    return base;
  }, [accounts, type, watchedAccountId]);

  const selectedSecurity = useMemo(
    () => securities.find(s => s.id === watchedSecurityId),
    [securities, watchedSecurityId],
  );
  const selectedCashAccount = useMemo(
    () => filteredCrossAccounts.find(a => a.id === watchedCrossAccountId),
    [filteredCrossAccounts, watchedCrossAccountId],
  );
  const securityCurrency = selectedSecurity?.currency ?? null;
  const cashCurrency = selectedCashAccount?.currency ?? null;
  const isCrossCurrency = !!(securityCurrency && cashCurrency && securityCurrency !== cashCurrency);

  const formSchema = useMemo(
    () => buildTransactionFormSchema(
      { type, isCrossCurrency, fields: cfg },
      (k) => t(k),
    ),
    // i18n.language (not t) is the stable identity dep — t flickers on HMR/lazy-load.
    [type, isCrossCurrency, cfg, t, i18n.language], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Sync schemaRef synchronously during render so the first validation pass
  // (RHF's eager isValid computation on mount with a resolver) sees the real
  // schema — without this, Save would briefly enable on first paint with a
  // permissive resolver. The useEffect handles re-validation on SUBSEQUENT
  // schema changes (isCrossCurrency flip, language switch, etc.); skip the
  // first run to avoid a redundant resolver pass right after mount.
  if (schemaRef.current !== formSchema) {
    schemaRef.current = formSchema;
  }
  const didMount = useRef(false);
  useEffect(() => {
    if (!didMount.current) {
      didMount.current = true;
      return;
    }
    void form.trigger();
  }, [formSchema, form]);

  const fxDateStr = format(date, 'yyyy-MM-dd');
  const { data: fxData } = useFxRate(
    isCrossCurrency ? cashCurrency : null,
    isCrossCurrency ? securityCurrency : null,
    isCrossCurrency ? fxDateStr : null,
  );

  // Auto-populate crossAccountId from the portfolio's referenceAccount on BUY/SELL.
  // shouldValidate=true is required so formState.isValid recomputes — auto-fill
  // satisfies the last required Select and the Save gate must unstick without
  // waiting for the user to touch another field.
  useEffect(() => {
    if (!BUY_SELL_TYPES.has(type)) return;
    if (watchedCrossAccountId) return;
    const portfolio = accounts.find(a => a.id === watchedAccountId);
    if (portfolio?.referenceAccountId) {
      form.setValue('crossAccountId', portfolio.referenceAccountId, { shouldValidate: true });
    }
  }, [watchedAccountId, watchedCrossAccountId, accounts, type, form]);

  // Clear stale crossAccountId when the source changes to match it — the option
  // is filtered out of the dropdown but the form value would otherwise persist.
  useEffect(() => {
    if (type !== TransactionType.TRANSFER_BETWEEN_ACCOUNTS && type !== TransactionType.SECURITY_TRANSFER) return;
    if (watchedAccountId && watchedAccountId === watchedCrossAccountId) {
      form.setValue('crossAccountId', '', { shouldValidate: true });
    }
  }, [watchedAccountId, watchedCrossAccountId, type, form]);

  // Auto-fill fxRate from API; intentionally omits watchedFxRate from deps to
  // avoid clobbering user edits.
  useEffect(() => {
    if (isCrossCurrency && fxData?.rate && !watchedFxRate) {
      form.setValue('fxRate', fxData.rate, { shouldValidate: true });
    }
  }, [fxData?.rate, isCrossCurrency]); // eslint-disable-line react-hooks/exhaustive-deps

  const fxRateVal = watchedFxRate ? parseFloat(watchedFxRate) : 0;
  const grossSecurity = (parseFloat(watchedShares || '0') || 0) * (parseFloat(watchedPrice || '0') || 0);
  const feesFxNum = parseFloat(watchedFeesFx || '0') || 0;
  const taxesFxNum = parseFloat(watchedTaxesFx || '0') || 0;
  const fx = computeFxAmounts({
    isCrossCurrency, fxRate: fxRateVal, grossSecurity,
    feesFx: feesFxNum, taxesFx: taxesFxNum,
    feesDeposit: parseFloat(watchedFees || '0') || 0,
    taxesDeposit: parseFloat(watchedTaxes || '0') || 0,
  });

  function handleInstrumentCreated(id: string) {
    setAddInstrumentOpen(false);
    setCreateEmptyOpen(false);
    form.setValue('securityId', id, { shouldValidate: true });
  }

  const handleFormSubmit = form.handleSubmit((values) => {
    const fxFields: Partial<TransactionFormValues> = {};
    if (isCrossCurrency && values.fxRate) {
      fxFields.fxRate = values.fxRate;
      fxFields.fxCurrencyCode = securityCurrency ?? undefined;
      fxFields.currencyCode = cashCurrency ?? undefined;
      if (values.feesFx) fxFields.feesFx = values.feesFx;
      if (values.taxesFx) fxFields.taxesFx = values.taxesFx;
    }
    onSubmit({
      type,
      date: format(date, 'yyyy-MM-dd') + 'T' + time,
      securityId: values.securityId || undefined,
      accountId: values.accountId || undefined,
      crossAccountId: values.crossAccountId || undefined,
      shares: values.shares,
      amount: values.amount,
      price: values.price,
      fees: values.fees,
      taxes: values.taxes,
      note: values.note,
      ...fxFields,
    });
  });

  const saveDisabled = !form.formState.isValid || !!isSubmitting;

  return (
    <Form {...form}>
      <form ref={formRef} onSubmit={handleFormSubmit} className="space-y-3" noValidate>
        {/* Date & Time */}
        <div className="space-y-1">
          <Label htmlFor={fieldId('date')}>{t('form.dateTime')}</Label>
          <div className="flex gap-2">
            <Popover open={calOpen} onOpenChange={setCalOpen}>
              <div className="relative flex-1">
                <Input
                  id={fieldId('date')}
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
                    aria-label={t('form.openCalendar')}
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
              id={fieldId('time')}
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              className="w-28"
              aria-label={t('form.time')}
            />
          </div>
        </div>

        {/* Security */}
        {cfg.security !== false && (
          <FormField
            control={form.control}
            name="securityId"
            render={({ field }) => (
              <FormItem>
                <FormLabel htmlFor={fieldId('security')}>
                  {t('form.security')} {cfg.security === 'optional' ? t('common:optional') : ''}
                </FormLabel>
                <Select
                  value={field.value ?? ''}
                  onValueChange={(v) => {
                    if (v === '__create_new__') {
                      setAddInstrumentOpen(true);
                      return;
                    }
                    field.onChange(v);
                  }}
                >
                  <FormControl>
                    <SelectTrigger id={fieldId('security')} onBlur={field.onBlur}>
                      <SelectValue placeholder={t('form.selectSecurity')} />
                    </SelectTrigger>
                  </FormControl>
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
                <FormMessage />
              </FormItem>
            )}
          />
        )}

        {/* Account */}
        {cfg.accountId && (
          <FormField
            control={form.control}
            name="accountId"
            render={({ field }) => (
              <FormItem>
                <FormLabel htmlFor={fieldId('accountId')}>
                  {BUY_SELL_TYPES.has(type)
                    ? t('form.securitiesAccount')
                    : cfg.crossAccountId
                      ? t('form.fromAccount')
                      : t('form.account')}
                </FormLabel>
                <Select
                  value={field.value ?? ''}
                  onValueChange={field.onChange}
                  disabled={!!preselectedAccountId}
                >
                  <FormControl>
                    <SelectTrigger id={fieldId('accountId')} onBlur={field.onBlur}>
                      <SelectValue placeholder={t('form.selectAccount')} />
                    </SelectTrigger>
                  </FormControl>
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
                <FormMessage />
              </FormItem>
            )}
          />
        )}

        {/* Cross Account */}
        {cfg.crossAccountId && (
          <FormField
            control={form.control}
            name="crossAccountId"
            render={({ field }) => (
              <FormItem>
                <FormLabel htmlFor={fieldId('crossAccountId')}>
                  {BUY_SELL_TYPES.has(type) ? t('form.cashAccount') : t('form.toAccount')}
                </FormLabel>
                <Select value={field.value ?? ''} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger id={fieldId('crossAccountId')} onBlur={field.onBlur}>
                      <SelectValue placeholder={t('form.selectAccount')} />
                    </SelectTrigger>
                  </FormControl>
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
                <FormMessage />
              </FormItem>
            )}
          />
        )}

        {/* Shares + Price */}
        <PairOrSolo
          a={cfg.shares && <NumericField form={form} name="shares" label={t('columns.shares')} fieldId={fieldId('shares')} />}
          b={cfg.price && <NumericField form={form} name="price" label={t('form.pricePerShare')} fieldId={fieldId('price')} />}
        />

        {/* Amount */}
        {cfg.amount && (
          <NumericField form={form} name="amount" label={t('form.amount')} fieldId={fieldId('amount')} />
        )}

        {/* Fees + Taxes (hidden when FX section is showing) */}
        {!(BUY_SELL_TYPES.has(type) && isCrossCurrency) && (
          <PairOrSolo
            a={cfg.fees && <NumericField form={form} name="fees" label={t('form.feesOptional')} fieldId={fieldId('fees')} />}
            b={cfg.taxes && <NumericField form={form} name="taxes" label={t('form.taxesOptional')} fieldId={fieldId('taxes')} />}
          />
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

            <NumericField
              form={form}
              name="fxRate"
              label={`${t('form.exchangeRate')} (${cashCurrency}/${securityCurrency})`}
              fieldId={fieldId('fxRate')}
              placeholder={t('form.fxRatePlaceholder')}
            />

            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                {t('form.convertedGross', { ccy: cashCurrency })}
              </span>
              <span className="font-medium">{fx.grossDeposit.toFixed(2)} {cashCurrency}</span>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <NumericField
                form={form}
                name="feesFx"
                label={t('form.feesInCcy', { ccy: securityCurrency })}
                fieldId={fieldId('feesFx')}
              />
              <NumericField
                form={form}
                name="fees"
                label={t('form.feesInCcy', { ccy: cashCurrency })}
                fieldId={fieldId('fees-fx')}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <NumericField
                form={form}
                name="taxesFx"
                label={t('form.taxesInCcy', { ccy: securityCurrency })}
                fieldId={fieldId('taxesFx')}
              />
              <NumericField
                form={form}
                name="taxes"
                label={t('form.taxesInCcy', { ccy: cashCurrency })}
                fieldId={fieldId('taxes-fx')}
              />
            </div>
          </div>
        )}

        {/* Note */}
        {cfg.note && (
          <FormField
            control={form.control}
            name="note"
            render={({ field }) => (
              <FormItem>
                <FormLabel htmlFor={fieldId('note')}>{t('form.noteOptional')}</FormLabel>
                <FormControl>
                  <Input
                    id={fieldId('note')}
                    value={field.value ?? ''}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    placeholder={t('form.noteOptionalPlaceholder')}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        )}

        {!hideSubmitButton && (
          <SubmitButton
            type="submit"
            mutation={{ isPending: !!isSubmitting }}
            disabled={saveDisabled}
          >
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
    </Form>
  );
}

interface NumericFieldProps {
  form: ReturnType<typeof useForm<TransactionFormShape>>;
  name: keyof TransactionFormShape;
  label: string;
  fieldId: string;
  placeholder?: string;
}

function PairOrSolo({ a, b }: { a: React.ReactNode | false; b: React.ReactNode | false }) {
  if (a && b) return <div className="grid grid-cols-2 gap-3">{a}{b}</div>;
  return <>{a || null}{b || null}</>;
}

function NumericField({ form, name, label, fieldId, placeholder = '0.00' }: NumericFieldProps) {
  return (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel htmlFor={fieldId}>{label}</FormLabel>
          <FormControl>
            <Input
              id={fieldId}
              type="number"
              step="any"
              min="0"
              value={(field.value as string) ?? ''}
              onChange={field.onChange}
              onBlur={field.onBlur}
              placeholder={placeholder}
            />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}
