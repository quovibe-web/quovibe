import { Loader2 } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';

interface Props {
  visible: boolean;
  label: string;
}

export function ImportLoadingOverlay({ visible, label }: Props) {
  if (!visible) return null;
  return (
    <div
      role="status"
      aria-busy="true"
      aria-live="polite"
      className={cn(
        'absolute inset-0 z-10 flex flex-col items-center justify-center gap-4',
        'bg-card/85 backdrop-blur-sm',
        'transition-opacity duration-200',
      )}
    >
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden />
      <Progress className="w-48" />
      <p className="text-sm text-muted-foreground">{label}</p>
    </div>
  );
}
