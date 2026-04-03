import { useState, useCallback } from 'react';
import { NavLink, useLocation, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ChevronRight, Plus, ArrowUp, ArrowDown, Pencil, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTaxonomies } from '@/api/use-taxonomies';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';

interface Props {
  labelKey: string;
  icon: React.ElementType;
  basePath: string;
  onCreateClick: () => void;
  onRename?: (id: string, currentName: string) => void;
  onDelete?: (id: string, name: string) => void;
  onMoveUp?: (id: string) => void;
  onMoveDown?: (id: string) => void;
}

export function ExpandableNavItem({
  labelKey, icon: Icon, basePath, onCreateClick,
  onRename, onDelete, onMoveUp, onMoveDown,
}: Props) {
  const { t } = useTranslation('navigation');
  const { t: tr } = useTranslation('reports');
  const [expanded, setExpanded] = useState(false);
  const [contextMenuTaxonomyId, setContextMenuTaxonomyId] = useState<string | null>(null);
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { data: taxonomies } = useTaxonomies();

  const isActive = location.pathname.startsWith(basePath);
  const activeTaxonomyId = isActive ? searchParams.get('taxonomy') : null;
  const taxCount = taxonomies?.length ?? 0;

  const buildTaxonomyUrl = useCallback((taxonomyId: string) => {
    const params = new URLSearchParams(location.search);
    params.set('taxonomy', taxonomyId);
    return `${basePath}?${params.toString()}`;
  }, [basePath, location.search]);

  return (
    <div>
      <button
        onClick={() => setExpanded(!expanded)}
        className={cn(
          'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors duration-150 w-full focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none',
          isActive
            ? 'bg-[var(--qv-surface-elevated)] text-foreground font-medium'
            : 'text-muted-foreground hover:bg-[var(--qv-surface-elevated)] hover:text-foreground',
        )}
      >
        <Icon className={cn('h-4 w-4 shrink-0', isActive ? 'text-foreground' : 'text-muted-foreground')} />
        <span className="flex-1 text-left">{t(labelKey)}</span>
        <ChevronRight className={cn('h-3.5 w-3.5 transition-transform duration-200', expanded && 'rotate-90')} />
      </button>

      <div
        className="grid transition-[grid-template-rows] duration-200 ease-in-out"
        style={{ gridTemplateRows: expanded ? '1fr' : '0fr' }}
      >
        <div className="overflow-hidden">
          <ul className="mt-0.5 space-y-0.5 pl-7">
            {taxonomies?.map((tax, index) => (
              <li key={tax.id}>
                <ContextMenu onOpenChange={(open) => setContextMenuTaxonomyId(open ? tax.id : null)}>
                  <ContextMenuTrigger asChild>
                    <NavLink
                      to={buildTaxonomyUrl(tax.id)}
                      style={contextMenuTaxonomyId === tax.id
                        ? { backgroundColor: 'color-mix(in srgb, var(--color-accent) 30%, var(--qv-surface-elevated))', color: 'var(--color-foreground)', fontWeight: 500 }
                        : undefined}
                      className={() =>
                        cn(
                          'flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs transition-colors duration-150',
                          activeTaxonomyId === tax.id
                            ? 'text-foreground font-medium'
                            : 'text-muted-foreground hover:bg-[var(--qv-surface-elevated)] hover:text-foreground',
                        )
                      }
                    >
                      {tax.name}
                    </NavLink>
                  </ContextMenuTrigger>
                  <ContextMenuContent>
                    <ContextMenuItem onClick={() => onRename?.(tax.id, tax.name)}>
                      <Pencil className="h-3.5 w-3.5 mr-2" />
                      {tr('taxonomyManagement.renameTaxonomy')}
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem
                      disabled={index === 0}
                      onClick={() => onMoveUp?.(tax.id)}
                    >
                      <ArrowUp className="h-3.5 w-3.5 mr-2" />
                      {tr('taxonomyManagement.moveUp')}
                    </ContextMenuItem>
                    <ContextMenuItem
                      disabled={index === taxCount - 1}
                      onClick={() => onMoveDown?.(tax.id)}
                    >
                      <ArrowDown className="h-3.5 w-3.5 mr-2" />
                      {tr('taxonomyManagement.moveDown')}
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem
                      className="text-destructive focus:text-destructive"
                      onClick={() => onDelete?.(tax.id, tax.name)}
                    >
                      <Trash2 className="h-3.5 w-3.5 mr-2" />
                      {tr('taxonomyManagement.deleteTaxonomy')}
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
              </li>
            ))}
            <li>
              <button
                onClick={onCreateClick}
                className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs text-primary hover:bg-[var(--qv-surface-elevated)] transition-colors duration-150 w-full"
              >
                <Plus className="h-3 w-3" />
                {tr('taxonomyManagement.newTaxonomy')}
              </button>
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
