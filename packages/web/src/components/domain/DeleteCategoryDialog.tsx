import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categoryName: string;
  cascade: { assignments: number; subcategories: number };
  onConfirm: (opts: { renormalize: boolean }) => void;
  isPending: boolean;
}

/**
 * Delete-category confirm dialog (BUG-86). Names the category, quantifies
 * the cascade (assignments removed + subcategories reparented), and
 * surfaces the renormalize-weights checkbox (BUG-90) when there are any
 * assignments to renormalize.
 */
export function DeleteCategoryDialog({
  open, onOpenChange, categoryName, cascade, onConfirm, isPending,
}: Props) {
  const { t } = useTranslation(['reports', 'common']);
  const canRenormalize = cascade.assignments > 0;
  const [renormalize, setRenormalize] = useState(canRenormalize);

  // Reset checkbox whenever the dialog re-opens against a new category.
  useEffect(() => {
    if (open) setRenormalize(canRenormalize);
  }, [open, canRenormalize]);

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t('taxonomyManagement.deleteCategoryDetailed.title', { name: categoryName })}
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2 text-sm">
              {cascade.assignments === 0 && cascade.subcategories === 0 ? (
                <p>{t('taxonomyManagement.deleteCategoryDetailed.empty')}</p>
              ) : (
                <ul className="list-disc pl-5 space-y-1">
                  {cascade.assignments > 0 && (
                    <li>
                      {t('taxonomyManagement.deleteCategoryDetailed.assignments', { count: cascade.assignments })}
                    </li>
                  )}
                  {cascade.subcategories > 0 && (
                    <li>
                      {t('taxonomyManagement.deleteCategoryDetailed.subcategories', { count: cascade.subcategories })}
                    </li>
                  )}
                </ul>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>

        {canRenormalize && (
          <div className="flex items-start gap-2 py-2">
            <Checkbox
              id="renormalize-weights"
              checked={renormalize}
              onCheckedChange={(v) => setRenormalize(v === true)}
            />
            <div className="grid gap-1 leading-none">
              <Label htmlFor="renormalize-weights" className="text-sm font-medium cursor-pointer">
                {t('taxonomyManagement.renormalize.checkbox')}
              </Label>
              <p className="text-xs text-muted-foreground">
                {t('taxonomyManagement.renormalize.hint')}
              </p>
            </div>
          </div>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel>{t('common:cancel')}</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => onConfirm({ renormalize: canRenormalize && renormalize })}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            disabled={isPending}
          >
            {isPending ? t('common:deleting') : t('common:delete')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
