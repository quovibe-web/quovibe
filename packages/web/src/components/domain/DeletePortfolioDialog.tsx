// packages/web/src/components/domain/DeletePortfolioDialog.tsx
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useDeletePortfolio, usePortfolioRegistry } from '@/api/use-portfolios';
import { resolveErrorMessage } from '@/api/query-client';
import { toast } from 'sonner';

export function DeletePortfolioDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  id: string;
  name: string;
}) {
  const { t } = useTranslation('portfolioSettings');
  const del = useDeletePortfolio();
  const registry = usePortfolioRegistry();
  const navigate = useNavigate();
  const submit = (): void => {
    del.mutate(props.id, {
      onSuccess: () => {
        props.onOpenChange(false);
        const remaining =
          registry.data?.portfolios.filter((p) => p.id !== props.id && p.kind === 'real') ?? [];
        const nextDefault = remaining[0]?.id ?? null;
        navigate(nextDefault ? `/p/${nextDefault}/dashboard` : '/welcome');
        toast.success(t('delete.success'));
      },
      onError: (err) => toast.error(t('delete.error', { msg: resolveErrorMessage(err) })),
    });
  };
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>{t('delete.title', { name: props.name })}</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">{t('delete.body')}</p>
        <DialogFooter>
          <Button variant="ghost" onClick={() => props.onOpenChange(false)}>{t('delete.cancel')}</Button>
          <Button variant="destructive" onClick={submit} disabled={del.isPending}>{t('delete.confirm')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
