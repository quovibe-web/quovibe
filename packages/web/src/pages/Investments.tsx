import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { VisibilityState } from '@tanstack/react-table';
import type { TableLayoutEntry } from '@quovibe/shared';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Briefcase, Search, X } from 'lucide-react';
import { toast } from 'sonner';
import { DataTable } from '@/components/shared/DataTable';
import { TableToolbar } from '@/components/shared/TableToolbar';
import { CurrencyDisplay } from '@/components/shared/CurrencyDisplay';
import { CashBreakdown } from '@/components/shared/CashBreakdown';
import { FadeIn } from '@/components/shared/FadeIn';
import { PageHeader } from '@/components/shared/PageHeader';
import { SummaryStrip } from '@/components/shared/SummaryStrip';
import { EmptyState } from '@/components/shared/EmptyState';
import { SegmentedControl } from '@/components/shared/SegmentedControl';
import { TaxonomyChart } from '@/components/domain/TaxonomyChart';
import { SecurityEditor, type EditorSection } from '@/components/domain/SecurityEditor';
import { SecurityDrawer } from '@/components/domain/SecurityDrawer';
import { AddInstrumentDialog } from '@/components/domain/AddInstrumentDialog';
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
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { useSecurities, useFetchAllPrices, useDeleteSecurity } from '@/api/use-securities';
import { useAccountDetail, useAccountHoldings } from '@/api/use-accounts';
import { useStatementOfAssets, useHoldings } from '@/api/use-reports';
import { useReportingPeriod, usePerformanceSecurities } from '@/api/use-performance';
import { useInvestmentsView, useSaveInvestmentsView } from '@/api/use-investments-view';
import { layoutKeys } from '@/api/use-table-layout';
import { apiFetch } from '@/api/fetch';
import type { ColumnVisibilityGroup } from '@/components/shared/DataTable';
import { useChartColors } from '@/hooks/use-chart-colors';
import { usePrivacy } from '@/context/privacy-context';
import { useInvestmentsColumns } from '@/hooks/useInvestmentsColumns';
import {
  COLUMN_GROUPS,
  ALL_COLUMN_IDS,
  DEFAULT_COLUMNS,
  PERF_COLUMNS,
  STATEMENT_COLUMNS,
} from '@/hooks/useColumnVisibility';
import { formatPercentage } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import type { StatementSecurityEntry, SecurityPerfResponse, HoldingsItem } from '@/api/types';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';

interface FetchStatusProps {
  totalFetched: number;
  totalLabel: string;
  errorsLabel: string;
  errors: { key: string; label: string; error: string }[];
}

function FetchStatus({ totalFetched, totalLabel, errorsLabel, errors }: FetchStatusProps) {
  return (
    <div className="text-sm text-muted-foreground">
      {totalFetched} {totalLabel}
      {errors.length > 0 && (
        <>
          <span className="text-destructive ml-2">({errors.length} {errorsLabel})</span>
          <ul className="mt-1 space-y-0.5">
            {errors.map(e => (
              <li key={e.key} className="text-destructive">
                <span className="font-medium">{e.label}</span>: {e.error}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

export default function Investments() {
  useDocumentTitle('Investments');
  const { t } = useTranslation('investments');
  const { t: tCommon } = useTranslation('common');
  const { t: tSecurities } = useTranslation('securities');

  const [searchParams, setSearchParams] = useSearchParams();

  // Account filter from URL
  const accountFilterId = searchParams.get('account') ?? null;
  const clearAccountFilter = useCallback(() => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      next.delete('account');
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  // Fetch filter account details when filter is active
  const { data: filterAccount } = useAccountDetail(accountFilterId ?? '');
  const { data: filterHoldings } = useAccountHoldings(accountFilterId ?? '');

  // Fetch deposit account for cash balance when filtering by portfolio
  const { data: depositAccount } = useAccountDetail(filterAccount?.referenceAccountId ?? '');

  // Build periodSearch for navigation (preserve period params in row click URLs)
  const periodSearch = useMemo(() => {
    const params = new URLSearchParams();
    const ps = searchParams.get('periodStart');
    const pe = searchParams.get('periodEnd');
    if (ps) params.set('periodStart', ps);
    if (pe) params.set('periodEnd', pe);
    const str = params.toString();
    return str ? `?${str}` : '';
  }, [searchParams]);

  // Sidecar persistence
  const { data: savedView } = useInvestmentsView();
  const { mutate: saveView } = useSaveInvestmentsView();

  // Build default column visibility: only DEFAULT_COLUMNS visible, rest hidden
  const defaultColumnVisibility = useMemo(() => {
    const vis: Record<string, boolean> = {};
    for (const id of ALL_COLUMN_IDS) {
      vis[id] = (DEFAULT_COLUMNS as readonly string[]).includes(id);
    }
    return vis;
  }, []);

  // Column visibility groups for the DataTable picker
  const columnVisibilityGroups = useMemo<ColumnVisibilityGroup[]>(() => [
    { label: t('columnGroups.position'), columns: [...COLUMN_GROUPS.position] },
    { label: t('columnGroups.performance'), columns: [...COLUMN_GROUPS.performance] },
    { label: t('columnGroups.identity'), columns: [...COLUMN_GROUPS.identity] },
  ], [t]);

  // Read the persisted table layout (read-only — DataTable owns all writes via its own useTableLayout).
  // Using a direct useQuery instead of useTableLayout avoids a duplicate useMutation instance that
  // shared the same query key, causing cancelQueries + setQueryData races when the user toggled columns.
  const queryClient = useQueryClient();
  const layoutQueryKey = layoutKeys.one('investments');
  const { data: savedLayout, isLoading: layoutLoading } = useQuery({
    queryKey: layoutQueryKey,
    queryFn: () => apiFetch<TableLayoutEntry>('/api/settings/table-layouts/investments'),
    staleTime: Infinity,
    retry: false,
  });

  // One-shot mutation used only for the legacy migration and ?view= param writes.
  // After those one-time writes, all persistence is delegated to DataTable's internal useTableLayout.
  const layoutMigrateMutation = useMutation({
    mutationFn: (columnVisibility: VisibilityState) =>
      apiFetch<TableLayoutEntry>('/api/settings/table-layouts/investments', {
        method: 'PUT',
        body: JSON.stringify({ columnVisibility }),
      }),
    onMutate: async (columnVisibility) => {
      await queryClient.cancelQueries({ queryKey: layoutQueryKey });
      const prev = queryClient.getQueryData<TableLayoutEntry>(layoutQueryKey);
      queryClient.setQueryData<TableLayoutEntry>(layoutQueryKey, (old) => ({
        ...(old ?? { sorting: [], columnSizing: {}, columnOrder: [], version: 1 }),
        columnVisibility,
      }));
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(layoutQueryKey, ctx.prev);
    },
  });

  // Derive current visibility from persisted layout (reactive — updates whenever DataTable saves).
  const currentVis: VisibilityState = savedLayout?.columnVisibility ?? defaultColumnVisibility;

  // One-time migration: if old investmentsView.columns has data and the persisted layout is still
  // at defaults, migrate the old visibility into the new unified system.
  const migrationDoneRef = useRef(false);
  useEffect(() => {
    if (migrationDoneRef.current || layoutLoading) return;
    migrationDoneRef.current = true;

    if (savedView?.columns && Array.isArray(savedView.columns) && savedView.columns.length > 0) {
      const isUsingDefaults = Object.keys(currentVis).length === 0 ||
        (ALL_COLUMN_IDS as readonly string[]).every(id =>
          currentVis[id] === defaultColumnVisibility[id]
        );

      if (isUsingDefaults) {
        const vis: Record<string, boolean> = {};
        for (const id of ALL_COLUMN_IDS) {
          vis[id] = (savedView.columns as string[]).includes(id);
        }
        layoutMigrateMutation.mutate(vis);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedView, layoutLoading]);

  // Handle ?view= backward compat: pre-select group columns on first load.
  const viewParam = searchParams.get('view');
  const viewHandledRef = useRef(false);
  useEffect(() => {
    if (!viewParam || viewHandledRef.current || layoutLoading) return;
    viewHandledRef.current = true;
    const groupMap: Record<string, keyof typeof COLUMN_GROUPS> = {
      performance: 'performance',
      detail: 'identity',
    };
    const group = groupMap[viewParam];
    if (group) {
      const groupCols = COLUMN_GROUPS[group] as readonly string[];
      const newVis = { ...currentVis };
      for (const col of groupCols) {
        newVis[col] = true;
      }
      layoutMigrateMutation.mutate(newVis);
    }
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      next.delete('view');
      return next;
    }, { replace: true });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewParam, layoutLoading, setSearchParams]);

  // Derive needsPerf / needsStatement from current column visibility
  const needsPerf = (PERF_COLUMNS as readonly string[]).some(c => currentVis[c] !== false);
  const needsStatement = (STATEMENT_COLUMNS as readonly string[]).some(c => currentVis[c] !== false) || !needsPerf;

  // Persist chartMode and showRetired to sidecar
  const chartMode = savedView?.chartMode ?? 'pie';
  const showRetired = savedView?.showRetired ?? false;

  const setChartMode = (mode: 'pie' | 'treemap' | 'off') => saveView({ chartMode: mode });
  const setShowRetired = (val: boolean) => saveView({ showRetired: val });

  // Local UI state
  const [wizardOpen, setWizardOpen] = useState(false);
  const [createEmptyOpen, setCreateEmptyOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editSection, setEditSection] = useState<EditorSection | undefined>(undefined);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [drawerSecurityId, setDrawerSecurityId] = useState<string | null>(null);

  // Data hooks
  const { periodStart, periodEnd } = useReportingPeriod();
  const { data: securities = [], isLoading: secLoading, isFetching } = useSecurities(showRetired);
  const { data: statement, isLoading: stmtLoading } = useStatementOfAssets(periodEnd, { enabled: needsStatement });
  // Always fetch perf data: the security drawer needs it regardless of which table columns are visible
  const { data: perfData, isLoading: perfLoading } = usePerformanceSecurities({ periodStart, periodEnd });
  const { data: holdings } = useHoldings(periodEnd);
  // Separate loading states: summary/chart depend only on their own data,
  // table loading includes perf data to show skeletons during view switch
  const summaryLoading = secLoading || stmtLoading;
  const tableLoading = secLoading || (needsStatement && stmtLoading) || (needsPerf && perfLoading);
  const fetchAll = useFetchAllPrices();
  const deleteSecurity = useDeleteSecurity();
  const { palette } = useChartColors();
  const { isPrivate } = usePrivacy();

  // Filter securities by account when filter is active
  const accountFiltered = useMemo(() => {
    if (!accountFilterId || !filterHoldings) return securities;
    const heldIds = new Set(filterHoldings.holdings.map(h => h.securityId));
    return securities.filter(s => heldIds.has(s.id));
  }, [securities, accountFilterId, filterHoldings]);

  const trimmedSearchQuery = searchQuery.trim();

  // Client-side search filter (name, ISIN, ticker)
  const filteredSecurities = useMemo(() => {
    const q = trimmedSearchQuery.toLowerCase();
    if (!q) return accountFiltered;
    return accountFiltered.filter(s =>
      s.name.toLowerCase().includes(q) ||
      (s.isin && s.isin.toLowerCase().includes(q)) ||
      (s.ticker && s.ticker.toLowerCase().includes(q))
    );
  }, [accountFiltered, trimmedSearchQuery]);

  // Derived data
  const statementMap = useMemo(() => {
    const map = new Map<string, StatementSecurityEntry>();
    statement?.securities.forEach(s => map.set(s.securityId, s));
    return map;
  }, [statement]);

  const perfMap = useMemo(() => {
    const map = new Map<string, SecurityPerfResponse>();
    perfData?.forEach(p => map.set(p.securityId, p));
    return map;
  }, [perfData]);

  const logoMap = useMemo(() => {
    const map = new Map<string, string>();
    securities.forEach(s => { if (s.logoUrl) map.set(s.id, s.logoUrl); });
    return map;
  }, [securities]);

  const holdingsItems = holdings?.items ?? [];

  // Map per-account holdings to HoldingsItem[] for chart when filter is active
  const mappedFilterHoldings = useMemo((): HoldingsItem[] => {
    if (!accountFilterId || !filterHoldings) return [];
    const total = parseFloat(filterHoldings.totalValue) || 1;
    return filterHoldings.holdings
      .filter(h => parseFloat(h.value) > 0)
      .map((h, i) => ({
        securityId: h.securityId,
        name: h.securityName,
        marketValue: h.value,
        percentage: String((parseFloat(h.value) / total) * 100),
        color: palette[i % palette.length],
      }));
  }, [accountFilterId, filterHoldings, palette]);

  // Unified chart data: per-account or global
  const chartItems = accountFilterId ? mappedFilterHoldings : holdingsItems;
  const chartTotal = accountFilterId ? filterHoldings?.totalValue : holdings?.totalMarketValue;
  const chartCenterLabel = accountFilterId ? filterAccount?.name : undefined;

  const totalSecurityValue = statement ? parseFloat(statement.totals.securityValue) : 0;

  const topHolding = useMemo(() => {
    if (holdingsItems.length === 0) return null;
    return holdingsItems.reduce(
      (top, item) => (parseFloat(item.percentage) > parseFloat(top.percentage) ? item : top),
      holdingsItems[0],
    );
  }, [holdingsItems]);

  // Top holding for filtered mode
  const filteredTopHolding = useMemo(() => {
    if (!accountFilterId || mappedFilterHoldings.length === 0) return null;
    return mappedFilterHoldings.reduce(
      (top, item) => (parseFloat(item.percentage) > parseFloat(top.percentage) ? item : top),
      mappedFilterHoldings[0],
    );
  }, [accountFilterId, mappedFilterHoldings]);

  // Columns
  const columns = useInvestmentsColumns({
    statementMap,
    perfMap,
    totalSecurityValue,
    logoMap,
    onEdit: (id) => handleEdit(id),
    onDelete: (id) => setDeleteTarget(id),
  });

  // Chart mode toggle options
  const chartModes: { value: 'pie' | 'treemap' | 'off'; label: string }[] = [
    { value: 'pie', label: t('chart.pie') },
    { value: 'treemap', label: t('chart.treemap') },
    { value: 'off', label: t('chart.off') },
  ];

  // Handlers
  function handleCreated(id: string) {
    setWizardOpen(false);
    setCreateEmptyOpen(false);
    setEditId(id);
  }

  function handleEdit(id: string, section?: EditorSection) {
    setEditId(id);
    setEditSection(section);
  }

  function handleConfirmDelete() {
    if (!deleteTarget) return;
    deleteSecurity.mutate(deleteTarget, {
      onSuccess: () => {
        toast.success(tCommon('toasts.securityDeleted'));
        setDeleteTarget(null);
      },
      // Error toast is handled by the global MutationCache handler
      // (query-client.ts → errors:server.*). We only clear the dialog state.
      onError: () => { setDeleteTarget(null); },
    });
  }

  const handleFetchAll = () => {
    fetchAll.mutate();
  };

  // Empty-portfolio state: hide controls and summary; only EmptyState owns the page (BUG-44).
  // Scope: only when not filtering to an account and the underlying securities list is truly empty.
  const isEmptyPortfolio = !accountFilterId && !secLoading && securities.length === 0;

  return (
    <div className="qv-page space-y-6">
      {/* Page Header */}
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        actions={isEmptyPortfolio ? undefined : <>
          {/* Chart mode toggle */}
          <SegmentedControl
            segments={chartModes}
            value={chartMode}
            onChange={setChartMode}
          />
          <Separator orientation="vertical" className="h-6" />
          <Button onClick={handleFetchAll} disabled={fetchAll.isPending}>
            {fetchAll.isPending ? tSecurities('actions.updating') : tSecurities('actions.updatePrices')}
          </Button>
          <Button onClick={() => setWizardOpen(true)}>{tSecurities('actions.addInstrument')}</Button>
        </>}
      />

      {!isEmptyPortfolio && fetchAll.isSuccess && fetchAll.data && (
        <FetchStatus
          totalFetched={fetchAll.data.totalFetched}
          totalLabel={tSecurities('updateResults.pricesUpdated')}
          errorsLabel={tSecurities('updateResults.errors')}
          errors={fetchAll.data.results
            .filter(r => r.error)
            .map(r => ({ key: r.securityId, label: r.name, error: r.error! }))}
        />
      )}

      {/* Summary strip — global or per-account */}
      {!isEmptyPortfolio && ((!accountFilterId && !summaryLoading && statement) || (accountFilterId && filterHoldings)) && (
        <SummaryStrip
          columns={4}
          items={[
            {
              label: t('summary.totalMV'),
              value: accountFilterId ? (
                <CurrencyDisplay value={parseFloat(filterHoldings!.totalValue)} colorize className="text-2xl font-semibold tabular-nums" />
              ) : statement ? (
                <CurrencyDisplay value={parseFloat(statement.totals.marketValue)} colorize className="text-2xl font-semibold tabular-nums" />
              ) : (
                <span className="text-2xl font-semibold text-muted-foreground">—</span>
              ),
            },
            {
              label: t('summary.holdings'),
              // Card describes the portfolio (or the filtered account) — never the search query (BUG-24).
              // Excludes zero-share / closed positions to align with the pie-chart legend (BUG-25).
              value: <span className="text-2xl font-semibold tabular-nums">
                {accountFilterId
                  ? filterHoldings!.holdings.filter(h => parseFloat(h.shares) > 0).length
                  : accountFiltered.filter(s => !s.isRetired && parseFloat(s.shares ?? '0') > 0).length}
              </span>,
            },
            {
              label: t('summary.cash'),
              value: accountFilterId ? (
                depositAccount ? (
                  <CurrencyDisplay value={parseFloat(depositAccount.balance)} colorize className="text-2xl font-semibold tabular-nums" />
                ) : (
                  <span className="text-2xl font-semibold text-muted-foreground">—</span>
                )
              ) : statement ? (
                <div>
                  <CurrencyDisplay value={parseFloat(statement.totals.cashValue)} colorize className="text-2xl font-semibold tabular-nums" />
                  <CashBreakdown cashByCurrency={statement.totals.cashByCurrency ?? []} className="mt-1" />
                </div>
              ) : (
                <span className="text-2xl font-semibold text-muted-foreground">—</span>
              ),
            },
            {
              label: t('summary.largest'),
              value: (() => {
                const top = accountFilterId ? filteredTopHolding : topHolding;
                if (!top) return <span className="text-2xl font-semibold text-muted-foreground">—</span>;
                return (
                  <>
                    <span className="text-lg font-semibold truncate block">
                      {top.name}
                    </span>
                    <span className="text-sm text-muted-foreground tabular-nums">
                      {isPrivate ? '••••' : formatPercentage(parseFloat(top.percentage) / 100)}
                    </span>
                  </>
                );
              })(),
            },
          ]}
        />
      )}

      {/* Allocation chart — global or per-account */}
      {!isEmptyPortfolio && chartMode !== 'off' && chartItems.length > 0 && (!accountFilterId ? !summaryLoading : !!filterHoldings) && (
        <Card style={{ animation: 'qv-stagger-in 0.4s ease-out both', animationDelay: '180ms' }}>
          <CardContent className="pt-6">
            <TaxonomyChart
              items={chartItems}
              totalMarketValue={chartTotal}
              mode={chartMode === 'treemap' ? 'treemap' : 'pie'}
              centerLabel={chartCenterLabel}
            />
          </CardContent>
        </Card>
      )}

      {/* Account filter banner */}
      {accountFilterId && filterAccount && (
        <div className="flex items-center gap-3 px-4 py-2.5 rounded-lg bg-primary/10 border border-primary/20">
          <span className="text-sm font-medium">
            {t('filter.showingAccount', { name: filterAccount.name })}
          </span>
          <Button variant="ghost" size="sm" className="ml-auto h-7 gap-1" onClick={clearAccountFilter}>
            <X className="h-3.5 w-3.5" />
            {t('filter.clearFilter')}
          </Button>
        </div>
      )}

      {/* Toolbar: search + show retired */}
      {!isEmptyPortfolio && (
        <TableToolbar
          searchValue={searchQuery}
          onSearchChange={setSearchQuery}
          searchPlaceholder={t('search.placeholder')}
        >
          <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
            <Checkbox checked={showRetired} onCheckedChange={(v) => setShowRetired(v === true)} />
            {t('showRetired')}
          </label>
        </TableToolbar>
      )}

      {/* Securities table or empty state */}
      {filteredSecurities.length === 0 && !tableLoading ? (
        isEmptyPortfolio ? (
          <EmptyState
            icon={Briefcase}
            title={t('empty.title')}
            description={t('empty.description')}
            action={<Button onClick={() => setWizardOpen(true)}>{tSecurities('actions.addInstrument')}</Button>}
          />
        ) : trimmedSearchQuery ? (
          <EmptyState
            icon={Search}
            title={t('search.noResults', { query: trimmedSearchQuery })}
            description={t('search.noResultsHint')}
          />
        ) : (
          <EmptyState
            icon={Briefcase}
            title={t('empty.noMatches')}
            description={t('empty.noMatchesHint')}
          />
        )
      ) : (
        <FadeIn>
          <div className={cn(isFetching && !tableLoading && 'opacity-60 transition-opacity duration-200')}>
            <DataTable
              columns={columns}
              data={filteredSecurities}
              tableId="investments"
              defaultSorting={[]}
              defaultColumnVisibility={defaultColumnVisibility}
              enableColumnVisibility
              columnVisibilityGroups={columnVisibilityGroups}
              onRowClick={(row) => setDrawerSecurityId(row.id)}
              isLoading={tableLoading}
              skeletonRows={10}
              enableVirtualization={100}
              enableExport
            />
            {/* Total row */}
            {!tableLoading && filteredSecurities.length > 0 && (statementMap.size > 0 || perfMap.size > 0) && (
              <div className="flex items-center justify-between px-4 py-2.5 mt-1 rounded-lg bg-muted/50 border border-border text-sm font-medium">
                <span className="text-muted-foreground">
                  {t('totals.label', { count: filteredSecurities.length })}
                </span>
                <div className="flex items-center gap-6">
                  {statementMap.size > 0 && (
                    <span className="flex items-center gap-1.5">
                      <span className="text-muted-foreground">{t('columns.marketValue')}:</span>
                      <CurrencyDisplay
                        value={filteredSecurities.reduce((sum, s) => {
                          const entry = statementMap.get(s.id);
                          return sum + (entry ? parseFloat(entry.marketValue) : 0);
                        }, 0)}
                        className="font-semibold tabular-nums"
                      />
                    </span>
                  )}
                  {perfMap.size > 0 && (
                    <span className="flex items-center gap-1.5">
                      <span className="text-muted-foreground">{t('columns.unrealizedGain')}:</span>
                      <CurrencyDisplay
                        value={filteredSecurities.reduce((sum, s) => {
                          const entry = perfMap.get(s.id);
                          return sum + (entry ? parseFloat(entry.unrealizedGain) : 0);
                        }, 0)}
                        colorize
                        className="font-semibold tabular-nums"
                      />
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
        </FadeIn>
      )}

      {/* CRUD dialogs */}
      <AddInstrumentDialog
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        onCreated={handleCreated}
        onCreateEmpty={() => {
          setWizardOpen(false);
          setCreateEmptyOpen(true);
        }}
      />

      {createEmptyOpen && (
        <SecurityEditor
          mode="create"
          open={createEmptyOpen}
          onOpenChange={(open) => { if (!open) setCreateEmptyOpen(false); }}
          onCreated={handleCreated}
        />
      )}

      {editId && (
        <SecurityEditor
          mode="edit"
          securityId={editId}
          open={!!editId}
          onOpenChange={(open) => { if (!open) { setEditId(null); setEditSection(undefined); } }}
          initialSection={editSection}
        />
      )}

      {/* Security drawer */}
      <SecurityDrawer
        securityId={drawerSecurityId}
        onClose={() => setDrawerSecurityId(null)}
        onEdit={handleEdit}
        perfMap={perfMap}
        statementMap={statementMap}
        logoMap={logoMap}
        periodSearch={periodSearch}
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
    </div>
  );
}
