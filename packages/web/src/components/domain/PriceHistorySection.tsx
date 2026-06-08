import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
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
import { formatDate, formatNumber } from '@/lib/formatters';

import {
  useRawPrices,
  useCreatePrice,
  useEditPrice,
  useDeletePrice,
  useDeleteAllPrices,
  useDerivePrices,
  type RawPriceRow,
} from '@/api/use-manual-prices';
import {
  buildPriceFormSchema,
  toWirePayload,
  rowToFormValues,
  EMPTY_FORM,
  type PriceFormValues,
} from './price-history-form.schema';

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

  // Schema depends only on `t` (per-language stable from useTranslation), so a
  // plain useMemo([t]) is sufficient — no schema-ref dance like the dynamic
  // transaction form needs.
  const schema = useMemo(() => buildPriceFormSchema(t), [t]);

  const form = useForm<PriceFormValues>({
    resolver: zodResolver(schema),
    mode: 'onBlur',
    reValidateMode: 'onChange',
    defaultValues: initialValues,
  });

  useFormRevalidateOnChange(form);

  // Reset to the current initialValues whenever the dialog opens, so reopening
  // Add after a Cancel never shows stale values (Cancel + submit-close bypass the
  // Dialog-root onOpenChange reset, and the key is identical across two Add opens).
  useEffect(() => {
    if (open) form.reset(initialValues);
  }, [open, initialValues, form]);

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
  const [deleteAllConfirmOpen, setDeleteAllConfirmOpen] = useState(false);

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

  const { run: confirmDeleteAll, inFlight: deleteAllInFlight } = useGuardedSubmit(async () => {
    try {
      await deleteAllMutation.mutateAsync();
      setDeleteAllConfirmOpen(false);
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
          <span>{formatNumber(row.original.volume, { maximumFractionDigits: 0 })}</span>
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
            onClick={() => setDeleteAllConfirmOpen(true)}
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

      {/* Delete-all confirmation */}
      <AlertDialog open={deleteAllConfirmOpen} onOpenChange={setDeleteAllConfirmOpen}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>{t('priceHistory.deleteAll')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('priceHistory.confirmDeleteAll')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('priceHistory.form.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={(e) => {
                e.preventDefault();
                void confirmDeleteAll();
              }}
              disabled={deleteAllInFlight || deleteAllMutation.isPending}
            >
              {t('priceHistory.deleteAll')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
