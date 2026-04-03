import { useTranslation } from 'react-i18next';
import { Search, X, Loader2 } from 'lucide-react';
import { InstrumentType } from '@quovibe/shared';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

const FILTER_TYPES = [
  null, // "All"
  InstrumentType.EQUITY,
  InstrumentType.ETF,
  InstrumentType.BOND,
  InstrumentType.CRYPTO,
  InstrumentType.COMMODITY,
  InstrumentType.FUND,
] as const;

const FILTER_I18N: Record<string, string> = {
  ALL: 'addInstrument.filterAll',
  [InstrumentType.EQUITY]: 'addInstrument.filterEquity',
  [InstrumentType.ETF]: 'addInstrument.filterEtf',
  [InstrumentType.BOND]: 'addInstrument.filterBond',
  [InstrumentType.CRYPTO]: 'addInstrument.filterCrypto',
  [InstrumentType.COMMODITY]: 'addInstrument.filterCommodity',
  [InstrumentType.FUND]: 'addInstrument.filterFund',
};

interface InstrumentSearchProps {
  query: string;
  onQueryChange: (query: string) => void;
  activeFilter: InstrumentType | null;
  onFilterChange: (filter: InstrumentType | null) => void;
  isSearching: boolean;
  hasResults: boolean;
  onKeyDown: (e: React.KeyboardEvent) => void;
}

export function InstrumentSearch({
  query,
  onQueryChange,
  activeFilter,
  onFilterChange,
  isSearching,
  hasResults,
  onKeyDown,
}: InstrumentSearchProps) {
  const { t } = useTranslation('securities');

  return (
    <div className="space-y-3">
      {/* Search input */}
      <div className="relative">
        <div className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
          {isSearching ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Search className="h-4 w-4" />
          )}
        </div>
        <Input
          autoFocus
          type="search"
          role="searchbox"
          aria-label={t('addInstrument.searchLabel')}
          placeholder={t('addInstrument.searchPlaceholder')}
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={onKeyDown}
          maxLength={200}
          className="pl-9 pr-9"
        />
        {query && (
          <button
            type="button"
            onClick={() => onQueryChange('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none rounded-sm"
            aria-label={t('addInstrument.clearSearch')}
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Filter chips — space is always reserved to prevent layout shift when results arrive */}
      <div
        role="radiogroup"
        aria-label={t('addInstrument.filterByType')}
        className={cn('flex flex-wrap gap-1.5', !hasResults && 'invisible')}
      >
          {FILTER_TYPES.map((type) => {
            const key = type ?? 'ALL';
            const isActive = activeFilter === type;
            return (
              <button
                key={key}
                type="button"
                role="radio"
                aria-checked={isActive}
                onClick={() => onFilterChange(type)}
                className={cn(
                  'px-2.5 py-1 text-xs font-medium rounded-full transition-colors',
                  'focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none',
                  isActive
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
                )}
              >
                {t(FILTER_I18N[key])}
              </button>
            );
          })}
      </div>
    </div>
  );
}
