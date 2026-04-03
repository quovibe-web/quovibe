import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

interface ChartSkeletonProps {
  height?: number;
}

export function ChartSkeleton({ height = 320 }: ChartSkeletonProps) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="relative" style={{ height }}>
          <Skeleton className="w-full h-full rounded-lg" />
          {/* Simulated axis lines */}
          {[0.25, 0.5, 0.75].map((pos) => (
            <div
              key={pos}
              className="absolute left-0 right-0 border-t border-[var(--qv-border)]"
              style={{ top: `${pos * 100}%` }}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
