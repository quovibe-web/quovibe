import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Lock } from 'lucide-react';
import { getAllCalendarInfos } from '@quovibe/shared';
import { SectionHeader } from './SectionHeader';
import type { CompletenessStatus } from '@/lib/security-completeness';

const CURRENCIES = [
  'EUR', 'USD', 'GBP', 'CHF', 'JPY', 'CAD', 'AUD', 'SEK', 'NOK', 'DKK',
  'HKD', 'SGD', 'NZD', 'KRW', 'TWD', 'CNY', 'INR', 'BRL', 'ZAR', 'PLN', 'CZK', 'HUF',
];

const masterDataSchema = z.object({
  name: z.string().min(1),
  isin: z.string().max(12).optional().or(z.literal('')),
  ticker: z.string().optional().or(z.literal('')),
  wkn: z.string().max(6).optional().or(z.literal('')),
  currency: z.string().min(1),
  calendar: z.string().optional().or(z.literal('')),
  isRetired: z.boolean(),
  note: z.string().optional().or(z.literal('')),
});

export type MasterDataValues = z.infer<typeof masterDataSchema>;

interface Props {
  defaultValues: MasterDataValues;
  hasTransactions: boolean;
  status?: CompletenessStatus;
  onChange: (values: MasterDataValues, isDirty: boolean) => void;
}

export function MasterDataSection({ defaultValues, hasTransactions, status, onChange }: Props) {
  const { t } = useTranslation('securities');

  const form = useForm<MasterDataValues>({
    resolver: zodResolver(masterDataSchema),
    defaultValues,
    mode: 'onChange',
  });

  const { register, watch, setValue, formState: { errors, isDirty } } = form;

  // Reset when defaultValues change (e.g. security loaded/changed)
  useEffect(() => {
    form.reset(defaultValues);
  }, [defaultValues, form]);

  // Notify parent of value changes
  useEffect(() => {
    const subscription = watch((values) => {
      onChange(values as MasterDataValues, isDirty);
    });
    return () => subscription.unsubscribe();
  }, [watch, onChange, isDirty]);

  return (
    <div>
      <SectionHeader
        title={t('securityEditor.masterData')}
        id="section-master-data"
        status={status}
      />
      <div className="space-y-4 py-3">
        {/* Name */}
        <div className="space-y-1.5">
          <Label htmlFor="sec-name">{t('securityEditor.name')} *</Label>
          <Input
            id="sec-name"
            {...register('name')}
            placeholder={t('securityEditor.namePlaceholder')}
            aria-required="true"
          />
          {errors.name && (
            <p className="text-xs text-destructive">{t('securityEditor.nameRequired')}</p>
          )}
        </div>

        {/* ISIN + WKN */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="sec-isin">{t('securityEditor.isin')}</Label>
            <Input
              id="sec-isin"
              {...register('isin')}
              placeholder={t('securityEditor.isinPlaceholder')}
              className="font-mono"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sec-wkn">{t('securityEditor.wkn')}</Label>
            <Input
              id="sec-wkn"
              {...register('wkn')}
              placeholder={t('securityEditor.wknPlaceholder')}
              className="font-mono"
            />
          </div>
        </div>

        {/* Ticker + Currency */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="sec-ticker">{t('securityEditor.symbol')}</Label>
            <Input
              id="sec-ticker"
              {...register('ticker')}
              placeholder={t('securityEditor.symbolPlaceholder')}
              className="font-mono"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sec-currency">
              {t('securityEditor.currency')} *
              {hasTransactions && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Lock className="inline h-3.5 w-3.5 ml-1 text-muted-foreground" />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="text-xs">{t('securityEditor.currencyLocked')}</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
            </Label>
            <Select
              value={watch('currency')}
              onValueChange={(v) => setValue('currency', v, { shouldDirty: true })}
              disabled={hasTransactions}
            >
              <SelectTrigger id="sec-currency" aria-required="true">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CURRENCIES.map(c => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Calendar */}
        <div className="space-y-1.5">
          <Label htmlFor="sec-calendar">{t('securityEditor.calendar')}</Label>
          <Select
            value={watch('calendar') ?? ''}
            onValueChange={(v) => setValue('calendar', v === '__none' ? '' : v, { shouldDirty: true })}
          >
            <SelectTrigger id="sec-calendar">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none">
                {t('securityEditor.calendarNone')}
              </SelectItem>
              {getAllCalendarInfos().map((cal) => (
                <SelectItem key={cal.id} value={cal.id}>{cal.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Active / Retired */}
        <div className="flex items-center gap-3">
          <Switch
            id="sec-retired"
            checked={watch('isRetired')}
            onCheckedChange={(v) => setValue('isRetired', v, { shouldDirty: true })}
            role="switch"
          />
          <Label htmlFor="sec-retired">
            {watch('isRetired') ? t('securityEditor.retired') : t('securityEditor.active')}
          </Label>
        </div>

        {/* Notes */}
        <div className="space-y-1.5">
          <Label htmlFor="sec-notes">{t('securityEditor.notes')}</Label>
          <Textarea
            id="sec-notes"
            {...register('note')}
            rows={3}
            placeholder={t('securityEditor.notesPlaceholder')}
          />
        </div>
      </div>
    </div>
  );
}
