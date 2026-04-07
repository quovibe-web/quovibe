import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

interface MetricCardSkeletonProps {
  index?: number;
}

export function MetricCardSkeleton({ index = 0 }: MetricCardSkeletonProps) {
  return (
    <Card
      className="relative overflow-hidden"
      style={{
        animation: 'qv-stagger-in 0.4s ease-out both',
        animationDelay: `${index * 50}ms`,
      }}
    >
      <div className="absolute top-0 left-0 right-0 h-[3px] bg-secondary" />
      <CardHeader className="pb-1 pt-4">
        <Skeleton className="h-3 w-20" />
      </CardHeader>
      <CardContent className="pb-4">
        <Skeleton className="h-8 w-28 mt-1" />
      </CardContent>
    </Card>
  );
}
