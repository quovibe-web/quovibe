import { useState, useMemo, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useTaxonomyTree } from '@/api/use-taxonomy-tree';
import type { TaxonomyTreeCategory } from '@/api/types';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

// ---------- Pure helpers (exported so tests can call them directly) ----------

export interface FlatNode {
  id: string;
  name: string;
  color: string | null;
  depth: number;
  parentIds: string[]; // ancestor chain (root → parent)
}

export function flattenCategories(
  cats: TaxonomyTreeCategory[],
  depth = 0,
  parentIds: string[] = [],
): FlatNode[] {
  const out: FlatNode[] = [];
  for (const c of cats) {
    out.push({ id: c.id, name: c.name, color: c.color ?? null, depth, parentIds });
    if (c.children?.length) {
      out.push(...flattenCategories(c.children, depth + 1, [...parentIds, c.id]));
    }
  }
  return out;
}

export function filterNodes(nodes: FlatNode[], query: string): FlatNode[] {
  if (!query) return nodes;
  const q = query.toLowerCase();
  return nodes.filter((n) => n.name.toLowerCase().includes(q));
}

export function buildBreadcrumbPath(
  nodes: FlatNode[],
  selectedId: string | null,
  nameLookup: Map<string, string>,
  separator: string,
): string | null {
  if (!selectedId) return null;
  const sel = nodes.find((n) => n.id === selectedId);
  if (!sel) return null;
  const names = [...sel.parentIds.map((id) => nameLookup.get(id) ?? '?'), sel.name];
  return names.join(separator);
}

// Returns an array of segments: { text, highlighted } for a given name + query
export interface HighlightSegment {
  text: string;
  highlighted: boolean;
}

export function highlightMatchSegments(text: string, query: string): HighlightSegment[] {
  if (!query) return [{ text, highlighted: false }];
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx < 0) return [{ text, highlighted: false }];
  const segments: HighlightSegment[] = [];
  if (idx > 0) segments.push({ text: text.slice(0, idx), highlighted: false });
  segments.push({ text: text.slice(idx, idx + query.length), highlighted: true });
  if (idx + query.length < text.length) {
    segments.push({ text: text.slice(idx + query.length), highlighted: false });
  }
  return segments;
}

// ---------- Component ----------

interface TaxonomyNodePickerPopoverProps {
  taxonomyId: string;
  taxonomyName: string;
  selectedId: string | null;
  onSelectionChange: (id: string | null) => void;
}

export function TaxonomyNodePickerPopover({
  taxonomyId,
  taxonomyName,
  selectedId,
  onSelectionChange,
}: TaxonomyNodePickerPopoverProps) {
  const { t } = useTranslation('reports');
  const { data } = useTaxonomyTree(taxonomyId);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const selectedRowRef = useRef<HTMLButtonElement>(null);

  const flat = useMemo(() => (data ? flattenCategories(data.categories) : []), [data]);
  const nameLookup = useMemo(() => {
    const m = new Map<string, string>();
    for (const n of flat) m.set(n.id, n.name);
    return m;
  }, [flat]);
  const visible = useMemo(() => filterNodes(flat, query), [flat, query]);
  const breadcrumb = useMemo(
    () =>
      buildBreadcrumbPath(
        flat,
        selectedId,
        nameLookup,
        t('taxonomyUi.picker.breadcrumbSeparator'),
      ),
    [flat, selectedId, nameLookup, t],
  );

  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => {
      selectedRowRef.current?.scrollIntoView({ block: 'center' });
      const idx = visible.findIndex((n) => n.id === selectedId);
      setActiveIdx(idx >= 0 ? idx : 0);
    });
    return () => cancelAnimationFrame(id);
  }, [open, selectedId, visible]);

  function commit(id: string) {
    onSelectionChange(id);
    setOpen(false);
    setQuery('');
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, visible.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const node = visible[activeIdx];
      if (node) commit(node.id);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      setQuery('');
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" className="justify-between min-w-[280px]">
          <span className="truncate">
            {taxonomyName}
            {breadcrumb && (
              <>
                <span className="text-muted-foreground">
                  {t('taxonomyUi.picker.breadcrumbSeparator')}
                </span>
                {breadcrumb}
              </>
            )}
          </span>
          <ChevronDown size={14} className="text-muted-foreground shrink-0" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[360px] p-0" align="start">
        <div className="p-2 border-b border-border">
          <Input
            autoFocus
            placeholder={t('taxonomyUi.picker.searchPlaceholder')}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIdx(0);
            }}
            onKeyDown={onKey}
            className="h-8"
          />
        </div>
        <div ref={listRef} className="max-h-[320px] overflow-y-auto p-1">
          {visible.length === 0 ? (
            <div className="px-3 py-4 text-sm text-muted-foreground text-center">
              {t('taxonomyUi.picker.noMatches', { query })}
            </div>
          ) : (
            visible.map((n, i) => {
              const isSelected = n.id === selectedId;
              const isActive = i === activeIdx;
              const segments = highlightMatchSegments(n.name, query);
              return (
                <button
                  key={n.id}
                  ref={isSelected ? selectedRowRef : undefined}
                  onClick={() => commit(n.id)}
                  onMouseEnter={() => setActiveIdx(i)}
                  className={cn(
                    'flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-left text-sm',
                    'hover:bg-accent/60',
                    isSelected && 'bg-accent/80 font-medium',
                    isActive && !isSelected && 'bg-accent/40',
                  )}
                  style={{ paddingLeft: `${8 + n.depth * 20}px` }}
                >
                  {n.color && (
                    <span
                      className="inline-block h-2.5 w-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: n.color }}
                    />
                  )}
                  <span className="truncate">
                    {segments.map((s, si) =>
                      s.highlighted ? (
                        <strong key={si} className="text-foreground">
                          {s.text}
                        </strong>
                      ) : (
                        <span key={si}>{s.text}</span>
                      ),
                    )}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
