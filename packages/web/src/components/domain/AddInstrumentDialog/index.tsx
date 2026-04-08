import { useState, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { InstrumentType } from '@quovibe/shared';
import type { SearchResult } from '@quovibe/shared';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
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
import { useQueryClient } from '@tanstack/react-query';
import { useSecuritySearch, usePreviewPrices, useCreateSecurity, useSecurities } from '@/api/use-securities';
import { apiFetch } from '@/api/fetch';
import { useResolveLogo } from '@/api/use-logo';
import { useDebounce } from '@/hooks/use-debounce';
import { InstrumentSearch } from './InstrumentSearch';
import { InstrumentResultsList } from './InstrumentResultsList';
import { InstrumentDetail } from './InstrumentDetail';
import { CreateEmptyInstrument } from './CreateEmptyInstrument';
import type { DialogView } from './types';

interface AddInstrumentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (securityUuid: string) => void;
  onCreateEmpty?: () => void;
}

export function AddInstrumentDialog({
  open,
  onOpenChange,
  onCreated,
  onCreateEmpty,
}: AddInstrumentDialogProps) {
  const { t } = useTranslation('securities');
  const { t: tCommon } = useTranslation('common');
  const queryClient = useQueryClient();
  const { data: existingSecurities = [] } = useSecurities();

  // Track if dialog is still open during async operations
  const openRef = useRef(open);
  openRef.current = open;

  // ─── Local state ─────────────────────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<InstrumentType | null>(null);
  const [selectedResult, setSelectedResult] = useState<SearchResult | null>(null);
  const [view, setView] = useState<DialogView>('search');
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [pendingSecurityId, setPendingSecurityId] = useState<string | null>(null);
  const [duplicateMatch, setDuplicateMatch] = useState<{ id: string; name: string } | null>(null);

  // ─── Debounced search ────────────────────────────────────────────────────────
  const debouncedQuery = useDebounce(searchQuery, 300);
  const {
    data: searchData,
    isFetching: isSearchFetching,
    error: searchError,
    refetch: retrySearch,
  } = useSecuritySearch(debouncedQuery);

  // ─── Preview prices ──────────────────────────────────────────────────────────
  const {
    data: previewData,
    isFetching: isPreviewFetching,
  } = usePreviewPrices(selectedResult?.symbol ?? null);

  // ─── Create mutation ─────────────────────────────────────────────────────────
  const createSecurity = useCreateSecurity();
  const resolveLogoMutation = useResolveLogo();

  // ─── Derived state ───────────────────────────────────────────────────────────
  const isSearching = debouncedQuery.length >= 2 && isSearchFetching;
  const filteredResults = useMemo(() => {
    if (!searchData) return [];
    if (!activeFilter) return searchData;
    return searchData.filter((r) => r.type === activeFilter);
  }, [searchData, activeFilter]);

  const hasResults = filteredResults.length > 0;
  const showNoResults = debouncedQuery.length >= 2 && !isSearching && searchData && !hasResults && !activeFilter;
  const showNoFilterResults = debouncedQuery.length >= 2 && !isSearching && searchData && searchData.length > 0 && !hasResults && !!activeFilter;
  const showHint = searchQuery.length > 0 && searchQuery.length < 2;

  // ─── Reset state on close ────────────────────────────────────────────────────
  useEffect(() => {
    if (!open) {
      setSearchQuery('');
      setActiveFilter(null);
      setSelectedResult(null);
      setView('search');
      setHighlightIndex(-1);
      setSaveError(null);
      setIsSaving(false);
      setPendingSecurityId(null);
      setDuplicateMatch(null);
    }
  }, [open]);

  // ─── Reset highlight when results change ─────────────────────────────────────
  useEffect(() => {
    setHighlightIndex(-1);
  }, [filteredResults]);

  // ─── Handlers ────────────────────────────────────────────────────────────────
  function handleSelectResult(result: SearchResult) {
    setSelectedResult(result);
    setSaveError(null);
    setView('detail');
  }

  function handleBackToResults() {
    setView('search');
    setSelectedResult(null);
    setSaveError(null);
  }

  function handleCreateEmpty() {
    if (onCreateEmpty) {
      onCreateEmpty();
    } else {
      onOpenChange(false);
    }
  }

  function findDuplicate(symbol: string): { id: string; name: string } | null {
    const sym = symbol.toLowerCase();
    const match = existingSecurities.find(
      (s) => s.ticker?.toLowerCase() === sym || s.name.toLowerCase() === sym,
    );
    return match ? { id: match.id, name: match.name } : null;
  }

  function handleAdd() {
    if (!selectedResult) return;

    // Check for duplicates before creating (skip if retrying with pendingSecurityId)
    if (!pendingSecurityId) {
      const dup = findDuplicate(selectedResult.symbol);
      if (dup) {
        setDuplicateMatch(dup);
        return;
      }
    }

    void doCreate();
  }

  async function doCreate() {
    if (!selectedResult) return;

    setIsSaving(true);
    setSaveError(null);

    try {
      // Reuse already-created security if a previous attempt partially succeeded
      let newId = pendingSecurityId;
      if (!newId) {
        const created = await createSecurity.mutateAsync({
          name: selectedResult.name,
          ticker: selectedResult.symbol,
          currency: previewData?.currency ?? 'USD',
          feed: 'YAHOO',
          latestFeed: 'YAHOO',
          feedTickerSymbol: selectedResult.symbol,
        });
        newId = created.id;
        setPendingSecurityId(newId);
      }

      // Import prices if available
      if (previewData && previewData.prices.length > 0) {
        await apiFetch<{ ok: boolean; count: number }>(`/api/securities/${newId}/prices/import`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prices: previewData.prices }),
        });
        // Invalidate caches after price import (creation mutation already invalidated securities)
        queryClient.invalidateQueries({ queryKey: ['reports'] });
        queryClient.invalidateQueries({ queryKey: ['performance'] });
        queryClient.invalidateQueries({ queryKey: ['holdings'] });
      }

      // Dialog may have been closed during async operation
      if (!openRef.current) return;

      toast.success(t('addInstrument.successNamed', { name: selectedResult.name }));
      onOpenChange(false);
      onCreated?.(newId);

      // Background logo fetch — non-blocking, captured before async close.
      // Uses dedicated /logo endpoint (not /attributes) to avoid wiping other attributes
      // if the SecurityEditor saves concurrently with empty state.
      const secId = newId;
      const instrType = selectedResult.type; // InstrumentType enum value
      const ticker = selectedResult.symbol;
      void resolveLogoMutation.mutateAsync({ ticker, instrumentType: instrType })
        .then(({ logoUrl }) =>
          apiFetch(`/api/securities/${secId}/logo`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ logoUrl }),
          }),
        )
        .then(() => {
          queryClient.invalidateQueries({ queryKey: ['securities'] });
          queryClient.invalidateQueries({ queryKey: ['securities', secId] });
        })
        .catch(() => toast.warning(tCommon('toasts.logoNotFound')));
    } catch (e) {
      if (!openRef.current) return;
      setSaveError(e instanceof Error ? e.message : t('addInstrument.error'));
    } finally {
      setIsSaving(false);
    }
  }

  // ─── Keyboard navigation ─────────────────────────────────────────────────────
  function handleSearchKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      if (searchQuery) {
        setSearchQuery('');
      } else {
        onOpenChange(false);
      }
      return;
    }

    if (view !== 'search' || !hasResults) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightIndex((prev) =>
        prev < filteredResults.length - 1 ? prev + 1 : prev, // native-ok
      );
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIndex((prev) => (prev > 0 ? prev - 1 : prev)); // native-ok
    } else if (e.key === 'Enter' && highlightIndex >= 0) {
      e.preventDefault();
      handleSelectResult(filteredResults[highlightIndex]);
    }
  }

  // ─── Render ──────────────────────────────────────────────────────────────────
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-2xl h-[min(85vh,640px)] flex flex-col max-sm:w-full max-sm:h-full max-sm:max-w-none max-sm:rounded-none"
        onKeyDown={(e) => {
          if (e.key === 'Escape' && view === 'detail') {
            e.preventDefault();
            e.stopPropagation();
            handleBackToResults();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>{t('addInstrument.title')}</DialogTitle>
          <DialogDescription className="sr-only">
            {t('addInstrument.searchPlaceholder')}
          </DialogDescription>
        </DialogHeader>

        {/* Search input + filters — always visible */}
        {view === 'search' && (
          <InstrumentSearch
            query={searchQuery}
            onQueryChange={setSearchQuery}
            activeFilter={activeFilter}
            onFilterChange={setActiveFilter}
            isSearching={isSearching}
            hasResults={!!searchData && searchData.length > 0}
            onKeyDown={handleSearchKeyDown}
          />
        )}

        {/* Content area */}
        <div className="flex-1 min-h-0 overflow-hidden">
          {view === 'search' && (
            <>
              {/* Minimum characters hint */}
              {showHint && (
                <p className="text-sm text-muted-foreground text-center py-6">
                  {t('addInstrument.searchHint')}
                </p>
              )}

              {/* Empty state (before search) */}
              {!searchQuery && (
                <div className="flex flex-col items-center justify-center py-8 text-center">
                  <p className="text-sm text-muted-foreground">
                    {t('addInstrument.emptyTitle')}
                  </p>
                  <p className="text-sm text-muted-foreground mt-2">
                    {t('addInstrument.emptyOr')}{' '}
                    <CreateEmptyInstrument onCreateEmpty={handleCreateEmpty} />
                  </p>
                </div>
              )}

              {/* Search error */}
              {searchError && (
                <div role="alert" className="flex flex-col items-center gap-2 py-6">
                  <p className="text-sm text-destructive">
                    {t('addInstrument.searchError')}
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => retrySearch()}
                  >
                    {t('addInstrument.retry')}
                  </Button>
                </div>
              )}

              {/* Results list */}
              {debouncedQuery.length >= 2 && !searchError && (
                <>
                  {(isSearching || hasResults) && (
                    <InstrumentResultsList
                      results={filteredResults}
                      highlightIndex={highlightIndex}
                      isLoading={isSearching}
                      onSelect={handleSelectResult}
                    />
                  )}

                  {/* No results (search returned nothing) */}
                  {showNoResults && (
                    <div className="flex flex-col items-center justify-center py-8 text-center">
                      <p className="text-sm text-muted-foreground">
                        {t('addInstrument.noResults', { query: debouncedQuery })}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {t('addInstrument.noResultsHint')}
                      </p>
                      <div className="mt-3">
                        <CreateEmptyInstrument
                          query={debouncedQuery}
                          onCreateEmpty={handleCreateEmpty}
                        />
                      </div>
                    </div>
                  )}

                  {/* No results matching active filter */}
                  {showNoFilterResults && (
                    <div className="flex flex-col items-center justify-center py-6 text-center">
                      <p className="text-sm text-muted-foreground">
                        {t('addInstrument.noFilterResults')}
                      </p>
                      <Button
                        variant="link"
                        size="sm"
                        className="mt-1"
                        onClick={() => setActiveFilter(null)}
                      >
                        {t('addInstrument.clearFilter')}
                      </Button>
                    </div>
                  )}
                </>
              )}
            </>
          )}

          {view === 'detail' && selectedResult && (
            <InstrumentDetail
              result={selectedResult}
              previewData={previewData ?? null}
              isPreviewLoading={isPreviewFetching}
              isSaving={isSaving}
              saveError={saveError}
              onBack={handleBackToResults}
              onAdd={handleAdd}
            />
          )}
        </div>
      </DialogContent>

      {/* Duplicate detection alert */}
      <AlertDialog open={!!duplicateMatch} onOpenChange={(open) => { if (!open) setDuplicateMatch(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('addInstrument.duplicateTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('addInstrument.duplicateMessage', {
                name: selectedResult?.name ?? '',
                symbol: selectedResult?.symbol ?? '',
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('addInstrument.duplicateCancel')}</AlertDialogCancel>
            <AlertDialogAction
              variant="outline"
              onClick={() => {
                if (duplicateMatch) {
                  onOpenChange(false);
                  onCreated?.(duplicateMatch.id);
                }
                setDuplicateMatch(null);
              }}
            >
              {t('addInstrument.duplicateViewExisting')}
            </AlertDialogAction>
            <AlertDialogAction
              onClick={() => {
                setDuplicateMatch(null);
                void doCreate();
              }}
            >
              {t('addInstrument.duplicateAddAnyway')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
