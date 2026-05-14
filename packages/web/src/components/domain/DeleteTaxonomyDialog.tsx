import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { useDeleteTaxonomy } from '@/api/use-taxonomy-mutations';
import { useGuardedSubmit } from '@/hooks/use-guarded-submit';
import { usePortfolio } from '@/context/PortfolioContext';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  taxonomyId: string;
  taxonomyName: string;
}

export function DeleteTaxonomyDialog({ open, onOpenChange, taxonomyId, taxonomyName }: Props) {
  const { t } = useTranslation('reports');
  const navigate = useNavigate();
  const portfolio = usePortfolio();
  const deleteMutation = useDeleteTaxonomy();

  // Save-button re-entry guard: see frontend.md "Save-button re-entry guard".
  const { run: handleDelete, inFlight } = useGuardedSubmit(async () => {
    try {
      await deleteMutation.mutateAsync(taxonomyId);
      onOpenChange(false);
      navigate(`/p/${portfolio.id}/allocation`);
    } catch {
      toast.error(t('taxonomyManagement.deleteError'));
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('taxonomyManagement.deleteConfirmTitle')}</DialogTitle>
          <DialogDescription>
            {t('taxonomyManagement.deleteConfirmMessage')}
          </DialogDescription>
        </DialogHeader>

        <p className="text-sm text-muted-foreground py-2">
          {taxonomyName}
        </p>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common:cancel')}
          </Button>
          <Button variant="destructive" onClick={() => void handleDelete()} disabled={inFlight || deleteMutation.isPending}>
            {t('taxonomyManagement.deleteTaxonomy')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
