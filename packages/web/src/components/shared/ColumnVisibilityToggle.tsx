import { useState } from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from '../ui/dropdown-menu';
import { Button } from '../ui/button';
import { Columns3 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';
import {
  COLUMN_GROUPS,
  type ColumnGroup,
} from '../../hooks/useColumnVisibility';

interface ColumnVisibilityToggleProps {
  visibleColumns: string[];
  visibleCount: number;
  onToggle: (columnId: string) => void;
  onToggleGroup: (group: ColumnGroup) => void;
  onReset: () => void;
  onResetLayout?: () => void;
}

export function ColumnVisibilityToggle({
  visibleColumns,
  visibleCount,
  onToggle,
  onToggleGroup,
  onReset,
  onResetLayout,
}: ColumnVisibilityToggleProps) {
  const { t } = useTranslation('investments');
  const [open, setOpen] = useState(false);

  const groups: { key: ColumnGroup; columns: readonly string[] }[] = [
    { key: 'position', columns: COLUMN_GROUPS.position },
    { key: 'performance', columns: COLUMN_GROUPS.performance },
    { key: 'identity', columns: COLUMN_GROUPS.identity },
  ];

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Columns3 className="h-4 w-4" />
          {t('columnToggle.button')}
          <span className="rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground">
            {visibleCount}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56 max-h-80 overflow-y-auto">
        <DropdownMenuLabel>{t('columnToggle.header')}</DropdownMenuLabel>

        {/* Name — locked, always visible */}
        <div className="flex items-center gap-2 px-2 py-1.5 opacity-50">
          <div className="h-4 w-4 rounded border bg-muted flex items-center justify-center">
            <span className="text-[10px]">✓</span>
          </div>
          <span className="text-sm">{t('columns.name')}</span>
          <span className="ml-auto text-[10px] text-muted-foreground">{t('columnToggle.alwaysOn')}</span>
        </div>

        {groups.map((group, gi) => {
          const allVisible = group.columns.every(id => visibleColumns.includes(id));
          const someVisible = group.columns.some(id => visibleColumns.includes(id));

          return (
            <div key={group.key}>
              {gi > 0 && <DropdownMenuSeparator />}
              {/* Group header with toggle */}
              <button
                className="flex w-full items-center gap-2 px-2 py-1.5 text-xs font-semibold uppercase text-muted-foreground hover:bg-accent rounded-sm focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                onClick={() => onToggleGroup(group.key)}
              >
                <div
                  className={cn(
                    'h-4 w-4 rounded border flex items-center justify-center',
                    allVisible && 'bg-primary border-primary',
                    !allVisible && someVisible && 'bg-primary/40 border-primary',
                  )}
                >
                  {(allVisible || someVisible) && (
                    <span className={cn('text-[10px]', allVisible ? 'text-primary-foreground' : 'text-primary-foreground/70')}>
                      {allVisible ? '✓' : '—'}
                    </span>
                  )}
                </div>
                {t(`columnGroups.${group.key}`)}
              </button>

              {/* Individual columns in group */}
              {group.columns.map(id => (
                <button
                  key={id}
                  className="flex w-full items-center gap-2 px-2 py-1.5 pl-4 text-sm hover:bg-accent rounded-sm focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                  onClick={() => onToggle(id)}
                >
                  <div
                    className={cn(
                      'h-4 w-4 rounded border flex items-center justify-center',
                      visibleColumns.includes(id) && 'bg-primary border-primary',
                    )}
                  >
                    {visibleColumns.includes(id) && (
                      <span className="text-[10px] text-primary-foreground">✓</span>
                    )}
                  </div>
                  {t(`columns.${id}`)}
                </button>
              ))}
            </div>
          );
        })}

        <DropdownMenuSeparator />
        <button
          className="w-full px-2 py-1.5 text-xs text-primary hover:bg-accent rounded-sm text-right focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
          onClick={() => { onReset(); onResetLayout?.(); setOpen(false); }}
        >
          {onResetLayout ? t('resetView', { ns: 'common' }) : t('columnToggle.reset')}
        </button>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
