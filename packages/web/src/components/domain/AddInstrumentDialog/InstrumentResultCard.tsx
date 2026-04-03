import { forwardRef } from 'react';
import type { SearchResult } from '@quovibe/shared';
import { Badge } from '@/components/ui/badge';
import { InstrumentTypeBadge } from './InstrumentTypeBadge';
import { cn } from '@/lib/utils';

interface InstrumentResultCardProps {
  result: SearchResult;
  isHighlighted: boolean;
  onClick: () => void;
}

export const InstrumentResultCard = forwardRef<HTMLButtonElement, InstrumentResultCardProps>(
  function InstrumentResultCard({ result, isHighlighted, onClick }, ref) {
    return (
      <button
        ref={ref}
        role="option"
        aria-selected={isHighlighted}
        onClick={onClick}
        className={cn(
          'w-full flex items-center gap-3 px-3 py-2.5 text-left transition-surface rounded-md',
          'hover:bg-accent focus-visible:bg-accent focus-visible:outline-none',
          isHighlighted && 'bg-accent border-l-2 border-l-primary',
          !isHighlighted && 'border-l-2 border-l-transparent',
        )}
      >
        <InstrumentTypeBadge type={result.type} />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold truncate">
              {result.name}
            </span>
          </div>
          <div className="text-xs text-muted-foreground truncate">
            {result.symbol}
            {result.sector && <> &middot; {result.sector}</>}
          </div>
        </div>

        <Badge variant="outline" className="text-[10px] shrink-0">
          {result.exchDisp ?? result.exchange}
        </Badge>
      </button>
    );
  },
);
