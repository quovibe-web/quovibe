import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useTaxonomies } from '@/api/use-taxonomies';
import { useTaxonomyTree } from '@/api/use-taxonomy-tree';
import type { TaxonomyAssignment } from '@/api/types';
import { buildCategoryNameMap } from '@/lib/taxonomy-flatten';

interface TaxonomyGroupProps {
  taxonomyId: string;
  taxonomyName: string;
  assignments: TaxonomyAssignment[];
  fallbackLabel: string;
}

function TaxonomyGroup({ taxonomyId, taxonomyName, assignments, fallbackLabel }: TaxonomyGroupProps) {
  const { data: tree } = useTaxonomyTree(taxonomyId);
  const names = useMemo(
    () => (tree ? buildCategoryNameMap(tree.categories) : new Map<string, string>()),
    [tree],
  );
  const hasMultiple = assignments.length > 1;

  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        {taxonomyName}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {assignments.map((a, i) => {
          const label = names.get(a.categoryId) ?? fallbackLabel;
          const pct = hasMultiple && a.weight != null ? ` · ${(a.weight / 100).toFixed(2)}%` : '';
          return (
            <Badge key={`${a.categoryId}-${i}`} variant="secondary" className="font-normal">
              {label}
              {pct}
            </Badge>
          );
        })}
      </div>
    </div>
  );
}

interface Props {
  assignments: TaxonomyAssignment[];
  onClassify: () => void;
}

export function TaxonomyAssignmentsCard({ assignments, onClassify }: Props) {
  const { t } = useTranslation('securities');
  const { data: taxonomies = [] } = useTaxonomies();

  const byTaxonomy = new Map<string, TaxonomyAssignment[]>();
  for (const a of assignments) {
    if (!a.categoryId) continue;
    const list = byTaxonomy.get(a.taxonomyId) ?? [];
    list.push(a);
    byTaxonomy.set(a.taxonomyId, list);
  }

  const groupedIds = Array.from(byTaxonomy.keys());
  const isEmpty = groupedIds.length === 0;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">{t('detail.taxonomies')}</CardTitle>
      </CardHeader>
      <CardContent>
        {isEmpty ? (
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm text-muted-foreground">{t('detail.notClassified')}</p>
            <Button variant="link" size="sm" onClick={onClassify} className="px-0">
              {t('detail.classify')}
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            {groupedIds.map((tid) => {
              const tax = taxonomies.find((tx) => tx.id === tid);
              return (
                <TaxonomyGroup
                  key={tid}
                  taxonomyId={tid}
                  taxonomyName={tax?.name ?? tid}
                  assignments={byTaxonomy.get(tid) ?? []}
                  fallbackLabel={t('taxonomies.notAssigned')}
                />
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
