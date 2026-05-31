// packages/web/src/components/domain/UnresolvedFxModal.tsx
//
// Quick-fix modal opened by clicking the amber unresolved-FX badge on the
// Investments page. Lists each security missing a base-currency FX rate and
// provides a pre-filled rate-add form so the user can resolve them without
// navigating to Settings → Currencies.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { useForm, type Resolver } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useCreateFxRate } from '@/api/use-fx-rates';
import { useGuardedSubmit } from '@/hooks/use-guarded-submit';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AffectedSecurity {
  id: string;
  name: string;
  currency: string; // security native currency
}

interface UnresolvedFxModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  baseCurrency: string;
  affected: AffectedSecurity[];
  periodEnd: string; // ISO date — pre-fill for the missing rate
}

// ─── Form schema ─────────────────────────────────────────────────────────────
//
// Built with a translator so <FormMessage> renders human-readable text instead
// of raw key strings. Same pattern as `buildTransactionFormSchema`.

interface RateFormShape {
  from: string;
  to: string;
  date: string;
  rate: string;
}

function buildRateFormSchema(t: (key: string) => string) {
  return z.object({
    from: z.string().length(3, t('errors.invalidCurrencyCode')),
    to: z.string().length(3, t('errors.invalidCurrencyCode')),
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, t('errors.invalidDate')),
    rate: z
      .string()
      .refine(
        (v) => {
          const n = Number(v);
          return Number.isFinite(n) && n > 0;
        },
        t('errors.invalidRate'),
      ),
  });
}

// ─── Component ────────────────────────────────────────────────────────────────

export function UnresolvedFxModal({
  open,
  onOpenChange,
  baseCurrency,
  affected,
  periodEnd,
}: UnresolvedFxModalProps) {
  const { t } = useTranslation('currencies');
  const { t: tCommon } = useTranslation('common');

  const [activeSecurity, setActiveSecurity] = useState<AffectedSecurity | null>(null);

  const createMut = useCreateFxRate();

  // Build schema once per language. The schema captures translated error strings
  // at build time so FormMessage renders them directly.
  const schema = useMemo(() => buildRateFormSchema(t), [t]);

  // Stable resolver that always reads the latest schema from a ref, matching
  // the TransactionForm pattern for dynamic schemas.
  const schemaRef = useRef(schema);
  if (schemaRef.current !== schema) schemaRef.current = schema;

  const stableResolver = useMemo<Resolver<RateFormShape>>(
    () =>
      async (values, context, options) =>
        zodResolver(schemaRef.current)(values, context, options),
    [],
  );

  const form = useForm<RateFormShape>({
    resolver: stableResolver,
    mode: 'onBlur',
    reValidateMode: 'onChange',
    defaultValues: { from: '', to: baseCurrency, date: periodEnd, rate: '' },
  });

  // Re-trigger validation when schema changes (language switch while open).
  useEffect(() => {
    if (form.formState.isSubmitted || Object.keys(form.formState.touchedFields).length > 0) {
      void form.trigger();
    }
  }, [schema, form]);

  // onChange re-trigger — clears inline errors as the user fixes values.
  useEffect(() => {
    const sub = form.watch((_, info) => {
      if (
        info.type === 'change' &&
        info.name &&
        !form.formState.touchedFields[info.name as keyof RateFormShape]
      ) {
        void form.trigger(info.name as keyof RateFormShape);
      }
    });
    return () => sub.unsubscribe();
  }, [form]);

  // When the modal closes, reset active security but keep the form values so
  // a re-open doesn't lose context.
  useEffect(() => {
    if (!open) setActiveSecurity(null);
  }, [open]);

  const { run, inFlight } = useGuardedSubmit(async (values: RateFormShape) => {
    try {
      await createMut.mutateAsync(values);
      // After a successful add the portfolio queries are broad-invalidated by
      // useCreateFxRate.onSuccess. The `affected` prop re-derives from the
      // refreshed statement in the parent, so the list shrinks automatically.
      setActiveSecurity(null);
      form.reset({ from: '', to: baseCurrency, date: periodEnd, rate: '' });
    } catch {
      // Global MutationCache error toast handles user-visible feedback.
    }
  });

  function handleAddClick(sec: AffectedSecurity) {
    setActiveSecurity(sec);
    form.reset({ from: sec.currency, to: baseCurrency, date: periodEnd, rate: '' });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{t('unresolvedFx.title')}</DialogTitle>
          <DialogDescription>{t('unresolvedFx.description')}</DialogDescription>
        </DialogHeader>

        {/* Security list */}
        {affected.length === 0 ? (
          <Alert>
            <AlertDescription>{t('unresolvedFx.allResolved')}</AlertDescription>
          </Alert>
        ) : (
          <div className="space-y-2">
            {affected.map((sec) => (
              <div
                key={sec.id}
                className="flex items-center justify-between rounded-md border p-3"
              >
                <div>
                  <div className="font-medium text-sm">{sec.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {sec.currency} → {baseCurrency}
                  </div>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant={activeSecurity?.id === sec.id ? 'default' : 'outline'}
                  onClick={() => handleAddClick(sec)}
                >
                  {t('unresolvedFx.addRate')}
                </Button>
              </div>
            ))}
          </div>
        )}

        {/* Inline rate-add form — shown only after a security is selected */}
        {activeSecurity && (
          <Form {...form}>
            <form
              onSubmit={form.handleSubmit(run)}
              className="space-y-4 border-t pt-4"
            >
              <p className="text-sm font-medium">
                {t('unresolvedFx.addRateFor', {
                  from: activeSecurity.currency,
                  to: baseCurrency,
                })}
              </p>

              <div className="grid grid-cols-2 gap-3">
                <FormField
                  name="date"
                  control={form.control}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('date')}</FormLabel>
                      <FormControl>
                        <Input type="date" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  name="rate"
                  control={form.control}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        {t('rate')} ({activeSecurity.currency}/{baseCurrency})
                      </FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="0.000001"
                          min="0"
                          placeholder="1.0000"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setActiveSecurity(null)}
                >
                  {tCommon('cancel')}
                </Button>
                <Button
                  type="submit"
                  disabled={!form.formState.isValid || inFlight}
                >
                  {t('unresolvedFx.addRate')}
                </Button>
              </div>
            </form>
          </Form>
        )}
      </DialogContent>
    </Dialog>
  );
}
