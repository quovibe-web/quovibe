import { useState } from 'react';
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
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useSecurities } from '@/api/use-securities';
import { cn } from '@/lib/utils';

interface BenchmarkWidgetConfigDialogProps {
  open: boolean;
  onClose: () => void;
  currentSecurityId?: string;
  onSelect: (securityId: string) => void;
}

export function BenchmarkWidgetConfigDialog({
  open,
  onClose,
  currentSecurityId,
  onSelect,
}: BenchmarkWidgetConfigDialogProps) {
  const { t } = useTranslation('dashboard');
  const { data: securities } = useSecurities();
  const [search, setSearch] = useState('');

  const filtered = (securities ?? []).filter((s) =>
    s.name.toLowerCase().includes(search.toLowerCase()) ||
    (s.isin && s.isin.toLowerCase().includes(search.toLowerCase())) ||
    (s.ticker && s.ticker.toLowerCase().includes(search.toLowerCase())),
  );

  function handleSelect(securityId: string) {
    onSelect(securityId);
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('widget.selectBenchmark')}</DialogTitle>
          <DialogDescription className="sr-only">
            {t('widget.selectBenchmarkDescription')}
          </DialogDescription>
        </DialogHeader>
        <Input
          placeholder={t('dataSeries.searchPlaceholder')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="mb-2"
        />
        <ScrollArea className="h-[280px]">
          <div className="space-y-1">
            {filtered.map((sec) => (
              <button
                key={sec.id}
                className={cn(
                  'w-full text-left px-3 py-2 rounded-md text-sm transition-colors',
                  'hover:bg-muted/50',
                  sec.id === currentSecurityId && 'bg-primary/10 text-primary',
                )}
                onClick={() => handleSelect(sec.id)}
              >
                <div className="font-medium">{sec.name}</div>
                {(sec.isin || sec.ticker) && (
                  <div className="text-xs text-muted-foreground">
                    {[sec.isin, sec.ticker].filter(Boolean).join(' · ')}
                  </div>
                )}
              </button>
            ))}
            {filtered.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">
                {t('catalog.noResults')}
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
