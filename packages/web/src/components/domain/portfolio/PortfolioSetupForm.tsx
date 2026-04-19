// Shared form body powering both NewPortfolioDialog (Phase 4) and
// PortfolioSetupPage (Phase 5). Emits strictly SetupPortfolioInput — the
// portfolio name (when needed) is collected by the dialog separately.
//
// BUG-54/55 Phase 3 — Task 3.3.

import { useState } from 'react';
import { useForm, useFieldArray, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslation } from 'react-i18next';
import { setupPortfolioSchema, type SetupPortfolioInput } from '@quovibe/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Plus, X, ChevronDown, ChevronRight } from 'lucide-react';
import {
  findDuplicateDepositNames,
  buildSetupInput,
  type FormValues,
} from './portfolio-setup-form.utils';

const CURRENCIES = ['EUR', 'USD', 'GBP', 'CHF', 'JPY', 'SEK', 'NOK', 'DKK', 'CAD', 'AUD'] as const;
const ADVANCED_REGION_ID = 'portfolio-setup-advanced-deposits';

interface PortfolioSetupFormProps {
  onSubmit: (input: SetupPortfolioInput) => void;
  isSubmitting: boolean;
  submitLabel: string;
  /** Phase 4 forward-compat: when true, submit is gated regardless of form validity (e.g. dialog name field is empty). */
  disabled?: boolean;
  initialValues?: Partial<SetupPortfolioInput>;
}

const DEFAULTS: FormValues = {
  baseCurrency: 'EUR',
  securitiesAccountName: '',
  primaryDeposit: { name: '' },
  extraDeposits: [],
};

export function PortfolioSetupForm({
  onSubmit,
  isSubmitting,
  submitLabel,
  disabled = false,
  initialValues,
}: PortfolioSetupFormProps) {
  const { t } = useTranslation('portfolio-setup');
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const {
    register,
    control,
    handleSubmit,
    setError,
    clearErrors,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(setupPortfolioSchema),
    defaultValues: { ...DEFAULTS, ...initialValues },
    mode: 'onSubmit',
  });

  const { fields, append, remove } = useFieldArray({ control, name: 'extraDeposits' });

  const handleFormSubmit = handleSubmit((raw) => {
    const normalized = buildSetupInput(raw);
    const dups = findDuplicateDepositNames([
      normalized.primaryDeposit.name,
      ...normalized.extraDeposits.map(d => d.name),
    ]);
    if (dups.length > 0) {
      setError('root.duplicateName', { message: t('errors.duplicateName') });
      return;
    }
    clearErrors('root.duplicateName');
    onSubmit(normalized);
  });

  const dupError = errors.root?.duplicateName?.message;

  return (
    <form onSubmit={handleFormSubmit} className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="portfolio-setup-base-currency">{t('fields.baseCurrency')}</Label>
        <Controller
          control={control}
          name="baseCurrency"
          render={({ field }) => (
            <Select value={field.value} onValueChange={field.onChange}>
              <SelectTrigger id="portfolio-setup-base-currency">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CURRENCIES.map(c => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="portfolio-setup-securities-name">{t('fields.securitiesAccountName')}</Label>
        <Input
          id="portfolio-setup-securities-name"
          placeholder={t('fields.securitiesAccountPlaceholder')}
          {...register('securitiesAccountName')}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="portfolio-setup-primary-name">{t('fields.primaryDepositName')}</Label>
        <Input
          id="portfolio-setup-primary-name"
          placeholder={t('fields.primaryDepositPlaceholder')}
          {...register('primaryDeposit.name')}
        />
      </div>

      <div className="border-t pt-4">
        <button
          type="button"
          onClick={() => setAdvancedOpen(v => !v)}
          aria-expanded={advancedOpen}
          aria-controls={ADVANCED_REGION_ID}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          {advancedOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          {t('advanced.toggle')}
        </button>

        {advancedOpen && (
          <div id={ADVANCED_REGION_ID} role="region" className="mt-3 space-y-3">
            <p className="text-xs text-muted-foreground">{t('advanced.description')}</p>
            {fields.map((field, index) => (
              <div key={field.id} className="flex items-end gap-2">
                <div className="flex-1 space-y-1">
                  <Label htmlFor={`extra-name-${index}`} className="text-xs">
                    {t('fields.extraDepositName')}
                  </Label>
                  <Input
                    id={`extra-name-${index}`}
                    {...register(`extraDeposits.${index}.name`)}
                  />
                </div>
                <div className="w-28 space-y-1">
                  <Label htmlFor={`extra-currency-${index}`} className="text-xs">
                    {t('fields.extraDepositCurrency')}
                  </Label>
                  <Controller
                    control={control}
                    name={`extraDeposits.${index}.currency`}
                    render={({ field: ctrl }) => (
                      <Select value={ctrl.value} onValueChange={ctrl.onChange}>
                        <SelectTrigger id={`extra-currency-${index}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {CURRENCIES.map(c => (
                            <SelectItem key={c} value={c}>{c}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => remove(index)}
                  aria-label={t('advanced.removeDeposit')}
                >
                  <X size={16} />
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => append({ name: '', currency: 'EUR' })}
              className="inline-flex items-center gap-1.5"
            >
              <Plus size={14} />
              {t('advanced.addDeposit')}
            </Button>
          </div>
        )}
      </div>

      {dupError && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{dupError}</AlertDescription>
        </Alert>
      )}

      <div className="flex justify-end">
        <Button type="submit" disabled={disabled || isSubmitting}>
          {isSubmitting ? t('submit.submitting') : submitLabel}
        </Button>
      </div>
    </form>
  );
}
