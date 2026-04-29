// packages/web/src/components/domain/RenamePortfolioDialog.tsx
import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useRenamePortfolio } from '@/api/use-portfolios';
import { isApiError, resolveErrorMessage } from '@/api/query-client';
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
  const submit = (): void => {
    const attemptedName = name.trim();
    if (!attemptedName) return;
    rename.mutate({ id: props.id, name: attemptedName }, {
      onSuccess: () => { toast.success(t('rename.success')); props.onOpenChange(false); },
      onError: (err) => {
        if (isApiError(err) && err.code === 'DUPLICATE_NAME') {
          toast.error(tErrors('portfolio.duplicateName', { name: attemptedName }));
          return;
        }
        toast.error(t('rename.error', { msg: resolveErrorMessage(err) }));
      },
    });
  };
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>{t('rename.title')}</DialogTitle></DialogHeader>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
        />
        <DialogFooter>
          <Button variant="ghost" onClick={() => props.onOpenChange(false)}>{t('rename.cancel')}</Button>
          <Button onClick={submit} disabled={!name.trim() || rename.isPending}>{t('rename.save')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
