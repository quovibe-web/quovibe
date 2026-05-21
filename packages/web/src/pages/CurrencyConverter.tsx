// packages/web/src/pages/CurrencyConverter.tsx
//
// User-level Currency Converter page (mounted at `/settings/currencies`).
// Three zones per spec §5:
//   1. Pair selector (with switch button) + summary chip.
//   2. Rate history table (Date / Rate / Source / Actions). Edit + Delete
//      visible only on MANUAL rows.
//   3. Add-rate form (RHF + zodResolver + FormField, useGuardedSubmit) and
//      ECB CSV bulk-import section.
//
// Mutations flow through `useCreateFxRate / useUpdateFxRate /
// useDeleteFxRate / useImportEcbCsv` in `@/api/use-fx-rates`. Errors
// surface via the global MutationCache toast — `errors.json > server.*`
// keys for `INVALID_CURRENCY_CODE`, `SAME_CURRENCY`, `INVALID_RATE`,
// `DUPLICATE_RATE`, `RATE_NOT_FOUND_OR_NOT_MANUAL` are already wired.
//
// TODO: rate chart in Zone 1 — Phase 3-B (lightweight-charts overlay on
// the same DataTable rows). Deferred to keep this commit reviewable.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import type { ColumnDef } from '@tanstack/react-table';
import { ArrowLeftRight, Pencil, Trash2, Upload, Check, X as XIcon } from 'lucide-react';

import {
  useCreateFxRate,
  useDeleteFxRate,
  useFxPairs,
  useFxRatesForPair,
  useImportEcbCsv,
  useUpdateFxRate,
  type FxRateRow,
  type FxRateSource,
} from '@/api/use-fx-rates';
import { CURRENCIES } from '@/lib/currencies';
import { formatDate } from '@/lib/formatters';
import { useGuardedSubmit } from '@/hooks/use-guarded-submit';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

import { DataTable } from '@/components/shared/DataTable';
import { EmptyState } from '@/components/shared/EmptyState';
import { PageHeader } from '@/components/shared/PageHeader';
import {
  currencyColumnMeta,
  dateColumnMeta,
  textColumnMeta,
} from '@/lib/column-factories';
import { Coins } from 'lucide-react';

import { buildCurrencyOptions, swapPair } from './currency-converter.utils';

// ─── Add-rate form schema ─────────────────────────────────────────────

const addRateSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'errors.invalidDate'),
  rate: z
    .string()
    .refine((v) => Number(v) > 0 && Number.isFinite(Number(v)), 'errors.invalidRate'),
});

type AddRateFormValues = z.infer<typeof addRateSchema>;

// ─── Source badge ────────────────────────────────────────────────────

function SourceBadge({ source }: { source: FxRateSource }) {
  const { t } = useTranslation('currencies');
  if (source === 'ECB') {
    return <Badge variant="secondary">{t('sourceECB')}</Badge>;
  }
  if (source === 'IMPORT') {
    return <Badge variant="outline">{t('sourceImport')}</Badge>;
  }
  return <Badge variant="default">{t('sourceManual')}</Badge>;
}

// ─── Page ────────────────────────────────────────────────────────────

export default function CurrencyConverter() {
  const { t } = useTranslation('currencies');
  const { t: tCommon } = useTranslation('common');

  useEffect(() => {
    document.title = `${t('title')} · quovibe`;
  }, [t]);

  const pairsQuery = useFxPairs();
  const pairs = useMemo(() => pairsQuery.data?.pairs ?? [], [pairsQuery.data]);

  // Selected pair — defaults to the first server pair when one exists,
  // otherwise picks EUR → USD as a reasonable empty-state starting point.
  const [from, setFrom] = useState<string>('EUR');
  const [to, setTo] = useState<string>('USD');
  const initializedRef = useRef(false);

  useEffect(() => {
    if (initializedRef.current) return;
    if (pairs.length > 0) {
      setFrom(pairs[0].from);
      setTo(pairs[0].to);
      initializedRef.current = true;
    }
  }, [pairs]);

  const currencyOptions = useMemo(() => {
    const extra: string[] = [];
    for (const p of pairs) {
      extra.push(p.from);
      extra.push(p.to);
    }
    return buildCurrencyOptions(CURRENCIES, extra);
  }, [pairs]);

  function handleSwap() {
    const next = swapPair(from, to);
    setFrom(next.from);
    setTo(next.to);
  }

  const sameCurrency = from === to;

  // ── Zone 2: rate history ───────────────────────────────────────────
  const ratesQuery = useFxRatesForPair(
    sameCurrency ? null : from,
    sameCurrency ? null : to,
  );
  const rates = ratesQuery.data ?? [];

  // ── Inline edit + delete state ─────────────────────────────────────
  const [editingDate, setEditingDate] = useState<string | null>(null);
  const [editingRate, setEditingRate] = useState<string>('');
  const [deleteTarget, setDeleteTarget] = useState<FxRateRow | null>(null);

  const updateMutation = useUpdateFxRate();
  const deleteMutation = useDeleteFxRate();

  const { run: runUpdate, inFlight: updateInFlight } = useGuardedSubmit(
    async (row: FxRateRow) => {
      try {
        await updateMutation.mutateAsync({
          from,
          to,
          date: row.date,
          rate: editingRate,
        });
        setEditingDate(null);
      } catch {
        // global MutationCache error toast handles user-visible feedback
      }
    },
  );

  const { run: runDelete, inFlight: deleteInFlight } = useGuardedSubmit(
    async (row: FxRateRow) => {
      try {
        await deleteMutation.mutateAsync({ from, to, date: row.date });
        setDeleteTarget(null);
      } catch {
        // global MutationCache error toast handles user-visible feedback
      }
    },
  );

  function beginEdit(row: FxRateRow) {
    setEditingDate(row.date);
    setEditingRate(row.rate);
  }

  function cancelEdit() {
    setEditingDate(null);
    setEditingRate('');
  }

  const cols = useMemo<ColumnDef<FxRateRow>[]>(
    () => [
      {
        accessorKey: 'date',
        ...dateColumnMeta(),
        header: t('date'),
        cell: ({ row }) => formatDate(row.original.date),
      },
      {
        accessorKey: 'rate',
        ...currencyColumnMeta(),
        header: t('rate'),
        cell: ({ row }) => {
          const r = row.original;
          if (editingDate === r.date) {
            return (
              <Input
                value={editingRate}
                onChange={(e) => setEditingRate(e.target.value)}
                className="h-8 w-32 qv-numeric"
                inputMode="decimal"
                autoFocus
                aria-label={t('rate')}
              />
            );
          }
          return <span className="qv-numeric">{r.rate}</span>;
        },
      },
      {
        accessorKey: 'source',
        ...textColumnMeta(),
        header: t('source'),
        cell: ({ row }) => <SourceBadge source={row.original.source} />,
      },
      {
        id: 'actions',
        ...textColumnMeta(),
        header: t('actions'),
        cell: ({ row }) => {
          const r = row.original;
          if (r.source !== 'MANUAL') return null;
          if (editingDate === r.date) {
            return (
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => void runUpdate(r)}
                  disabled={updateInFlight}
                  aria-label={t('save')}
                >
                  <Check className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={cancelEdit}
                  aria-label={t('cancel')}
                >
                  <XIcon className="h-4 w-4" />
                </Button>
              </div>
            );
          }
          return (
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => beginEdit(r)}
                aria-label={t('edit')}
              >
                <Pencil className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-destructive"
                onClick={() => setDeleteTarget(r)}
                aria-label={t('delete')}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          );
        },
      },
    ],
    // editingDate / editingRate / runUpdate / updateInFlight participate in the cell renders
    [t, editingDate, editingRate, runUpdate, updateInFlight],
  );

  // ── Zone 3a: Add-rate form ─────────────────────────────────────────
  const createMutation = useCreateFxRate();
  const form = useForm<AddRateFormValues>({
    resolver: zodResolver(addRateSchema),
    mode: 'onBlur',
    reValidateMode: 'onChange',
    defaultValues: {
      date: new Date().toISOString().slice(0, 10),
      rate: '',
    },
  });

  // Clear inline errors on first keystroke before blur fires (matches
  // PortfolioSetupForm wiring documented in .claude/rules/frontend.md).
  useEffect(() => {
    const sub = form.watch((_, info) => {
      if (info.type === 'change' && info.name && !form.formState.touchedFields[info.name]) {
        void form.trigger(info.name);
      }
    });
    return () => sub.unsubscribe();
  }, [form]);

  const { run: runCreate, inFlight: createInFlight } = useGuardedSubmit(
    async (values: AddRateFormValues) => {
      try {
        await createMutation.mutateAsync({
          from,
          to,
          date: values.date,
          rate: values.rate,
        });
        form.reset({
          date: values.date,
          rate: '',
        });
      } catch {
        // global MutationCache error toast handles user-visible feedback
      }
    },
  );

  const handleSubmitForm = form.handleSubmit(
    (values) => void runCreate(values),
    () => {
      toast.error(t('fillRequired'));
    },
  );

  // ── Zone 3b: ECB CSV import ────────────────────────────────────────
  const importMutation = useImportEcbCsv();
  const fileRef = useRef<HTMLInputElement | null>(null);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    // Reset the input so re-selecting the same file refires the change event.
    e.target.value = '';
    try {
      const res = await importMutation.mutateAsync(file);
      toast.success(
        `${t('imported', { count: res.inserted })} · ${t('skipped', { count: res.skipped })}`,
      );
    } catch {
      // global MutationCache error toast handles user-visible feedback
    }
  }

  // Render ────────────────────────────────────────────────────────────
  return (
    <main className="qv-page mx-auto max-w-5xl p-6 space-y-6">
      <PageHeader title={t('title')} subtitle={t('subtitle')} />

      {/* Zone 1: pair selector */}
      <Card>
        <CardHeader>
          <CardTitle>{t('pairs')}</CardTitle>
          {pairs.length === 0 && (
            <CardDescription>{t('noPairs')}</CardDescription>
          )}
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="fx-from">{t('from')}</Label>
              <Select value={from} onValueChange={setFrom}>
                <SelectTrigger id="fx-from" className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {currencyOptions.map(c => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="mb-0.5"
              onClick={handleSwap}
              aria-label={t('switchCurrencies')}
              title={t('switchCurrencies')}
            >
              <ArrowLeftRight className="h-4 w-4" />
            </Button>
            <div className="space-y-1.5">
              <Label htmlFor="fx-to">{t('to')}</Label>
              <Select value={to} onValueChange={setTo}>
                <SelectTrigger id="fx-to" className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {currencyOptions.map(c => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {sameCurrency && (
            <Alert variant="destructive" className="mt-4">
              <AlertDescription>{t('errors.sameCurrency')}</AlertDescription>
            </Alert>
          )}
          {/* TODO: rate chart — Phase 3-B */}
        </CardContent>
      </Card>

      {/* Zone 2: rate history table */}
      <Card>
        <CardHeader>
          <CardTitle>
            <span className="qv-numeric">{from}</span>
            <span className="text-muted-foreground"> / </span>
            <span className="qv-numeric">{to}</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {sameCurrency ? (
            <EmptyState icon={Coins} title={t('errors.sameCurrency')} />
          ) : rates.length === 0 && !ratesQuery.isLoading ? (
            <EmptyState icon={Coins} title={t('noRates')} />
          ) : (
            <DataTable
              columns={cols}
              data={rates}
              isLoading={ratesQuery.isLoading}
              skeletonRows={8}
              tableId="fx-rates"
              defaultSorting={[{ id: 'date', desc: true }]}
              pagination
              pageSize={25}
            />
          )}
        </CardContent>
      </Card>

      {/* Zone 3a: add rate */}
      <Card>
        <CardHeader>
          <CardTitle>{t('addRate')}</CardTitle>
          <CardDescription>
            <span className="qv-numeric">{from}</span>
            <span className="text-muted-foreground"> → </span>
            <span className="qv-numeric">{to}</span>
          </CardDescription>
        </CardHeader>
        <CardContent>
          {sameCurrency ? (
            <p className="text-sm text-muted-foreground">{t('selectPairFirst')}</p>
          ) : (
            <Form {...form}>
              <form onSubmit={handleSubmitForm} className="flex flex-wrap items-end gap-3">
                <FormField
                  control={form.control}
                  name="date"
                  render={({ field }) => (
                    <FormItem className="w-44">
                      <FormLabel>{t('date')}</FormLabel>
                      <FormControl>
                        <Input type="date" {...field} />
                      </FormControl>
                      <FormMessage>
                        {form.formState.errors.date?.message
                          ? t(form.formState.errors.date.message)
                          : null}
                      </FormMessage>
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="rate"
                  render={({ field }) => (
                    <FormItem className="w-40">
                      <FormLabel>{t('rate')}</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          inputMode="decimal"
                          placeholder="1.0850"
                          className="qv-numeric"
                        />
                      </FormControl>
                      <FormMessage>
                        {form.formState.errors.rate?.message
                          ? t(form.formState.errors.rate.message)
                          : null}
                      </FormMessage>
                    </FormItem>
                  )}
                />
                <Button
                  type="submit"
                  disabled={
                    createInFlight ||
                    createMutation.isPending ||
                    !form.formState.isValid
                  }
                >
                  {createInFlight || createMutation.isPending
                    ? t('submitting')
                    : t('submit')}
                </Button>
              </form>
            </Form>
          )}
        </CardContent>
      </Card>

      {/* Zone 3b: ECB CSV import */}
      <Card>
        <CardHeader>
          <CardTitle>{t('import')}</CardTitle>
          <CardDescription>{t('importHint')}</CardDescription>
        </CardHeader>
        <CardContent>
          <input
            ref={fileRef}
            type="file"
            accept=".csv"
            className="hidden"
            onChange={(e) => void handleFileChange(e)}
          />
          <Button
            type="button"
            variant="outline"
            onClick={() => fileRef.current?.click()}
            disabled={importMutation.isPending}
          >
            <Upload className="mr-2 h-4 w-4" />
            {importMutation.isPending ? t('submitting') : t('chooseFile')}
          </Button>
        </CardContent>
      </Card>

      {/* Delete confirm dialog */}
      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('deleteConfirm')}</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget
                ? `${from} → ${to} · ${formatDate(deleteTarget.date)} · ${deleteTarget.rate}`
                : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tCommon('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (deleteTarget) void runDelete(deleteTarget);
              }}
              disabled={deleteInFlight}
            >
              {t('delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}
