import { useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { SearchResult } from '@quovibe/shared';
import { Skeleton } from '@/components/ui/skeleton';
import { InstrumentResultCard } from './InstrumentResultCard';

interface InstrumentResultsListProps {
  results: SearchResult[];
  highlightIndex: number;
  isLoading: boolean;
  onSelect: (result: SearchResult) => void;
}

export function InstrumentResultsList({
  results,
  highlightIndex,
  isLoading,
  onSelect,
}: InstrumentResultsListProps) {
  const { t } = useTranslation('securities');
  const itemRefs = useRef<Map<number, HTMLButtonElement>>(new Map());

  // Auto-scroll highlighted item into view
  useEffect(() => {
    const el = itemRefs.current.get(highlightIndex);
    if (el) {
      el.scrollIntoView({ block: 'nearest' });
    }
  }, [highlightIndex]);

  if (isLoading) {
    return (
      <div className="space-y-2 py-1" aria-busy="true">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="flex items-center gap-3 px-3 py-2.5">
            <Skeleton className="h-5 w-12 rounded-full" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </div>
            <Skeleton className="h-5 w-14 rounded-full" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="qv-fade-in">
      <div className="px-3 py-1.5">
        <span className="text-xs text-muted-foreground" aria-live="polite">
          {t('addInstrument.resultsCount', { count: results.length })}
        </span>
      </div>
      <div role="listbox" aria-label={t('addInstrument.resultsCount', { count: results.length })} className="overflow-y-auto max-h-[360px]">
        {results.map((result, index) => (
          <InstrumentResultCard
            key={`${result.symbol}-${result.exchange}`}
            ref={(el) => {
              if (el) itemRefs.current.set(index, el);
              else itemRefs.current.delete(index);
            }}
            result={result}
            isHighlighted={index === highlightIndex}
            onClick={() => onSelect(result)}
          />
        ))}
      </div>
    </div>
  );
}
