import { cn } from '@/lib/utils';

interface ChartLegendItem {
  color: string;
  label: string;
  type: 'dot' | 'line' | 'dashed' | 'bar';
}

interface ChartLegendProps {
  items: ChartLegendItem[];
  className?: string;
}

export function ChartLegend({ items, className }: ChartLegendProps) {
  return (
    <div className={cn('flex items-center justify-center gap-4 mt-2 text-xs text-muted-foreground', className)}>
      {items.map((item) => (
        <span key={item.label} className="flex items-center gap-1.5">
          {item.type === 'dot' && (
            <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: item.color }} />
          )}
          {item.type === 'line' && (
            <span className="inline-block w-3 h-0 border-t-2" style={{ borderColor: item.color }} />
          )}
          {item.type === 'dashed' && (
            <span className="inline-block w-3 h-0 border-t-2 border-dashed" style={{ borderColor: item.color }} />
          )}
          {item.type === 'bar' && (
            <span className="inline-block w-3 h-2.5 rounded-sm" style={{ backgroundColor: item.color, opacity: 0.6 }} />
          )}
          {item.label}
        </span>
      ))}
    </div>
  );
}
