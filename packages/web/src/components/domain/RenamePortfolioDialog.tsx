// packages/web/src/components/domain/RenamePortfolioDialog.tsx
import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useRenamePortfolio } from '@/api/use-portfolios';
import { isApiError, resolveErrorMessage } from '@/api/query-client';
import { useGuardedSubmit } from '@/hooks/use-guarded-submit';
import { toast } from 'sonner';

export function RenamePortfolioDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  id: string;
  currentName: string;
}) {
  const { t } = useTranslation('portfolioSettings');
  const { t: tErrors } = useTranslation('errors');
  const [name, setName] = useState(props.currentName);
  useEffect(() => { setName(props.currentName); }, [props.currentName]);
  const rename = useRenamePortfolio();

  // Save-button re-entry guard: see frontend.md "Save-button re-entry guard".
  const { run: submit, inFlight } = useGuardedSubmit(async () => {
    const attemptedName = name.trim();
    if (!attemptedName) return;
    try {
      await rename.mutateAsync({ id: props.id, name: attemptedName });
      toast.success(t('rename.success'));
      props.onOpenChange(false);
    } catch (err) {
      if (isApiError(err) && err.code === 'DUPLICATE_NAME') {
        toast.error(tErrors('portfolio.duplicateName', { name: attemptedName }));
        return;
      }
      toast.error(t('rename.error', { msg: resolveErrorMessage(err) }));
    }
  });
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>{t('rename.title')}</DialogTitle></DialogHeader>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
          onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }}
        />
        <DialogFooter>
          <Button variant="ghost" onClick={() => props.onOpenChange(false)}>{t('rename.cancel')}</Button>
          <Button onClick={() => void submit()} disabled={!name.trim() || inFlight || rename.isPending}>{t('rename.save')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
