import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type {
  DetailFilters,
  DetailSort,
  DetailFilterType,
} from './IncomeDetailList.utils';

interface IncomeFilterBarProps {
  filters: DetailFilters;
  sort: DetailSort;
  totalCount: number;
  filteredCount: number;
  availableSecurities: Array<{ id: string; name: string }>;
  onFiltersChange: (filters: DetailFilters) => void;
  onSortChange: (sort: DetailSort) => void;
}

export function IncomeFilterBar({
  filters,
  sort,
  totalCount,
  filteredCount,
  availableSecurities,
  onFiltersChange,
  onSortChange,
}: IncomeFilterBarProps) {
  const { t } = useTranslation('reports');
  const [secSearch, setSecSearch] = useState('');

  const filteredSecurities = useMemo(() => {
    const q = secSearch.trim().toLowerCase();
    if (!q) return availableSecurities;
    return availableSecurities.filter((s) => s.name.toLowerCase().includes(q));
  }, [availableSecurities, secSearch]);

  const hasFilters = filters.type !== null || filters.securityIds.length > 0;
  const isFiltered = hasFilters && filteredCount !== totalCount;

  function setType(type: DetailFilterType) {
    onFiltersChange({ ...filters, type });
  }

  function toggleSecurity(id: string) {
    const set = new Set(filters.securityIds);
    if (set.has(id)) set.delete(id);
    else set.add(id);
    onFiltersChange({ ...filters, securityIds: Array.from(set) });
  }

  function removeSecurity(id: string) {
    onFiltersChange({
      ...filters,
      securityIds: filters.securityIds.filter((x) => x !== id),
    });
  }

  function chipClass(active: boolean): string {
    return active
      ? 'cursor-pointer rounded-sm bg-[var(--color-primary-fg)]/15 border-[var(--color-primary)] text-[var(--color-primary)]'
      : 'cursor-pointer rounded-sm';
  }

  return (
    <div className="flex flex-wrap items-end justify-between gap-4 mb-4">
      <div>
        <div className="qv-eyebrow text-[var(--qv-text-faint)]">
          {t('payments.detail.headerCount', { count: filteredCount })}
        </div>
        {isFiltered && (
          <div className="text-xs text-[var(--qv-text-secondary)] mt-0.5">
            {t('payments.detail.filtered', { filtered: filteredCount, total: totalCount })}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2 mt-2">
          <Badge
            variant="outline"
            className={chipClass(filters.type === null)}
            onClick={() => setType(null)}
          >
            {t('payments.detail.filter.allTypes')}
          </Badge>
          <Badge
            variant="outline"
            className={chipClass(filters.type === 'DIVIDEND')}
            onClick={() => setType('DIVIDEND')}
          >
            {t('payments.detail.filter.dividend')}
          </Badge>
          <Badge
            variant="outline"
            className={chipClass(filters.type === 'INTEREST')}
            onClick={() => setType('INTEREST')}
          >
            {t('payments.detail.filter.interest')}
          </Badge>
          <Popover>
            <PopoverTrigger asChild>
              <Badge variant="outline" className="cursor-pointer rounded-sm gap-1">
                <Plus className="h-3 w-3" />
                {t('payments.detail.filter.addSecurity')}
              </Badge>
            </PopoverTrigger>
            <PopoverContent className="w-72 p-2" align="start">
              <Input
                placeholder={t('payments.detail.filter.searchSecurities')}
                value={secSearch}
                onChange={(e) => setSecSearch(e.target.value)}
                className="mb-2 h-8 text-sm"
              />
              <div className="max-h-64 overflow-auto">
                {filteredSecurities.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => toggleSecurity(s.id)}
                    className="w-full text-left px-2 py-1 text-sm rounded-sm hover:bg-[var(--qv-surface-3)] flex items-center justify-between"
                  >
                    <span className="truncate">{s.name}</span>
                    {filters.securityIds.includes(s.id) && (
                      <span className="text-[var(--color-primary)] text-xs">✓</span>
                    )}
                  </button>
                ))}
              </div>
            </PopoverContent>
          </Popover>
          {filters.securityIds.map((id) => {
            const sec = availableSecurities.find((s) => s.id === id);
            if (!sec) return null;
            return (
              <Badge
                key={id}
                variant="outline"
                className="cursor-pointer rounded-sm gap-1 bg-[var(--color-primary-fg)]/15 border-[var(--color-primary)] text-[var(--color-primary)]"
                onClick={() => removeSecurity(id)}
              >
                {sec.name}
                <X className="h-3 w-3" />
              </Badge>
            );
          })}
        </div>
      </div>
      <Select value={sort} onValueChange={(v) => onSortChange(v as DetailSort)}>
        <SelectTrigger className="w-48">
          <SelectValue placeholder={t('payments.detail.sort.label')} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="date-desc">{t('payments.detail.sort.dateDesc')}</SelectItem>
          <SelectItem value="date-asc">{t('payments.detail.sort.dateAsc')}</SelectItem>
          <SelectItem value="amount-desc">{t('payments.detail.sort.amountDesc')}</SelectItem>
          <SelectItem value="security-asc">{t('payments.detail.sort.securityAsc')}</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
