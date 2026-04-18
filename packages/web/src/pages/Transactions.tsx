import { useState, useEffect, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import type { ColumnDef } from '@tanstack/react-table';
import { ListX, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { dateColumnMeta, textColumnMeta, currencyColumnMeta, sharesColumnMeta } from '@/lib/column-factories';
import { type ColumnVisibilityGroup } from '@/components/shared/DataTable';
import { TableToolbar } from '@/components/shared/TableToolbar';
import { parseISO, differenceInCalendarDays } from 'date-fns';
import { toast } from 'sonner';
import { TransactionType } from '@/lib/enums';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { DataTable } from '@/components/shared/DataTable';
import { CurrencyDisplay } from '@/components/shared/CurrencyDisplay';
import { SharesDisplay } from '@/components/shared/SharesDisplay';
import { useTransactions, useDeleteTransaction } from '@/api/use-transactions';
import { EditRemovalDialog } from '@/components/domain/EditRemovalDialog';
import { EditBuyDialog } from '@/components/domain/EditBuyDialog';
import { EditSellDialog } from '@/components/domain/EditSellDialog';
import { EditTransferOutboundDialog } from '@/components/domain/EditTransferOutboundDialog';
import { EditTaxRefundDialog } from '@/components/domain/EditTaxRefundDialog';
import { EditCashDialog } from '@/components/domain/EditCashDialog';
import { EditDeliveryDialog } from '@/components/domain/EditDeliveryDialog';
import { EditSecurityTransferDialog } from '@/components/domain/EditSecurityTransferDialog';
import { useAccounts } from '@/api/use-accounts';
import { useSecurities } from '@/api/use-securities';
import type { TransactionListItem } from '@/api/types';
import { formatDate } from '@/lib/formatters';
import { getPageNumbers } from '@/lib/pagination';
import { cn, txTypeKey } from '@/lib/utils';
import { FadeIn } from '@/components/shared/FadeIn';
import { PageHeader } from '@/components/shared/PageHeader';
import { EmptyState } from '@/components/shared/EmptyState';
import { Label } from '@/components/ui/label';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from '@/components/ui/sheet';
import { ScrollArea } from '@/components/ui/scroll-area';
import { TransactionForm, type TransactionFormValues } from '@/components/domain/TransactionForm';
import { TypeBadge } from '@/components/shared/TypeBadge';
import { AccountAvatar } from '@/components/shared/AccountAvatar';
import { useCreateTransaction } from '@/api/use-transactions';
import { preparePayload } from '@/lib/transaction-payload';
import { getTransactionCashflowSign } from '@/lib/transaction-display';

function NoteCell({ value }: { value: string | null }) {
  if (!value) return null;
  const truncated = value.length > 30;
  const display = truncated ? value.slice(0, 30) + '…' : value;

  if (truncated) {
    return (
      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="text-muted-foreground text-xs cursor-help">{display}</span>
          </TooltipTrigger>
          <TooltipContent side="top">
            <p className="max-w-xs text-xs">{value}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return <span className="text-muted-foreground text-xs">{value}</span>;
}

function buildColumns(
  onDelete: (uuid: string) => void,
  onEdit: (row: TransactionListItem) => void,
  t: (key: string, opts?: Record<string, unknown>) => string,
  tCommon: (key: string, opts?: Record<string, unknown>) => string,
  logoMap: Map<string, string>,
  accountLogoMap: Map<string, string>,
): ColumnDef<TransactionListItem>[] {
  const today = new Date();
  return [
    {
      accessorKey: 'date',
      size: 170,
      minSize: 130,
      ...dateColumnMeta(),
      header: t('columns.date'),
      cell: ({ getValue }) => {
        const dateStr = getValue<string>();
        const formatted = formatDate(dateStr);
        const diffDays = differenceInCalendarDays(today, parseISO(dateStr));
        let rel: string | null = null;
        if (diffDays === 0) rel = t('relative.today');
        else if (diffDays === 1) rel = t('relative.yesterday');
        return (
          <div>
            <span>{formatted}</span>
            {rel && <span className="text-muted-foreground text-[10px] ml-1.5">{rel}</span>}
          </div>
        );
      },
    },
    {
      accessorKey: 'type',
      size: 110,
      minSize: 90,
      ...textColumnMeta(),
      header: t('columns.type'),
      cell: ({ row }) => <TypeBadge type={row.original.type} direction={row.original.direction} />,
    },
    {
      accessorKey: 'accountName',
      size: 160,
      minSize: 100,
      ...textColumnMeta(),
      header: t('columns.account'),
      cell: ({ row }) => {
        const name = row.original.accountName ?? null;
        const logo = accountLogoMap.get(row.original.account ?? '');
        if (!name) return <span className="text-muted-foreground">—</span>;
        return (
          <div className="flex items-center gap-2 min-w-0">
            <AccountAvatar name={name} logoUrl={logo} size="xs" />
            <span className="font-medium truncate">{name}</span>
          </div>
        );
      },
    },
    {
      accessorKey: 'note',
      size: 200,
      minSize: 80,
      ...textColumnMeta(),
      header: t('columns.note'),
      cell: ({ getValue }) => <NoteCell value={getValue<string | null>()} />,
    },
    {
      accessorKey: 'securityName',
      size: 180,
      minSize: 120,
      ...textColumnMeta(),
      header: t('columns.security'),
      cell: ({ row }) => {
        const name = row.original.securityName;
        if (!name) return '—';
        const logo = logoMap.get(row.original.securityId ?? '');
        return (
          <div className="flex items-center gap-2">
            {logo ? (
              <img src={logo} alt="" className="h-5 w-5 rounded-md object-contain shrink-0" />
            ) : (
              <div className="h-5 w-5 shrink-0" />
            )}
            <span className="font-medium">{name}</span>
          </div>
        );
      },
    },
    {
      accessorKey: 'amount',
      size: 140,
      minSize: 100,
      ...currencyColumnMeta(),
      header: t('columns.amount'),
      cell: ({ row }) => {
        const v = row.original.amount;
        if (!v) return <div className="text-right">—</div>;
        const absValue = Math.abs(parseFloat(v));
        const sign = getTransactionCashflowSign(row.original.type, row.original.direction, 'securities');
        return (
          <div className="text-right">
            <CurrencyDisplay
              value={absValue}
              currency={row.original.currencyCode}
              colorize={sign !== 0}
              colorSign={sign !== 0 ? sign : undefined}
            />
          </div>
        );
      },
    },
    {
      accessorKey: 'shares',
      size: 100,
      minSize: 70,
      ...sharesColumnMeta(),
      header: t('columns.shares'),
      cell: ({ getValue }) => (
        <div className="text-right">
          <SharesDisplay value={getValue<string | null>()} className="text-sm" />
        </div>
      ),
    },
    {
      id: 'actions',
      size: 50,
      minSize: 40,
      header: '',
      meta: { sticky: 'right', locked: true },
      cell: ({ row }) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={(e) => e.stopPropagation()}
              aria-label={t('a11y.rowActions', {
                type: t('types.' + txTypeKey(row.original.type)),
                date: formatDate(row.original.date),
              })}
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()} onCloseAutoFocus={(e) => e.preventDefault()}>
            {['REMOVAL', 'BUY', 'SELL', 'TRANSFER_BETWEEN_ACCOUNTS',
  'TAX_REFUND', 'DEPOSIT', 'DIVIDEND', 'INTEREST', 'INTEREST_CHARGE',
  'FEES', 'FEES_REFUND', 'TAXES',
  'DELIVERY_INBOUND', 'DELIVERY_OUTBOUND', 'SECURITY_TRANSFER',
].includes(row.original.type) && (
              <DropdownMenuItem onClick={() => onEdit(row.original)}>
                <Pencil className="mr-2 h-4 w-4" />
                {t('actions.edit')}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={() => onDelete(row.original.uuid)}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              {t('actions.delete')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];
}

const ALL_TYPES = ['ALL', ...Object.values(TransactionType)] as const;

const PAGE_SIZE = 25;


export default function Transactions() {
  useDocumentTitle('Transactions');
  const { t } = useTranslation('transactions');
  const { t: tCommon } = useTranslation('common');
  const [searchParams, setSearchParams] = useSearchParams();
  const periodStart = searchParams.get('periodStart');
  const periodEnd = searchParams.get('periodEnd');

  const [showRetired, setShowRetired] = useState(false);
  const [typeFilter, setTypeFilter] = useState('ALL');
  const [accountFilter, setAccountFilter] = useState('ALL');
  const [securityFilter, setSecurityFilter] = useState('ALL');
  const [page, setPage] = useState(1);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [editTarget, setEditTarget] = useState<TransactionListItem | null>(null);

  const [newSheetOpen, setNewSheetOpen] = useState(false);
  const [newTxType, setNewTxType] = useState<TransactionType>(TransactionType.BUY);
  const newTxFormRef = useRef<HTMLFormElement>(null);
  const createMutation = useCreateTransaction();

  const deleteMutation = useDeleteTransaction();

  const columnVisibilityGroups = useMemo<ColumnVisibilityGroup[]>(() => [
    { label: t('columnGroups.core'), columns: ['date', 'type', 'securityName', 'accountName'] },
    { label: t('columnGroups.financial'), columns: ['amount', 'shares'] },
    { label: t('columnGroups.details'), columns: ['note'] },
  ], [t]);

  // ─── Search ──────────────────────────────────────────────────────────────
  const searchFromUrl = searchParams.get('search') ?? '';
  const [searchInput, setSearchInput] = useState(searchFromUrl);

  const isFirstRender = useRef(true);

  // Debounce: sync searchInput → URL param after 300ms, with replace: true
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    const timer = setTimeout(() => {
      setSearchParams(prev => {
        const next = new URLSearchParams(prev);
        if (searchInput) {
          next.set('search', searchInput);
        } else {
          next.delete('search');
        }
        return next;
      }, { replace: true });
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);


  useEffect(() => { setPage(1); }, [periodStart, periodEnd]);

  const search = searchParams.get('search') ?? '';
  const filters: Record<string, string> = {};
  if (periodStart) filters.from = periodStart;
  if (periodEnd) filters.to = periodEnd;
  if (typeFilter !== 'ALL') filters.type = typeFilter;
  if (accountFilter !== 'ALL') filters.account = accountFilter;
  if (securityFilter !== 'ALL') filters.security = securityFilter;
  if (search) filters.search = search;

  const { data: result, isLoading, isFetching } = useTransactions(filters, page, PAGE_SIZE);
  const transactions = result?.data ?? [];
  const total = result?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const { data: accounts = [] } = useAccounts(showRetired);
  const { data: securities = [] } = useSecurities(showRetired);

  const logoMap = useMemo(() => {
    const map = new Map<string, string>();
    securities.forEach(s => { if (s.logoUrl) map.set(s.id, s.logoUrl); });
    return map;
  }, [securities]);

  const accountLogoMap = useMemo(() => {
    const map = new Map<string, string>();
    accounts.forEach(a => { if (a.logoUrl) map.set(a.id, a.logoUrl); });
    // Inherit logo: portfolio → linked cash account (if cash has no logo of its own)
    accounts.forEach(a => {
      if (a.logoUrl && a.referenceAccountId && !map.has(a.referenceAccountId)) {
        map.set(a.referenceAccountId, a.logoUrl);
      }
    });
    return map;
  }, [accounts]);

  const hasActiveFilters = typeFilter !== 'ALL' || accountFilter !== 'ALL' || securityFilter !== 'ALL' || !!search;

  function handleFilterChange(setter: (v: string) => void) {
    return (v: string) => { setter(v); setPage(1); };
  }

  const columns = useMemo(
    () => buildColumns(setDeleteTarget, setEditTarget, t, tCommon, logoMap, accountLogoMap),
    [t, tCommon, logoMap, accountLogoMap],
  );

  function handleConfirmDelete() {
    if (!deleteTarget) return;
    deleteMutation.mutate(deleteTarget, {
      onSuccess: () => {
        toast.success(tCommon('toasts.transactionDeleted'));
        setDeleteTarget(null);
      },
      onError: () => {
        toast.error(tCommon('toasts.errorDeleting'));
        setDeleteTarget(null);
      },
    });
  }

  function clearAllFilters() {
    setTypeFilter('ALL');
    setAccountFilter('ALL');
    setSecurityFilter('ALL');
    setSearchInput('');
  }

  function handleNewTxSubmit(values: TransactionFormValues) {
    createMutation.mutate(preparePayload(values), {
      onSuccess: () => {
        toast.success(tCommon('toasts.transactionCreated'));
        setNewSheetOpen(false);
      },
      onError: () => {
        toast.error(tCommon('toasts.errorSaving'));
      },
    });
  }

  return (
    <div className="qv-page space-y-6">
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        actions={<Button size="sm" onClick={() => setNewSheetOpen(true)}>{t('actions.new')}</Button>}
      />

      <TableToolbar
        searchValue={searchInput}
        onSearchChange={setSearchInput}
        searchPlaceholder={t('search.placeholder')}
        enableReset={hasActiveFilters}
        onReset={clearAllFilters}
      >
        <Select value={typeFilter} onValueChange={handleFilterChange(setTypeFilter)}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder={t('columns.type')} />
          </SelectTrigger>
          <SelectContent>
            {ALL_TYPES.map((tp) => (
              <SelectItem key={tp} value={tp}>
                {tp === 'ALL' ? t('filters.allTypes') : t('types.' + txTypeKey(tp))}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={accountFilter} onValueChange={handleFilterChange(setAccountFilter)}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder={t('columns.account')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">{t('filters.allAccounts')}</SelectItem>
            {accounts.map((a) => (
              <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={securityFilter} onValueChange={handleFilterChange(setSecurityFilter)}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder={t('columns.security')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">{t('filters.allSecurities')}</SelectItem>
            {securities.map((s) => (
              <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
          <Checkbox
            checked={showRetired}
            onCheckedChange={(v) => setShowRetired(v === true)}
          />
          {tCommon('showRetired')}
        </label>


      </TableToolbar>

      <EditRemovalDialog
        open={!!editTarget && editTarget.type === 'REMOVAL'}
        onOpenChange={(open) => { if (!open) setEditTarget(null); }}
        transaction={editTarget}
      />
      <EditBuyDialog
        open={!!editTarget && editTarget.type === 'BUY'}
        onOpenChange={(open) => { if (!open) setEditTarget(null); }}
        transaction={editTarget}
      />
      <EditSellDialog
        open={!!editTarget && editTarget.type === 'SELL'}
        onOpenChange={(open) => { if (!open) setEditTarget(null); }}
        transaction={editTarget}
      />
      <EditTransferOutboundDialog
        open={!!editTarget && editTarget.type === 'TRANSFER_BETWEEN_ACCOUNTS'}
        onOpenChange={(open) => { if (!open) setEditTarget(null); }}
        transaction={editTarget}
      />
      <EditTaxRefundDialog
        open={!!editTarget && editTarget.type === 'TAX_REFUND'}
        onOpenChange={(open) => { if (!open) setEditTarget(null); }}
        transaction={editTarget}
      />
      <EditCashDialog
        open={!!editTarget && ['DEPOSIT', 'DIVIDEND', 'INTEREST', 'INTEREST_CHARGE', 'FEES', 'FEES_REFUND', 'TAXES'].includes(editTarget.type)}
        onOpenChange={(open) => { if (!open) setEditTarget(null); }}
        transaction={editTarget}
      />
      <EditDeliveryDialog
        open={!!editTarget && ['DELIVERY_INBOUND', 'DELIVERY_OUTBOUND'].includes(editTarget.type)}
        onOpenChange={(open) => { if (!open) setEditTarget(null); }}
        transaction={editTarget}
      />
      <EditSecurityTransferDialog
        open={!!editTarget && editTarget.type === 'SECURITY_TRANSFER'}
        onOpenChange={(open) => { if (!open) setEditTarget(null); }}
        transaction={editTarget}
      />

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{tCommon('deleteConfirm.title')}</AlertDialogTitle>
            <AlertDialogDescription>
              {tCommon('deleteConfirm.description')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tCommon('deleteConfirm.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleConfirmDelete}
            >
              {tCommon('deleteConfirm.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <FadeIn>
      <div
        className={cn(isFetching && !isLoading && 'opacity-60 transition-opacity duration-200')}
        style={{ animation: 'qv-stagger-in 0.4s ease-out both', animationDelay: '120ms' }}
      >
        {!isLoading && transactions.length === 0 ? (
          <EmptyState
            icon={ListX}
            title={search ? t('search.noResults') : t('empty.noResults')}
            description={search ? undefined : t('empty.noResultsHint')}
            action={
              hasActiveFilters ? (
                <Button variant="outline" size="sm" onClick={clearAllFilters}>
                  {t('filters.clearAll')}
                </Button>
              ) : undefined
            }
          />
        ) : (
        <DataTable
          columns={columns}
          data={transactions as TransactionListItem[]}
          isLoading={isLoading}
          skeletonRows={PAGE_SIZE}
          tableId="transactions"
          defaultSorting={[{ id: 'date', desc: true }]}
          defaultColumnVisibility={{ note: false }}
          enableColumnVisibility
          columnVisibilityGroups={columnVisibilityGroups}
          enableExport
        />
        )}
        {!isLoading && transactions.length > 0 && (
          <div className="flex items-center justify-between text-sm text-muted-foreground mt-2">
            <span>
              {tCommon('pagination.showing', {
                from: (page - 1) * PAGE_SIZE + 1,
                to: Math.min(page * PAGE_SIZE, total),
                total,
              })}
            </span>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage(p => p - 1)}
              >
                {tCommon('pagination.previous')}
              </Button>
              {getPageNumbers(page, totalPages).map((n, i) =>
                n === '…' ? (
                  <span key={`ellipsis-${i}`} className="px-2">…</span>
                ) : (
                  <Button
                    key={n}
                    variant={n === page ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setPage(n)}
                  >
                    {n}
                  </Button>
                )
              )}
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage(p => p + 1)}
              >
                {tCommon('pagination.next')}
              </Button>
            </div>
          </div>
        )}
      </div>
      </FadeIn>

      {/* New Transaction Sheet */}
      <Sheet open={newSheetOpen} onOpenChange={setNewSheetOpen}>
        <SheetContent side="right" className="sm:max-w-lg w-full flex flex-col">
          <SheetHeader>
            <SheetTitle>{t('newTransaction')}</SheetTitle>
            <SheetDescription>{t('newTransactionDescription')}</SheetDescription>
          </SheetHeader>
          <div className="px-4 pb-2">
            <Label htmlFor="new-tx-type" className="mb-1.5 block">{t('transactionType')}</Label>
            <Select value={newTxType} onValueChange={(v) => setNewTxType(v as TransactionType)}>
              <SelectTrigger id="new-tx-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.values(TransactionType).map((tp) => (
                  <SelectItem key={tp} value={tp}>{t('types.' + txTypeKey(tp))}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <ScrollArea className="flex-1 min-h-0 px-4">
            <TransactionForm
              key={newTxType}
              type={newTxType}
              onSubmit={handleNewTxSubmit}
              isSubmitting={createMutation.isPending}
              hideSubmitButton
              formRef={newTxFormRef}
            />
          </ScrollArea>
          <SheetFooter className="border-t px-4 py-3 flex-row justify-end gap-2">
            <Button variant="outline" onClick={() => setNewSheetOpen(false)}>
              {t('common:cancel')}
            </Button>
            <Button
              onClick={() => newTxFormRef.current?.requestSubmit()}
              disabled={createMutation.isPending}
            >
              {createMutation.isPending ? t('common:saving') : t('common:save')}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}
