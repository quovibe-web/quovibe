import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useWatchlists } from '@/api/use-watchlists';
import { cn } from '@/lib/utils';

interface WatchlistWidgetConfigDialogProps {
  open: boolean;
  onClose: () => void;
  currentWatchlistId?: number | null;
  onSelect: (watchlistId: number) => void;
}

export function WatchlistWidgetConfigDialog({
  open,
  onClose,
  currentWatchlistId,
  onSelect,
}: WatchlistWidgetConfigDialogProps) {
  const { t } = useTranslation('watchlists');
  const { data: watchlists } = useWatchlists();

  function handleSelect(id: number) {
    onSelect(id);
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('widget.selectWatchlist')}</DialogTitle>
          <DialogDescription className="sr-only">
            {t('widget.selectWatchlist')}
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="h-[280px]">
          <div className="space-y-1">
            {(watchlists ?? []).map((wl) => (
              <button
                key={wl.id}
                className={cn(
                  'w-full text-left px-3 py-2 rounded-md text-sm transition-colors',
                  'hover:bg-muted/50',
                  wl.id === currentWatchlistId && 'bg-primary/10 text-primary',
                )}
                onClick={() => handleSelect(wl.id)}
              >
                <div className="font-medium">{wl.name}</div>
                <div className="text-xs text-muted-foreground">
                  {wl.securities.length} {wl.securities.length === 1 ? 'security' : 'securities'}
                </div>
              </button>
            ))}
            {(watchlists ?? []).length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">
                {t('empty.title')}
              </p>
            )}
          </div>
        </ScrollArea>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('cancel', { ns: 'common' })}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
