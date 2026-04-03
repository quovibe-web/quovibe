import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useTaxonomyTree } from '@/api/use-taxonomy-tree';
import type { TaxonomyTreeCategory } from '@/api/types';
import { cn } from '@/lib/utils';

type FlatItem = Omit<TaxonomyTreeCategory, 'children'>;

function buildFlatItems(categories: TaxonomyTreeCategory[]): FlatItem[] {
  return categories.map(({ children: _children, ...rest }) => rest);
}

interface TaxonomyNodePickerProps {
  taxonomyId: string;
  selectedId: string | null;
  onSelectionChange: (id: string | null) => void;
}

export function TaxonomyNodePicker({
  taxonomyId,
  selectedId,
  onSelectionChange,
}: TaxonomyNodePickerProps) {
  const { t } = useTranslation('reports');
  const { data, isLoading, isError, error } = useTaxonomyTree(taxonomyId);

  const flatData: FlatItem[] = useMemo(
    () => (data ? buildFlatItems(data.categories) : []),
    [data],
  );

  if (isLoading) return <p className="text-muted-foreground text-sm">{t('taxonomyNodePicker.loading')}</p>;
  if (isError) {
    return (
      <p className="text-sm text-destructive">
        {t('taxonomyNodePicker.error')} {error instanceof Error ? error.message : t('taxonomyNodePicker.failedToLoad')}
      </p>
    );
  }
  if (flatData.length === 0) return <p className="text-muted-foreground text-sm">{t('taxonomyNodePicker.noCategories')}</p>;

  return (
    <div className="flex flex-wrap gap-2">
      {flatData.map((item) => {
        const isSelected = selectedId === item.id;
        return (
          <button
            key={item.id}
            onClick={() => onSelectionChange(isSelected ? null : item.id)}
            className={cn(
              'inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-sm font-medium transition-all duration-150',
              'border cursor-pointer',
              isSelected
                ? 'border-transparent shadow-sm scale-[1.02]'
                : 'border-border bg-transparent text-muted-foreground hover:text-foreground hover:border-foreground/30'
            )}
            style={
              isSelected
                ? {
                    backgroundColor: item.color
                      ? `color-mix(in srgb, ${item.color} 18%, var(--color-card))`
                      : undefined,
                    color: item.color ?? undefined,
                    borderColor: item.color
                      ? `color-mix(in srgb, ${item.color} 40%, transparent)`
                      : undefined,
                  }
                : undefined
            }
          >
            {item.color && (
              <span
                className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{ backgroundColor: item.color }}
              />
            )}
            {item.name}
          </button>
        );
      })}
    </div>
  );
}
