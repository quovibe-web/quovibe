import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useTaxonomyTree } from '@/api/use-taxonomy-tree';
import { useCreateAssignment, useUpdateAssignment } from '@/api/use-taxonomy-mutations';
import type { TaxonomyTreeCategory } from '@/api/types';
import { cn } from '@/lib/utils';

interface FlatCategory {
  id: string;
  name: string;
  color: string | null;
  depth: number;
}

function flattenCategories(categories: TaxonomyTreeCategory[], depth = 0): FlatCategory[] {
  const result: FlatCategory[] = [];
  for (const cat of categories) {
    result.push({ id: cat.id, name: cat.name, color: cat.color, depth });
    if (cat.children?.length) {
      result.push(...flattenCategories(cat.children, depth + 1));
    }
  }
  return result;
}

interface Props {
  taxonomyId: string;
  itemId: string;
  itemType: 'security' | 'account';
  mode: 'assign' | 'move';
  assignmentId?: number;
  excludeCategoryId?: string;
  onClose: () => void;
}

export function AssignCategoryDialog({
  taxonomyId, itemId, itemType, mode, assignmentId, excludeCategoryId, onClose,
}: Props) {
  const { t } = useTranslation('reports');
  const { data: tree } = useTaxonomyTree(taxonomyId);
  const createAssignment = useCreateAssignment(taxonomyId);
  const updateAssignment = useUpdateAssignment(taxonomyId);

  const flatCategories = useMemo(() => {
    if (!tree) return [];
    const flat = flattenCategories(tree.categories);
    return excludeCategoryId ? flat.filter((c) => c.id !== excludeCategoryId) : flat;
  }, [tree, excludeCategoryId]);

  async function handleSelect(categoryId: string) {
    if (mode === 'assign') {
      await createAssignment.mutateAsync({ itemId, itemType, categoryId });
    } else if (assignmentId != null) {
      await updateAssignment.mutateAsync({ assignmentId, categoryId });
    }
    onClose();
  }

  const title = mode === 'assign'
    ? t('taxonomyManagement.assignTo')
    : t('taxonomyManagement.moveTo');

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="sr-only">
            {t('taxonomyManagement.assignCategoryDescription')}
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-64 overflow-y-auto space-y-0.5 py-2">
          {flatCategories.map((cat) => (
            <Button
              key={cat.id}
              variant="ghost"
              className={cn('w-full justify-start h-auto py-1.5 px-2')}
              style={{ paddingLeft: `${cat.depth * 16 + 8}px` }}
              onClick={() => handleSelect(cat.id)}
            >
              {cat.color && (
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0 mr-2"
                  style={{ backgroundColor: cat.color }}
                />
              )}
              <span className="text-sm">{cat.name}</span>
            </Button>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('common:cancel')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
