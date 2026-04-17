import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { useScopedApi } from '@/api/use-scoped-api';
import { useAddWatchlistSecurity } from '@/api/use-watchlists';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';

interface Security {
  id: string;
  name: string;
  isin: string | null;
  ticker: string | null;
  currency: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  watchlistId: number;
  existingSecurityIds: string[];
  onCreateNew: () => void;
}

export function AddSecurityToWatchlistDialog({ open, onOpenChange, watchlistId, existingSecurityIds, onCreateNew }: Props) {
  const { t } = useTranslation('watchlists');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const addMutation = useAddWatchlistSecurity();
  const api = useScopedApi();

  const { data } = useQuery({
    queryKey: ['portfolios', api.portfolioId, 'securities', 'list'],
    queryFn: () => api.fetch<{ data: Security[] }>('/api/securities'),
    enabled: open,
  });
  const allSecurities = data?.data ?? [];

  const filtered = useMemo(() => {
    if (!search.trim()) return allSecurities;
    const q = search.toLowerCase();
    return allSecurities.filter((s: Security) =>
      s.name.toLowerCase().includes(q) ||
      (s.isin && s.isin.toLowerCase().includes(q)) ||
      (s.ticker && s.ticker.toLowerCase().includes(q))
    );
  }, [allSecurities, search]);

  function toggleSelection(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleAdd() {
    for (const securityId of selected) {
      await addMutation.mutateAsync({ watchlistId, securityId });
    }
    setSelected(new Set());
    setSearch('');
    onOpenChange(false);
  }

  function handleClose(isOpen: boolean) {
    if (!isOpen) {
      setSelected(new Set());
      setSearch('');
    }
    onOpenChange(isOpen);
  }

  const existingSet = new Set(existingSecurityIds);

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('addDialog.title')}</DialogTitle>
        </DialogHeader>

        <Input
          placeholder={t('addDialog.search')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          autoFocus
        />

        <ScrollArea className="h-[300px] mt-2">
          {filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              {t('addDialog.noResults')}
            </p>
          ) : (
            <div className="space-y-1">
              {filtered.map((sec: Security) => {
                const alreadyAdded = existingSet.has(sec.id);
                return (
                  <label
                    key={sec.id}
                    className={`flex items-center gap-3 p-2 rounded-md cursor-pointer hover:bg-muted/50 ${alreadyAdded ? 'opacity-50 pointer-events-none' : ''}`}
                  >
                    <Checkbox
                      checked={alreadyAdded || selected.has(sec.id)}
                      disabled={alreadyAdded}
                      onCheckedChange={() => toggleSelection(sec.id)}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{sec.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {[sec.ticker, sec.isin].filter(Boolean).join(' · ')}
                      </div>
                    </div>
                    {alreadyAdded && (
                      <span className="text-xs text-muted-foreground">{t('addDialog.alreadyAdded')}</span>
                    )}
                  </label>
                );
              })}
            </div>
          )}
        </ScrollArea>

        <DialogFooter className="flex-row items-center">
          <Button
            variant="ghost"
            size="sm"
            className="mr-auto"
            onClick={onCreateNew}
          >
            {t('actions.createNewInstrument')}
          </Button>
          <Button variant="outline" onClick={() => handleClose(false)}>
            {t('cancel', { ns: 'common', defaultValue: 'Cancel' })}
          </Button>
          <Button onClick={handleAdd} disabled={selected.size === 0 || addMutation.isPending}>
            {t('addDialog.add')} {selected.size > 0 && `(${selected.size})`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
