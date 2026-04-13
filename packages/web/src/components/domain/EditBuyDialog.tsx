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
import { useUpdateTransaction, useTransactionDetail } from '@/api/use-transactions';
import { useFxRate } from '@/api/use-fx';
import type { TransactionListItem } from '@/api/types';
import { getDateLocale } from '@/lib/formatters';
import { useUnsavedChangesGuard } from '@/hooks/use-unsaved-changes-guard';
import { UnsavedChangesAlert } from '@/components/shared/UnsavedChangesAlert';
import { computeFxAmounts, extractFxFromUnits } from '@/lib/fx-utils';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  transaction: TransactionListItem | null;
}

export function EditBuyDialog({ open, onOpenChange, transaction }: Props) {
  const { t } = useTranslation('transactions');
  const { data: accounts = [] } = useAccounts();
  const { data: securities = [] } = useSecurities();
  const updateMutation = useUpdateTransaction();
  const { data: txDetail } = useTransactionDetail(open ? transaction?.uuid ?? null : null);

  const portfolioAccounts = accounts.filter((a) => a.type === 'portfolio');
  const depositAccounts = accounts.filter((a) => a.type === 'account');

  const [securityId, setSecurityId] = useState('');
  const [accountId, setAccountId] = useState('');
  const [date, setDate] = useState<Date>(new Date());
  const [time, setTime] = useState<string>('00:00');
  const [calOpen, setCalOpen] = useState(false);
  const [shares, setShares] = useState('');
  const [price, setPrice] = useState('');
  const [fees, setFees] = useState('');
  const [taxes, setTaxes] = useState('');
  const [note, setNote] = useState('');
  const [crossAccountId, setCrossAccountId] = useState('');
  const [fxRate, setFxRate] = useState('');
  const [feesFx, setFeesFx] = useState('');
  const [taxesFx, setTaxesFx] = useState('');
  const [isDirty, setIsDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { guardedOpenChange, showDialog, setShowDialog, discard } =
    useUnsavedChangesGuard(isDirty, onOpenChange);

  useEffect(() => {
    if (!transaction) return;
    setSecurityId(transaction.security ?? transaction.securityId ?? '');
    setAccountId(transaction.account ?? '');
    setDate(transaction.date ? new Date(transaction.date) : new Date());
    setTime(transaction.date && transaction.date.length > 10 ? transaction.date.slice(11, 16) : '00:00');
    setNote(transaction.note ?? '');

    const sharesVal = parseFloat(transaction.shares ?? '0');
    setShares(transaction.shares ?? '');

    const feeUnit = transaction.units?.find((u) => u.type === 'FEE');
    const taxUnit = transaction.units?.find((u) => u.type === 'TAX');

    // ppxml2db convention: BUY amount = gross + fees + taxes → gross = amount - fees - taxes
    const netAmount = parseFloat(transaction.amount ?? '0');
    const feeVal = feeUnit ? Math.abs(parseFloat(feeUnit.amount ?? '0')) : 0;
    const taxVal = taxUnit ? Math.abs(parseFloat(taxUnit.amount ?? '0')) : 0;
    const grossAmount = netAmount - feeVal - taxVal;

    if (sharesVal > 0) {
      setPrice(String(grossAmount / sharesVal));
    } else {
      setPrice('');
    }

    setFees(feeVal ? String(feeVal) : '0');
    setTaxes(taxVal ? String(taxVal) : '0');

    setIsDirty(false);
    setError(null);
  }, [transaction]);

  // Derive crossAccountId from transaction or portfolio's referenceAccount
  useEffect(() => {
    if (!transaction) return;
    const txCrossAccount = transaction.crossAccountId;
    if (txCrossAccount) {
      setCrossAccountId(txCrossAccount);
    } else {
      const portfolio = accounts.find((a) => a.id === (transaction.account ?? ''));
      setCrossAccountId(portfolio?.referenceAccountId ?? '');
    }
  }, [transaction, accounts]);

  // Restore FX data from transaction detail units
  useEffect(() => {
    if (!txDetail) return;
    const fx = extractFxFromUnits(txDetail.units);
    setFxRate(fx.fxRate);
    setFeesFx(fx.feesFx);
    setTaxesFx(fx.taxesFx);
  }, [txDetail]);

  function markDirty<T>(setter: React.Dispatch<React.SetStateAction<T>>) {
    return (value: T) => { setter(value); setIsDirty(true); };
  }

  const selectedAccount = portfolioAccounts.find((a) => a.id === accountId);
  const cashAccount = accounts.find((a) => a.id === crossAccountId) ??
    accounts.find((a) => a.id === selectedAccount?.referenceAccountId);

  const sharesNum = parseFloat(shares) || 0;
  const priceNum = parseFloat(price) || 0;
  const feesNum = parseFloat(fees) || 0;
  const taxesNum = parseFloat(taxes) || 0;
  const subTotal = sharesNum * priceNum;

  const currency = cashAccount?.currency ?? transaction?.currencyCode ?? 'EUR';

  // FX detection
  const selectedSecurity = securities.find(s => s.id === securityId);
  const securityCurrency = selectedSecurity?.currency ?? null;
  const isCrossCurrency = !!(securityCurrency && cashAccount?.currency && securityCurrency !== cashAccount.currency);

  const fxDateStr = date ? format(date, 'yyyy-MM-dd') : null;
  const { data: fxData } = useFxRate(
    isCrossCurrency ? cashAccount?.currency ?? null : null,
    isCrossCurrency ? securityCurrency : null,
    fxDateStr,
  );

  // Auto-fill fxRate from API; intentionally omits fxRate from deps to avoid overwriting user edits
  useEffect(() => {
    if (isCrossCurrency && fxData?.rate && !fxRate) {
      setFxRate(fxData.rate);
      setIsDirty(true);
    }
  }, [fxData?.rate, isCrossCurrency]); // eslint-disable-line react-hooks/exhaustive-deps

  // FX computed values
  const fxRateNum = parseFloat(fxRate) || 0;
  const feesFxNumVal = parseFloat(feesFx) || 0;
  const taxesFxNumVal = parseFloat(taxesFx) || 0;
  const fx = computeFxAmounts({
    isCrossCurrency, fxRate: fxRateNum, grossSecurity: subTotal,
    feesFx: feesFxNumVal, taxesFx: taxesFxNumVal,
    feesDeposit: feesNum, taxesDeposit: taxesNum,
  });
  const debitNote = isCrossCurrency
    ? fx.grossDeposit + fx.totalFees + fx.totalTaxes
    : subTotal + feesNum + taxesNum;

  function handleSave() {
    if (!transaction) return;
    if (!securityId) { setError(t('validation.selectSecurity')); return; }
    if (!accountId) { setError(t('validation.selectPortfolioAccount')); return; }
    if (!shares || isNaN(sharesNum) || sharesNum <= 0) { setError(t('validation.invalidShares')); return; }
    if (!price || isNaN(priceNum) || priceNum <= 0) { setError(t('validation.invalidPrice')); return; }

    setError(null);
    updateMutation.mutate(
      {
        id: transaction.uuid,
        data: {
          type: 'BUY',
          securityId,
          accountId,
          date: format(date, 'yyyy-MM-dd') + 'T' + time,
          amount: subTotal,
          shares: sharesNum,
          fees: feesNum > 0 ? feesNum : undefined,
          taxes: taxesNum > 0 ? taxesNum : undefined,
          note: note || undefined,
          ...(crossAccountId ? { crossAccountId } : {}),
          ...(isCrossCurrency && fxRateNum > 0 ? {
            fxRate: fxRateNum,
            fxCurrencyCode: securityCurrency,
            currencyCode: cashAccount?.currency,
          } : {}),
          ...(feesFxNumVal > 0 ? { feesFx: feesFxNumVal } : {}),
          ...(taxesFxNumVal > 0 ? { taxesFx: taxesFxNumVal } : {}),
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

  return (
    <>
      <Sheet open={open} onOpenChange={guardedOpenChange}>
        <SheetContent
          side="right"
          className="w-full sm:max-w-xl p-0 flex flex-col"
          showCloseButton={true}
        >
          <SheetHeader className="px-6 pt-6 pb-2 shrink-0">
            <SheetTitle>{t('editTitles.buy')}</SheetTitle>
            <SheetDescription className="sr-only">
              {t('editTitles.buy')}
            </SheetDescription>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto px-6 min-h-0">
            <div className="space-y-4 py-2">
              {/* Security */}
              <div className="space-y-1">
                <Label>{t('form.security')}</Label>
                <Select value={securityId} onValueChange={markDirty(setSecurityId)}>
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

              {/* Securities Account */}
              <div className="space-y-1">
                <Label>{t('form.securitiesAccount')}</Label>
                <Select value={accountId} onValueChange={markDirty(setAccountId)}>
                  <SelectTrigger>
                    <SelectValue placeholder={t('form.selectSecuritiesAccount')} />
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

              {/* Cash Account (deposit) */}
              <div className="space-y-1">
                <Label>{t('form.cashAccount')}</Label>
                <Select value={crossAccountId} onValueChange={markDirty(setCrossAccountId)}>
                  <SelectTrigger>
                    <SelectValue placeholder={t('form.selectCashAccount')} />
                  </SelectTrigger>
                  <SelectContent>
                    {depositAccounts.map((a) => (
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

              {/* Shares + Price */}
              <div className="grid grid-cols-2 gap-3">
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
                <div className="space-y-1">
                  <Label>{t('form.price')}</Label>
                  <Input
                    type="number"
                    step="any"
                    min="0"
                    value={price}
                    onChange={(e) => { setPrice(e.target.value); setIsDirty(true); }}
                    placeholder="0.00"
                  />
                </div>
              </div>

              {/* Gross Value (read-only) */}
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{t('form.grossValue')}</span>
                <span className="font-medium">
                  {subTotal.toFixed(2)} {isCrossCurrency ? securityCurrency : currency}
                </span>
              </div>

              {/* FX Section — cross-currency only */}
              {isCrossCurrency && (
                <div className="rounded-md border bg-muted/30 p-3 space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">
                      {t('form.grossInSecurityCcy', { ccy: securityCurrency })}
                    </span>
                    <span className="font-medium">{subTotal.toFixed(2)} {securityCurrency}</span>
                  </div>

                  <div className="space-y-1">
                    <Label>{t('form.exchangeRate')} ({cashAccount?.currency}/{securityCurrency})</Label>
                    <Input
                      type="number"
                      step="any"
                      value={fxRate}
                      onChange={(e) => { setFxRate(e.target.value); setIsDirty(true); }}
                      placeholder={t('form.fxRatePlaceholder')}
                    />
                  </div>

                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">
                      {t('form.convertedGross', { ccy: cashAccount?.currency })}
                    </span>
                    <span className="font-medium">{fx.grossDeposit.toFixed(2)} {cashAccount?.currency}</span>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label>{t('form.feesInCcy', { ccy: securityCurrency })}</Label>
                      <Input type="number" step="any" value={feesFx}
                        onChange={(e) => { setFeesFx(e.target.value); setIsDirty(true); }}
                        placeholder="0.00" />
                    </div>
                    <div className="space-y-1">
                      <Label>{t('form.feesInCcy', { ccy: cashAccount?.currency })}</Label>
                      <Input type="number" step="any" value={fees}
                        onChange={(e) => { setFees(e.target.value); setIsDirty(true); }}
                        placeholder="0.00" />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label>{t('form.taxesInCcy', { ccy: securityCurrency })}</Label>
                      <Input type="number" step="any" value={taxesFx}
                        onChange={(e) => { setTaxesFx(e.target.value); setIsDirty(true); }}
                        placeholder="0.00" />
                    </div>
                    <div className="space-y-1">
                      <Label>{t('form.taxesInCcy', { ccy: cashAccount?.currency })}</Label>
                      <Input type="number" step="any" value={taxes}
                        onChange={(e) => { setTaxes(e.target.value); setIsDirty(true); }}
                        placeholder="0.00" />
                    </div>
                  </div>
                </div>
              )}

              {!isCrossCurrency && (
                <>
                  {/* Fees */}
                  <div className="space-y-1">
                    <Label>{t('form.fees')}</Label>
                    <div className="flex gap-2 items-center">
                      <Input
                        type="number"
                        step="any"
                        min="0"
                        value={fees}
                        onChange={(e) => { setFees(e.target.value); setIsDirty(true); }}
                        placeholder="0.00"
                        className="flex-1"
                      />
                      <span className="text-sm text-muted-foreground w-10">{currency}</span>
                    </div>
                  </div>

                  {/* Taxes */}
                  <div className="space-y-1">
                    <Label>{t('form.taxes')}</Label>
                    <div className="flex gap-2 items-center">
                      <Input
                        type="number"
                        step="any"
                        min="0"
                        value={taxes}
                        onChange={(e) => { setTaxes(e.target.value); setIsDirty(true); }}
                        placeholder="0.00"
                        className="flex-1"
                      />
                      <span className="text-sm text-muted-foreground w-10">{currency}</span>
                    </div>
                  </div>
                </>
              )}

              {/* Debit Note (read-only) */}
              <div className="flex items-center justify-between text-sm border-t pt-2">
                <span className="text-muted-foreground">{t('form.debitNote')}</span>
                <span className="font-semibold">
                  {debitNote.toFixed(2)} {currency}
                </span>
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
