// packages/web/src/components/domain/DeletePortfolioDialog.tsx
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useDeletePortfolio, usePortfolioRegistry } from '@/api/use-portfolios';
import { resolveErrorMessage } from '@/api/query-client';
import { useGuardedSubmit } from '@/hooks/use-guarded-submit';
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

  // Save-button re-entry guard: see frontend.md "Save-button re-entry guard".
  // Even though the dialog navigates-then-mutates (closing the modal between
  // submit and the network round-trip), two same-tick clicks both fire before
  // the navigate-driven unmount lands. The guard closes that window.
  const { run: submit, inFlight } = useGuardedSubmit(async () => {
    const remaining =
      registry.data?.portfolios.filter((p) => p.id !== props.id && p.kind === 'real') ?? [];
    const nextDefault = remaining[0]?.id ?? null;

    props.onOpenChange(false);
    navigate(nextDefault ? `/p/${nextDefault}/dashboard` : '/welcome');

    try {
      await del.mutateAsync(props.id);
      toast.success(t('delete.success'));
    } catch (err) {
      toast.error(t('delete.error', { msg: resolveErrorMessage(err) }));
    }
  });
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>{t('delete.title', { name: props.name })}</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">{t('delete.body')}</p>
        <DialogFooter>
          <Button variant="ghost" onClick={() => props.onOpenChange(false)}>{t('delete.cancel')}</Button>
          <Button variant="destructive" onClick={() => void submit()} disabled={inFlight || del.isPending}>{t('delete.confirm')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
