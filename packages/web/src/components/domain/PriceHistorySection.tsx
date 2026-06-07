import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Pencil, Trash2, PlusCircle, RefreshCw, Trash } from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { DataTable } from '@/components/shared/DataTable';
import { CurrencyDisplay } from '@/components/shared/CurrencyDisplay';
import { SubmitButton } from '@/components/shared/SubmitButton';
import { useGuardedSubmit } from '@/hooks/use-guarded-submit';
import { useFormRevalidateOnChange } from '@/hooks/use-form-revalidate-on-change';
import { formatDate } from '@/lib/formatters';

import {
  useRawPrices,
  useCreatePrice,
  useEditPrice,
  useDeletePrice,
  useDeleteAllPrices,
  useDerivePrices,
  type RawPriceRow,
} from '@/api/use-manual-prices';
import type { ManualPriceInput } from '@quovibe/shared';

// ---------------------------------------------------------------------------
// Form schema — all-strings so optional fields can be '' (empty input).
// We convert '' → undefined and volume string → number on submit.
// Using wire schema (manualPriceSchema) directly would fail Save gate
// because positiveDecimal rejects '' and volume expects a number.
// ---------------------------------------------------------------------------

const positiveDecimalStr = z
  .string()
  .regex(/^(0|[1-9]\d*)(\.\d+)?$/, 'INVALID_VALUE')
  .refine((s) => parseFloat(s) > 0, 'INVALID_VALUE');

const optionalDecimalStr = z
  .string()
  .optional()
  .refine(
    (s) => s === undefined || s === '' || /^(0|[1-9]\d*)(\.\d+)?$/.test(s),
    'INVALID_VALUE',
  )
  .refine(
    (s) => s === undefined || s === '' || parseFloat(s) > 0,
    'INVALID_VALUE',
  );

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'INVALID_DATE');

const priceFormSchema = z.object({
  date: isoDate,
  value: positiveDecimalStr,
  open: optionalDecimalStr,
  high: optionalDecimalStr,
  low: optionalDecimalStr,
  volume: z
    .string()
    .optional()
    .refine(
      (s) => s === undefined || s === '' || /^\d+$/.test(s),
      'INVALID_VALUE',
    ),
});

type PriceFormValues = z.infer<typeof priceFormSchema>;

/** Convert form values to the wire payload. '' → undefined, volume string → number. */
function toWirePayload(values: PriceFormValues): ManualPriceInput {
  const coerce = (s: string | undefined): string | undefined =>
    s && s.trim() !== '' ? s.trim() : undefined;
  const coerceVol = (s: string | undefined): number | undefined => {
    const n = s && s.trim() !== '' ? parseInt(s.trim(), 10) : undefined; // native-ok
    return n !== undefined && !isNaN(n) ? n : undefined; // native-ok
  };
  return {
    date: values.date,
    value: values.value,
    open: coerce(values.open),
    high: coerce(values.high),
    low: coerce(values.low),
    volume: coerceVol(values.volume),
  };
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface PriceHistorySectionProps {
  securityId: string;
  currency: string;
}

// ---------------------------------------------------------------------------
// Add / Edit dialog
// ---------------------------------------------------------------------------

interface PriceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'add' | 'edit';
  editingDate: string | null;
  initialValues: PriceFormValues;
  securityId: string;
}

function PriceDialog({
  open,
  onOpenChange,
  mode,
  editingDate,
  initialValues,
  securityId,
}: PriceDialogProps) {
  const { t } = useTranslation('securities');
  const createMutation = useCreatePrice(securityId);
  const editMutation = useEditPrice(securityId);

  const form = useForm<PriceFormValues>({
    resolver: zodResolver(priceFormSchema),
    mode: 'onBlur',
    reValidateMode: 'onChange',
    defaultValues: initialValues,
  });

  // When dialog opens with new initialValues (edit mode), reset the form.
  // We rely on the parent calling onOpenChange(false) + re-opening with new
  // initialValues — the form's key on the Dialog resets state fully.
  useFormRevalidateOnChange(form);

  const activeMutation = mode === 'edit' ? editMutation : createMutation;

  const { run: handleSubmit, inFlight } = useGuardedSubmit(async (values: PriceFormValues) => {
    const payload = toWirePayload(values);
    try {
      if (mode === 'edit' && editingDate) {
        await editMutation.mutateAsync({ oldDate: editingDate, input: payload });
      } else {
        await createMutation.mutateAsync(payload);
      }
      onOpenChange(false);
    } catch {
      // Global MutationCache toast surfaces the error; nothing to do locally.
    }
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) form.reset(initialValues);
        onOpenChange(isOpen);
      }}
    >
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>
            {mode === 'edit' ? t('priceHistory.form.title.edit') : t('priceHistory.form.title.add')}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {mode === 'edit' ? t('priceHistory.form.title.edit') : t('priceHistory.form.title.add')}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit((values) => void handleSubmit(values))}
            className="space-y-4"
          >
            {/* Date */}
            <FormField
              control={form.control}
              name="date"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('priceHistory.form.date')}</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="YYYY-MM-DD" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Quote (value) */}
            <FormField
              control={form.control}
              name="value"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('priceHistory.form.value')}</FormLabel>
                  <FormControl>
                    <Input {...field} inputMode="decimal" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Open */}
            <FormField
              control={form.control}
              name="open"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('priceHistory.form.open')}</FormLabel>
                  <FormControl>
                    <Input {...field} inputMode="decimal" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* High */}
            <FormField
              control={form.control}
              name="high"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('priceHistory.form.high')}</FormLabel>
                  <FormControl>
                    <Input {...field} inputMode="decimal" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Low */}
            <FormField
              control={form.control}
              name="low"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('priceHistory.form.low')}</FormLabel>
                  <FormControl>
                    <Input {...field} inputMode="decimal" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Volume */}
            <FormField
              control={form.control}
              name="volume"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('priceHistory.form.volume')}</FormLabel>
                  <FormControl>
                    <Input {...field} inputMode="numeric" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => onOpenChange(false)}
              >
                {t('priceHistory.form.cancel')}
              </Button>
              <SubmitButton
                type="submit"
                mutation={activeMutation}
                disabled={!form.formState.isValid || form.formState.isSubmitting || inFlight}
              >
                {t('priceHistory.form.save')}
              </SubmitButton>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Main section
// ---------------------------------------------------------------------------

/** Default (empty) form values for the Add dialog. */
const EMPTY_FORM: PriceFormValues = {
  date: '',
  value: '',
  open: '',
  high: '',
  low: '',
  volume: '',
};

/** Build form values pre-populated from an existing row (for Edit). */
function rowToFormValues(row: RawPriceRow): PriceFormValues {
  return {
    date: row.date,
    value: row.value,
    open: row.open ?? '',
    high: row.high ?? '',
    low: row.low ?? '',
    volume: row.volume != null ? String(row.volume) : '',
  };
}

export function PriceHistorySection({ securityId, currency }: PriceHistorySectionProps) {
  const { t } = useTranslation('securities');

  const { data, isLoading } = useRawPrices(securityId);
  const rows = data?.prices ?? [];

  const deletePriceMutation = useDeletePrice(securityId);
  const deleteAllMutation = useDeleteAllPrices(securityId);
  const deriveMutation = useDerivePrices(securityId);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<'add' | 'edit'>('add');
  const [editingDate, setEditingDate] = useState<string | null>(null);
  const [dialogInitialValues, setDialogInitialValues] = useState<PriceFormValues>(EMPTY_FORM);

  function openAdd() {
    setDialogMode('add');
    setEditingDate(null);
    setDialogInitialValues(EMPTY_FORM);
    setDialogOpen(true);
  }

  function openEdit(row: RawPriceRow) {
    setDialogMode('edit');
    setEditingDate(row.date);
    setDialogInitialValues(rowToFormValues(row));
    setDialogOpen(true);
  }

  function handleDelete(date: string) {
    deletePriceMutation.mutate(date);
  }

  const { run: handleDeleteAll, inFlight: deleteAllInFlight } = useGuardedSubmit(async () => {
    const confirmed = window.confirm(t('priceHistory.confirmDeleteAll'));
    if (!confirmed) return;
    try {
      await deleteAllMutation.mutateAsync();
    } catch {
      // Global MutationCache toast surfaces the error.
    }
  });

  const { run: handleFillFromTrades, inFlight: deriveInFlight } = useGuardedSubmit(async () => {
    try {
      const result = await deriveMutation.mutateAsync();
      const msg = t('priceHistory.deriveResult', {
        written: result.written,
        skipped: result.skipped,
      });
      const hint = result.skipped > 0 ? ` ${t('priceHistory.deriveSkippedHint')}` : '';
      toast.success(msg + hint);
    } catch {
      // Global MutationCache toast surfaces the error.
    }
  });

  const columns: ColumnDef<RawPriceRow>[] = [
    {
      accessorKey: 'date',
      header: t('priceHistory.columns.date'),
      cell: ({ row }) => formatDate(row.original.date),
    },
    {
      accessorKey: 'value',
      header: t('priceHistory.columns.value'),
      cell: ({ row }) => (
        <CurrencyDisplay
          value={parseFloat(row.original.value)}
          currency={currency}
        />
      ),
    },
    {
      accessorKey: 'open',
      header: t('priceHistory.columns.open'),
      cell: ({ row }) =>
        row.original.open != null ? (
          <CurrencyDisplay value={parseFloat(row.original.open)} currency={currency} />
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      accessorKey: 'high',
      header: t('priceHistory.columns.high'),
      cell: ({ row }) =>
        row.original.high != null ? (
          <CurrencyDisplay value={parseFloat(row.original.high)} currency={currency} />
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      accessorKey: 'low',
      header: t('priceHistory.columns.low'),
      cell: ({ row }) =>
        row.original.low != null ? (
          <CurrencyDisplay value={parseFloat(row.original.low)} currency={currency} />
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      accessorKey: 'volume',
      header: t('priceHistory.columns.volume'),
      cell: ({ row }) =>
        row.original.volume != null ? (
          <span>{row.original.volume.toLocaleString()}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      id: 'actions',
      enableSorting: false,
      meta: { locked: true },
      cell: ({ row }) => (
        <div className="flex gap-1 justify-end">
          <Button
            size="icon"
            variant="ghost"
            aria-label={t('priceHistory.edit')}
            onClick={() => openEdit(row.original)}
          >
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            aria-label={t('priceHistory.delete')}
            onClick={() => handleDelete(row.original.date)}
            disabled={deletePriceMutation.isPending}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium flex-1">{t('priceHistory.title')}</span>
        <Button size="sm" variant="outline" onClick={openAdd}>
          <PlusCircle className="h-4 w-4 mr-1" />
          {t('priceHistory.addPrice')}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => void handleFillFromTrades()}
          disabled={deriveInFlight || deriveMutation.isPending}
        >
          <RefreshCw className="h-4 w-4 mr-1" />
          {t('priceHistory.fillFromTrades')}
        </Button>
        {rows.length > 0 && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => void handleDeleteAll()}
            disabled={deleteAllInFlight || deleteAllMutation.isPending}
          >
            <Trash className="h-4 w-4 mr-1" />
            {t('priceHistory.deleteAll')}
          </Button>
        )}
      </div>

      {/* Table or empty state */}
      {rows.length === 0 && !isLoading ? (
        <p className="text-sm text-muted-foreground py-4 text-center">
          {t('priceHistory.empty')}
        </p>
      ) : (
        <DataTable
          columns={columns}
          data={rows}
          isLoading={isLoading}
          pageSize={20}
        />
      )}

      {/* Add / Edit dialog — key forces a fresh form when mode/date changes */}
      <PriceDialog
        key={`${dialogMode}-${editingDate ?? 'new'}`}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        mode={dialogMode}
        editingDate={editingDate}
        initialValues={dialogInitialValues}
        securityId={securityId}
      />
    </div>
  );
}
