import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Check, ChevronRight, ChevronDown, X } from 'lucide-react';
import { useAccounts } from '@/api/use-accounts';
import { useTaxonomies } from '@/api/use-taxonomies';
import { useTaxonomyTree } from '@/api/use-taxonomy-tree';
import { useSecurities } from '@/api/use-securities';
import { useResolveSeriesLabel } from '@/api/use-performance';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from '@/components/ui/command';
import { cn } from '@/lib/utils';
import type { DataSeriesValue } from '@quovibe/shared';
import type { TaxonomyTreeCategory } from '@/api/types';

// ─── Types ──────────────────────────────────────────────────────────────────

interface DataSeriesSelectorProps {
  value: DataSeriesValue | null;
  onChange: (v: DataSeriesValue) => void;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isSelected(current: DataSeriesValue | null, candidate: DataSeriesValue): boolean {
  if (!current) return false;
  if (current.type !== candidate.type) return false;
  switch (candidate.type) {
    case 'portfolio':
      return current.type === 'portfolio' && current.preTax === candidate.preTax;
    case 'account':
      return (
        current.type === 'account' &&
        current.accountId === candidate.accountId &&
        current.withReference === candidate.withReference
      );
    case 'taxonomy':
      return (
        current.type === 'taxonomy' &&
        current.taxonomyId === candidate.taxonomyId &&
        current.categoryId === candidate.categoryId
      );
    case 'security':
      return current.type === 'security' && current.securityId === candidate.securityId;
  }
}

// ─── Taxonomy section sub-component (lazy-loads tree per taxonomy) ────────────

interface TaxonomySectionProps {
  taxonomyId: string;
  taxonomyName: string;
  searchQuery: string;
  value: DataSeriesValue | null;
  onChange: (v: DataSeriesValue) => void;
}

function flattenCategories(
  categories: TaxonomyTreeCategory[],
  depth = 0,
): Array<{ cat: TaxonomyTreeCategory; depth: number }> {
  const result: Array<{ cat: TaxonomyTreeCategory; depth: number }> = [];
  for (const cat of categories) {
    result.push({ cat, depth });
    if (cat.children.length > 0) {
      result.push(...flattenCategories(cat.children, depth + 1));
    }
  }
  return result;
}

function TaxonomySection({
  taxonomyId,
  taxonomyName,
  searchQuery,
  value,
  onChange,
}: TaxonomySectionProps) {
  const [expanded, setExpanded] = useState(false);
  const shouldLoadTree = expanded || searchQuery.length > 0;
  const { data: tree, isLoading } = useTaxonomyTree(shouldLoadTree ? taxonomyId : undefined);

  const flatItems = useMemo(() => {
    if (!tree) return [];
    return flattenCategories(tree.categories);
  }, [tree]);

  const filteredItems = useMemo(() => {
    if (!searchQuery) return flatItems;
    const q = searchQuery.toLowerCase();
    return flatItems.filter(({ cat }) => cat.name.toLowerCase().includes(q));
  }, [flatItems, searchQuery]);

  // When searching, auto-expand to show results
  const effectiveExpanded = expanded || (searchQuery.length > 0 && filteredItems.length > 0);

  const rootSeries: DataSeriesValue = { type: 'taxonomy', taxonomyId };
  const rootSelected = isSelected(value, rootSeries);

  const taxonomyNameMatchesSearch =
    !searchQuery || taxonomyName.toLowerCase().includes(searchQuery.toLowerCase());

  // If searching and neither the taxonomy name matches nor any category, hide
  if (searchQuery && !taxonomyNameMatchesSearch && filteredItems.length === 0) {
    return null;
  }

  return (
    <div className="mb-1">
      {/* Taxonomy root row — clicking the row expands/collapses, check icon selects */}
      <div
        className={cn(
          'flex items-center gap-1 px-2 py-1.5 rounded-md cursor-pointer transition-colors',
          'hover:bg-foreground/[0.04]',
          rootSelected && 'text-primary font-medium',
        )}
        onClick={() => setExpanded((prev) => !prev)}
      >
        <span className="text-muted-foreground shrink-0">
          {effectiveExpanded ? (
            <ChevronDown className="size-4" />
          ) : (
            <ChevronRight className="size-4" />
          )}
        </span>
        <span className="flex-1 text-sm">{taxonomyName}</span>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onChange(rootSeries); }}
          className={cn(
            'shrink-0 rounded p-0.5 transition-colors',
            rootSelected
              ? 'text-primary'
              : 'text-muted-foreground/40 hover:text-primary',
          )}
          aria-label={`Select ${taxonomyName}`}
        >
          <Check className="size-4" />
        </button>
      </div>

      {/* Category rows (lazy) */}
      {effectiveExpanded && (
        <div className="ml-6">
          {isLoading && (
            <div className="space-y-1 py-1">
              <Skeleton className="h-6 w-3/4" />
              <Skeleton className="h-6 w-2/3" />
            </div>
          )}
          {!isLoading && filteredItems.map(({ cat, depth }) => {
            const catSeries: DataSeriesValue = {
              type: 'taxonomy',
              taxonomyId,
              categoryId: cat.id,
            };
            const catSelected = isSelected(value, catSeries);
            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => onChange(catSeries)}
                style={{ paddingLeft: `${depth * 16}px` }}
                className={cn(
                  'w-full flex items-center justify-between px-2 py-1.5 rounded-md text-sm text-left transition-colors',
                  'hover:bg-foreground/[0.04]',
                  catSelected && 'text-primary font-medium',
                )}
              >
                <span>{cat.name}</span>
                {catSelected && <Check className="size-4 shrink-0 text-primary" />}
              </button>
            );
          })}
          {!isLoading && tree && filteredItems.length === 0 && searchQuery && (
            <p className="text-xs text-muted-foreground px-2 py-1">—</p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function DataSeriesSelector({ value, onChange }: DataSeriesSelectorProps) {
  const { t } = useTranslation('dashboard');
  const [search, setSearch] = useState('');
  const [showAllSecurities, setShowAllSecurities] = useState(false);

  const { data: accounts, isLoading: accountsLoading } = useAccounts(false);
  const { data: taxonomies, isLoading: taxonomiesLoading } = useTaxonomies();
  const { data: securities, isLoading: securitiesLoading } = useSecurities(false);
  const { data: resolvedLabel } = useResolveSeriesLabel(value);

  const q = search.toLowerCase();

  // ── Section A — Common ────────────────────────────────────────────────────
  const commonItems: Array<{ label: string; series: DataSeriesValue }> = [
    {
      label: t('dataSeries.entirePortfolio'),
      series: { type: 'portfolio', preTax: false },
    },
  ];

  const filteredCommon = useMemo(
    () =>
      !q
        ? commonItems
        : commonItems.filter((item) => item.label.toLowerCase().includes(q)),
    [q, t],
  );

  // ── Section B — Accounts & Portfolios ─────────────────────────────────────
  const portfolioAccounts = useMemo(() => {
    if (!accounts) return [];
    return accounts
      .filter((a) => a.type === 'portfolio')
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [accounts]);

  const filteredPortfolios = useMemo(() => {
    if (!q) return portfolioAccounts;
    return portfolioAccounts.filter((a) => {
      if (a.name.toLowerCase().includes(q)) return true;
      if (a.referenceAccountId) {
        const refAcc = accounts?.find((x) => x.id === a.referenceAccountId);
        if (refAcc && refAcc.name.toLowerCase().includes(q)) return true;
      }
      return false;
    });
  }, [portfolioAccounts, q, accounts]);

  // ── Section D — Securities ─────────────────────────────────────────────────
  const activeSecurities = useMemo(() => {
    if (!securities) return [];
    return securities.filter((s) => !s.isRetired);
  }, [securities]);

  const filteredSecurities = useMemo(() => {
    if (!q) return activeSecurities;
    return activeSecurities.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        (s.isin && s.isin.toLowerCase().includes(q)) ||
        (s.ticker && s.ticker.toLowerCase().includes(q)),
    );
  }, [activeSecurities, q]);

  const securitiesUseCommand = activeSecurities.length > 40;

  // Determine which sections to show when filtering
  const showCommon = filteredCommon.length > 0;
  const showAccounts = !q || filteredPortfolios.length > 0;
  const showSecurities = !q || filteredSecurities.length > 0;

  // Shared item class builders
  const itemCn = (selected: boolean) => cn(
    'w-full flex items-center justify-between px-2 py-1.5 rounded-md text-sm text-left transition-colors',
    'hover:bg-foreground/[0.04]',
    selected && 'text-primary font-medium',
  );

  const stickyHeaderCn =
    'sticky top-0 z-10 bg-popover/95 backdrop-blur-sm px-1 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground border-b border-border/50';

  return (
    <div className="flex flex-col gap-2">
      {/* Global search input */}
      <div className="relative flex items-center">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('dataSeries.searchPlaceholder')}
          className={cn(
            'w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm',
            'placeholder:text-muted-foreground outline-none',
            'focus-visible:ring-2 focus-visible:ring-ring/50',
            search && 'pr-8',
          )}
        />
        {search && (
          <button
            type="button"
            onClick={() => setSearch('')}
            className="absolute right-2 text-muted-foreground hover:text-foreground"
            aria-label="Clear search"
          >
            <X className="size-4" />
          </button>
        )}
      </div>

      {/* Resolved label confirmation */}
      {value && resolvedLabel && (
        <p className="text-xs text-muted-foreground px-1">
          {t('dataSeries.selectedLabel')}
          <span className="font-medium text-foreground">{resolvedLabel.label}</span>
        </p>
      )}

      {/* Flat list with sticky section headers */}
      <div className="overflow-y-auto max-h-[calc(60vh-5rem)] min-h-[200px]">
          {/* Section A — Common */}
          {showCommon && (
            <>
              <div className={stickyHeaderCn}>{t('dataSeries.common')}</div>
              <div className="space-y-0.5 py-1">
                {filteredCommon.map((item) => {
                  const sel = isSelected(value, item.series);
                  return (
                    <button
                      key={JSON.stringify(item.series)}
                      type="button"
                      onClick={() => onChange(item.series)}
                      className={itemCn(sel)}
                    >
                      <span>{item.label}</span>
                      {sel && <Check className="size-4 shrink-0 text-primary" />}
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {/* Section B — Accounts & Portfolios */}
          {showAccounts && (
            <>
              <div className={stickyHeaderCn}>{t('dataSeries.accounts')}</div>
              <div className="py-1">
                {accountsLoading && (
                  <div className="space-y-1 py-1">
                    <Skeleton className="h-7 w-full" />
                    <Skeleton className="h-7 w-4/5" />
                    <Skeleton className="h-7 w-3/5" />
                  </div>
                )}
                {!accountsLoading && filteredPortfolios.length === 0 && (
                  <p className="text-sm text-muted-foreground px-2 py-1.5">
                    {t('dataSeries.noSecuritiesAccounts')}
                  </p>
                )}
                {!accountsLoading && (
                  <div className="space-y-0.5">
                    {filteredPortfolios.map((acc) => {
                      const accSeries: DataSeriesValue = {
                        type: 'account',
                        accountId: acc.id,
                        withReference: false,
                      };
                      const accSelected = isSelected(value, accSeries);

                      const refAccount = acc.referenceAccountId
                        ? accounts?.find((x) => x.id === acc.referenceAccountId)
                        : null;

                      const withRefSeries: DataSeriesValue = {
                        type: 'account',
                        accountId: acc.id,
                        withReference: true,
                      };
                      const withRefSelected = isSelected(value, withRefSeries);

                      return (
                        <div key={acc.id}>
                          <button
                            type="button"
                            onClick={() => onChange(accSeries)}
                            className={itemCn(accSelected)}
                          >
                            <span>{acc.name}</span>
                            {accSelected && <Check className="size-4 shrink-0 text-primary" />}
                          </button>

                          {acc.referenceAccountId && refAccount && (
                            <button
                              type="button"
                              onClick={() => onChange(withRefSeries)}
                              className={cn(
                                'w-full flex items-center justify-between pl-6 pr-2 py-1.5 rounded-md text-sm text-left transition-colors',
                                'text-muted-foreground hover:bg-foreground/[0.04]',
                                withRefSelected && 'text-primary font-medium',
                              )}
                            >
                              <span>
                                {t('dataSeries.withReference', {
                                  name: acc.name,
                                  refName: refAccount.name,
                                })}
                              </span>
                              {withRefSelected && (
                                <Check className="size-4 shrink-0 text-primary" />
                              )}
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          )}

          {/* Section C — Taxonomies (always shown; TaxonomySection components filter themselves) */}
          <>
              <div className={stickyHeaderCn}>{t('dataSeries.taxonomies')}</div>
              <div className="py-1">
                {taxonomiesLoading && (
                  <div className="space-y-1 py-1">
                    <Skeleton className="h-7 w-full" />
                    <Skeleton className="h-7 w-4/5" />
                  </div>
                )}
                {!taxonomiesLoading && (!taxonomies || taxonomies.length === 0) && (
                  <div className="px-2 py-1.5 text-sm text-muted-foreground">
                    <p>{t('dataSeries.noTaxonomies')}</p>
                    <Link
                      to="/allocation"
                      className="text-xs underline hover:text-foreground"
                    >
                      {t('dataSeries.createTaxonomyLink')}
                    </Link>
                  </div>
                )}
                {!taxonomiesLoading && taxonomies && taxonomies.length > 0 && (
                  <div className="space-y-0.5">
                    {taxonomies.map((tx) => (
                      <TaxonomySection
                        key={tx.id}
                        taxonomyId={tx.id}
                        taxonomyName={tx.name}
                        searchQuery={search}
                        value={value}
                        onChange={onChange}
                      />
                    ))}
                  </div>
                )}
              </div>
            </>

          {/* Section D — Securities */}
          {showSecurities && (
            <>
              <div className={stickyHeaderCn}>{t('dataSeries.securities')}</div>
              <div className="py-1">
                {securitiesLoading && (
                  <div className="space-y-1 py-1">
                    <Skeleton className="h-7 w-full" />
                    <Skeleton className="h-7 w-4/5" />
                    <Skeleton className="h-7 w-3/5" />
                    <Skeleton className="h-7 w-full" />
                  </div>
                )}

                {!securitiesLoading && securitiesUseCommand && !search ? (
                  <Command className="border rounded-md">
                    <CommandInput placeholder={t('dataSeries.searchPlaceholder')} />
                    <CommandList className="max-h-48">
                      <CommandEmpty>{t('dataSeries.noSecurities')}</CommandEmpty>
                      <CommandGroup>
                      {activeSecurities.map((sec) => {
                        const secSeries: DataSeriesValue = {
                          type: 'security',
                          securityId: sec.id,
                        };
                        const secSelected = isSelected(value, secSeries);
                        const label = sec.ticker
                          ? `${sec.name} (${sec.ticker})`
                          : sec.name;
                        return (
                          <CommandItem
                            key={sec.id}
                            value={label}
                            onSelect={() => onChange(secSeries)}
                            className={cn(secSelected && 'bg-accent/50')}
                          >
                            <span className="flex-1">{label}</span>
                            {secSelected && <Check className="size-4 text-primary" />}
                          </CommandItem>
                        );
                      })}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                ) : (
                  !securitiesLoading && (
                    <div className="space-y-0.5">
                      {filteredSecurities.length === 0 && (
                        <p className="text-sm text-muted-foreground px-2 py-1.5">
                          {t('dataSeries.noSecurities')}
                        </p>
                      )}
                      {(search || showAllSecurities ? filteredSecurities : filteredSecurities.slice(0, 8)).map((sec) => {
                        const secSeries: DataSeriesValue = {
                          type: 'security',
                          securityId: sec.id,
                        };
                        const secSelected = isSelected(value, secSeries);
                        const label = sec.ticker
                          ? `${sec.name} (${sec.ticker})`
                          : sec.name;
                        return (
                          <button
                            key={sec.id}
                            type="button"
                            onClick={() => onChange(secSeries)}
                            className={itemCn(secSelected)}
                          >
                            <span>{label}</span>
                            {secSelected && <Check className="size-4 shrink-0 text-primary" />}
                          </button>
                        );
                      })}
                      {!search && !showAllSecurities && filteredSecurities.length > 8 && (
                        <button
                          type="button"
                          onClick={() => setShowAllSecurities(true)}
                          className="w-full text-xs text-primary hover:text-primary/80 px-2 py-1.5 text-left transition-colors"
                        >
                          {t('dataSeries.showMore', { count: filteredSecurities.length - 8 })}
                        </button>
                      )}
                    </div>
                  )
                )}
              </div>
            </>
          )}
      </div>
    </div>
  );
}
