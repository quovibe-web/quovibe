import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { formatPercentage } from '@/lib/formatters';
import { cn } from '@/lib/utils';

export interface SplitSegment {
  categoryName: string;
  color: string | null;
  weight: number; // basis points 0..10000
}

interface SplitBarProps {
  segments: SplitSegment[];
  className?: string;
  /** Width in px. Default 84. */
  width?: number;
}

export const FALLBACK_COLOR = 'var(--muted-foreground)';
export const REMAINDER_COLOR = 'var(--muted)';

export function computeSegmentWidths(segments: SplitSegment[]): string[] {
  return segments.map((s) => `${(s.weight / 100).toFixed(2)}%`);
}

export function computeRemainderWidth(segments: SplitSegment[]): string | null {
  const total = segments.reduce((acc, s) => acc + s.weight, 0);
  const remainder = Math.max(0, 10000 - total);
  if (remainder <= 0) return null;
  return `${(remainder / 100).toFixed(2)}%`;
}

export function resolveColor(color: string | null): string {
  return color ?? FALLBACK_COLOR;
}

export function SplitBar({ segments, className, width = 84 }: SplitBarProps) {
  if (!segments.length) return null;

  const segmentWidths = computeSegmentWidths(segments);
  const remainderWidth = computeRemainderWidth(segments);
  const total = segments.reduce((acc, s) => acc + s.weight, 0);
  const remainderBp = Math.max(0, 10000 - total);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          data-testid="split-bar"
          className={cn(
            'inline-flex items-center align-middle cursor-default py-2 -my-2',
            className,
          )}
          style={{ width: `${width}px` }}
        >
          <span
            className="inline-flex h-[6px] rounded-full overflow-hidden border border-white/10 pointer-events-none"
            style={{ width: `${width}px` }}
          >
            {segments.map((s, i) => (
              <span
                key={i}
                data-split-segment="assignment"
                style={{ width: segmentWidths[i], backgroundColor: resolveColor(s.color) }}
                className="h-full"
              />
            ))}
            {remainderWidth !== null && (
              <span
                data-split-segment="remainder"
                style={{ width: remainderWidth, backgroundColor: REMAINDER_COLOR }}
                className="h-full opacity-50"
              />
            )}
          </span>
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs">
        <div className="flex flex-col gap-1">
          {segments.map((s, i) => (
            <div key={i} className="flex items-center gap-2 text-xs">
              <span
                className="inline-block h-2 w-2 rounded-full shrink-0"
                style={{ backgroundColor: resolveColor(s.color) }}
              />
              <span className="flex-1 truncate">{s.categoryName}</span>
              <span className="tabular-nums font-medium">{formatPercentage(s.weight / 10000, 1)}</span>
            </div>
          ))}
          {remainderBp > 0 && (
            <div className="flex items-center gap-2 text-xs opacity-70 border-t border-background/20 pt-1 mt-1">
              <span className="inline-block h-2 w-2 rounded-full shrink-0 bg-muted-foreground" />
              <span className="flex-1 italic">unclassified</span>
              <span className="tabular-nums">{formatPercentage(remainderBp / 10000, 1)}</span>
            </div>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
