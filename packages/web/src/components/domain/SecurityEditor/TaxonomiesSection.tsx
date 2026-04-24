import { useTranslation } from 'react-i18next';
import { useTaxonomies } from '@/api/use-taxonomies';
import { useTaxonomyTree } from '@/api/use-taxonomy-tree';
import type { TaxonomyAssignment } from '@/api/types';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Plus, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SectionHeader } from './SectionHeader';
import type { CompletenessStatus } from '@/lib/security-completeness';
import { flattenCategories } from '@/lib/taxonomy-flatten';

function TaxonomyGroup({
  taxonomyId, taxonomyName, assignments, onChange,
}: {
  taxonomyId: string;
  taxonomyName: string;
  assignments: TaxonomyAssignment[];
  onChange: (assignments: TaxonomyAssignment[]) => void;
}) {
  const { t } = useTranslation('securities');
  const { data: tree } = useTaxonomyTree(taxonomyId);

  const flatCats = tree ? flattenCategories(tree.categories) : [];
  const taxAssignments = assignments.filter(a => a.taxonomyId === taxonomyId);

  const weightSum = taxAssignments.reduce((sum, a) => sum + (a.weight ?? 0), 0);
  const weightSumPercent = weightSum / 100;
  const isOver = weightSum > 10000;
  const isExact = weightSum === 10000;

  function addRow() {
    onChange([...assignments, { taxonomyId, categoryId: '', weight: 10000 }]);
  }

  function removeRow(index: number) {
    let count = -1;
    const newAssignments = assignments.filter(a => {
      if (a.taxonomyId !== taxonomyId) return true;
      count++;
      return count !== index;
    });
    onChange(newAssignments);
  }

  function updateRow(index: number, patch: Partial<TaxonomyAssignment>) {
    let count = -1;
    onChange(assignments.map(a => {
      if (a.taxonomyId !== taxonomyId) return a;
      count++;
      return count === index ? { ...a, ...patch } : a;
    }));
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">{taxonomyName}</p>
        <Button type="button" variant="ghost" size="sm" onClick={addRow} className="h-7 gap-1 text-xs">
          <Plus size={14} /> {t('securityEditor.assign')}
        </Button>
      </div>

      {taxAssignments.length === 0 ? (
        <p className="text-xs text-muted-foreground pl-1">{t('securityEditor.notAssigned')}</p>
      ) : (
        <div className="space-y-1.5">
          {taxAssignments.map((a, i) => (
            <div key={i} className="flex items-center gap-2">
              <select
                className="flex-1 border rounded-md px-2 py-1.5 text-sm bg-background"
                value={a.categoryId}
                onChange={e => updateRow(i, { categoryId: e.target.value })}
              >
                <option value="">{t('taxonomies.notAssigned')}</option>
                {flatCats.map(c => (
                  <option key={c.id} value={c.id}>{'  '.repeat(c.depth) + c.name}</option>
                ))}
              </select>
              <Input
                type="number" min={0} max={100} step={0.01}
                value={a.weight != null ? a.weight / 100 : ''}
                onChange={e => {
                  const v = e.target.value;
                  updateRow(i, { weight: v === '' ? null : Math.round(parseFloat(v) * 100) });
                }}
                className="w-20 text-sm"
                placeholder={t('securityEditor.weight')}
              />
              <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => removeRow(i)}>
                <X size={14} />
              </Button>
            </div>
          ))}
        </div>
      )}

      {taxAssignments.length > 0 && (
        <p className={cn(
          'text-xs pl-1',
          isOver ? 'text-destructive font-medium' : isExact ? 'text-muted-foreground' : 'text-yellow-600 dark:text-yellow-400',
        )}>
          {t('taxonomies.weightSum')}: {weightSumPercent.toFixed(2)}%
          {isOver && ` — ${t('taxonomies.weightSumError')}`}
          {!isOver && !isExact && taxAssignments.length > 0 && weightSum > 0 && ` — ${t('taxonomies.weightSumWarning')}`}
        </p>
      )}
    </div>
  );
}

interface Props {
  assignments: TaxonomyAssignment[];
  onChange: (assignments: TaxonomyAssignment[]) => void;
  status?: CompletenessStatus;
}

export function TaxonomiesSection({ assignments, onChange, status }: Props) {
  const { t } = useTranslation('securities');
  const { data: taxonomies = [] } = useTaxonomies();

  return (
    <div>
      <SectionHeader
        title={t('securityEditor.taxonomies')}
        id="section-taxonomies"
        status={status}
      />
      <div className="space-y-4 py-3">
        {taxonomies.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t('securityEditor.noTaxonomies')}</p>
        ) : (
          taxonomies.map(tax => (
            <TaxonomyGroup
              key={tax.id}
              taxonomyId={tax.id}
              taxonomyName={tax.name}
              assignments={assignments}
              onChange={onChange}
            />
          ))
        )}
      </div>
    </div>
  );
}
