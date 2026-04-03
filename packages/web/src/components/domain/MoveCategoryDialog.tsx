import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
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
import { useUpdateCategory } from '@/api/use-taxonomy-mutations';
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

function collectDescendantIds(categories: TaxonomyTreeCategory[], targetId: string): Set<string> {
  const ids = new Set<string>();
  function walk(cats: TaxonomyTreeCategory[], collecting: boolean) {
    for (const cat of cats) {
      if (cat.id === targetId || collecting) {
        ids.add(cat.id);
        if (cat.children?.length) walk(cat.children, true);
      } else if (cat.children?.length) {
        walk(cat.children, false);
      }
    }
  }
  walk(categories, false);
  return ids;
}

interface Props {
  taxonomyId: string;
  categoryId: string;
  categoryName: string;
  currentParentId: string | null;
  onClose: () => void;
}

export function MoveCategoryDialog({ taxonomyId, categoryId, categoryName, currentParentId, onClose }: Props) {
  const { t } = useTranslation('reports');
  const { data: tree } = useTaxonomyTree(taxonomyId);
  const updateCategory = useUpdateCategory(taxonomyId);

  const { rootId, options } = useMemo(() => {
    if (!tree) return { rootId: null, options: [] };
    const excluded = collectDescendantIds(tree.categories, categoryId);
    const flat = flattenCategories(tree.categories).filter((c) => !excluded.has(c.id));
    return { rootId: tree.rootId, options: flat };
  }, [tree, categoryId]);

  async function handleSelect(parentId: string) {
    await updateCategory.mutateAsync({ catId: categoryId, parentId });
    onClose();
  }

  const isCurrentParent = (id: string) =>
    id === currentParentId || (id === rootId && currentParentId === rootId);

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('taxonomyManagement.moveCategory')}</DialogTitle>
          <DialogDescription>
            {t('taxonomyManagement.moveCategoryDescription', { name: categoryName })}
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-64 overflow-y-auto space-y-0.5 py-2">
          {/* Top Level option */}
          {rootId && (
            <Button
              variant="ghost"
              className={cn('w-full justify-start h-auto py-1.5 px-2')}
              onClick={() => handleSelect(rootId)}
              disabled={isCurrentParent(rootId)}
            >
              <span className="text-sm font-medium">{t('taxonomyManagement.topLevel')}</span>
              {currentParentId === rootId && (
                <Badge variant="secondary" className="ml-2 text-xs">
                  {t('taxonomyManagement.currentParent')}
                </Badge>
              )}
            </Button>
          )}
          {options.map((cat) => (
            <Button
              key={cat.id}
              variant="ghost"
              className={cn('w-full justify-start h-auto py-1.5 px-2')}
              style={{ paddingLeft: `${cat.depth * 16 + 8}px` }}
              onClick={() => handleSelect(cat.id)}
              disabled={cat.id === currentParentId}
            >
              {cat.color && (
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0 mr-2"
                  style={{ backgroundColor: cat.color }}
                />
              )}
              <span className="text-sm">{cat.name}</span>
              {cat.id === currentParentId && (
                <Badge variant="secondary" className="ml-2 text-xs">
                  {t('taxonomyManagement.currentParent')}
                </Badge>
              )}
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
