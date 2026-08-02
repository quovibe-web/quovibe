import { useMemo, useId } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Card, CardContent } from '@/components/ui/card';
import { useSecurities } from '@/api/use-securities';
import { useFormRevalidateOnChange } from '@/hooks/use-form-revalidate-on-change';
import {
  buildSplitFormSchema,
  describeSplit,
  type SplitFormValues,
} from './stock-split-form.schema';

interface SplitSelectStepProps {
  defaultValues: SplitFormValues;
  lockSecurity: boolean;
  isPreviewing: boolean;
  previewError: string | null;
  onNext: (values: SplitFormValues) => void;
}

export function SplitSelectStep({
  defaultValues,
  lockSecurity,
  isPreviewing,
  previewError,
  onNext,
}: SplitSelectStepProps) {
  const { t } = useTranslation('securities');
  const { data: securities = [] } = useSecurities();
  const fieldId = useId();

  const schema = useMemo(() => buildSplitFormSchema(t), [t]);
  const form = useForm<SplitFormValues>({
    resolver: zodResolver(schema),
    mode: 'onBlur',
    reValidateMode: 'onChange',
    defaultValues,
  });
  useFormRevalidateOnChange(form);

  const watched = form.watch();
  const description = describeSplit(watched);

  return (
    <Card>
      <CardContent className="pt-6">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onNext)} className="space-y-6">
            <FormField
              control={form.control}
              name="securityId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel htmlFor={`${fieldId}-security`}>
                    {t('split.fields.security')}
                  </FormLabel>
                  <Select
                    value={field.value ?? ''}
                    onValueChange={field.onChange}
                    disabled={lockSecurity}
                  >
                    <FormControl>
                      <SelectTrigger id={`${fieldId}-security`} onBlur={field.onBlur}>
                        <SelectValue placeholder={t('split.fields.selectSecurity')} />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {securities.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="exDate"
              render={({ field }) => (
                <FormItem>
                  <FormLabel htmlFor={`${fieldId}-exdate`}>{t('split.fields.exDate')}</FormLabel>
                  <FormControl>
                    <Input id={`${fieldId}-exdate`} type="date" {...field} />
                  </FormControl>
                  <p className="text-xs text-[var(--qv-text-secondary)]">
                    {t('split.fields.exDateHint')}
                  </p>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Two labelled fields, not a free-text "a:b" box. The ratio is
                stored new:old, so a single input silently inverts a reverse
                split for anyone who types it the way their broker states it. */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="oldShares"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel htmlFor={`${fieldId}-old`}>{t('split.fields.oldShares')}</FormLabel>
                    <FormControl>
                      <Input id={`${fieldId}-old`} inputMode="decimal" placeholder="25" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="newShares"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel htmlFor={`${fieldId}-new`}>{t('split.fields.newShares')}</FormLabel>
                    <FormControl>
                      <Input id={`${fieldId}-new`} inputMode="decimal" placeholder="1" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {description && (
              <p className="text-sm text-[var(--qv-text-secondary)]">
                {t(description.key, description.values)}
              </p>
            )}

            {previewError && (
              <Alert variant="destructive">
                <AlertDescription>{previewError}</AlertDescription>
              </Alert>
            )}

            <div className="flex justify-end">
              <Button type="submit" disabled={!form.formState.isValid || isPreviewing}>
                {isPreviewing ? t('split.previewing') : t('split.nav.next')}
              </Button>
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
