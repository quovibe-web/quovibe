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

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  taxonomyId: string;
  taxonomyName: string;
}

export function DeleteTaxonomyDialog({ open, onOpenChange, taxonomyId, taxonomyName }: Props) {
  const { t } = useTranslation('reports');
  const navigate = useNavigate();
  const deleteMutation = useDeleteTaxonomy();

  async function handleDelete() {
    try {
      await deleteMutation.mutateAsync(taxonomyId);
      onOpenChange(false);
      navigate('/allocation');
    } catch {
      toast.error(t('taxonomyManagement.deleteError'));
    }
  }

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
          <Button variant="destructive" onClick={handleDelete} disabled={deleteMutation.isPending}>
            {t('taxonomyManagement.deleteTaxonomy')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
