import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

interface SectionSkeletonProps {
  rows?: number;
  title?: boolean;
}

export function SectionSkeleton({ rows = 4, title = true }: SectionSkeletonProps) {
  return (
    <Card>
      {title && (
        <CardHeader className="pb-2">
          <Skeleton className="h-4 w-32" />
        </CardHeader>
      )}
      <CardContent className={title ? '' : 'pt-6'}>
        <div className="space-y-3">
          {Array.from({ length: rows }).map((_, i) => (
            <div
              key={i}
              className="flex items-center justify-between py-1.5"
              style={{
                animation: 'qv-fade-in 0.3s ease-out both',
                animationDelay: `${i * 40}ms`,
              }}
            >
              <Skeleton className="h-3 w-36" />
              <Skeleton className="h-3 w-20" />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
