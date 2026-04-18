import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, LayoutDashboard } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { WIDGET_REGISTRY, CATEGORY_COLORS, getWidgetDef } from '@/lib/widget-registry';
import type { WidgetCategory } from '@quovibe/shared';

interface WidgetCatalogDialogProps {
  open: boolean;
  onClose: () => void;
  onAdd: (type: string) => void;
}

const CATEGORIES: Array<WidgetCategory | 'all'> = [
  'all',
  'performance',
  'reports',
  'chart',
  'risk',
  'info',
];

export function WidgetCatalogDialog({ open, onClose, onAdd }: WidgetCatalogDialogProps) {
  const { t } = useTranslation('dashboard');
  const [selectedCategory, setSelectedCategory] = useState<WidgetCategory | 'all'>('all');
  const [selectedWidgetType, setSelectedWidgetType] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const term = search.trim().toLowerCase();

  const filtered = useMemo(() => {
    return WIDGET_REGISTRY.filter((def) => {
      if (term) {
        return t(def.i18nKey).toLowerCase().includes(term);
      }
      if (selectedCategory !== 'all') {
        return def.category === selectedCategory;
      }
      return true;
    });
  }, [term, selectedCategory, t]);

  // Reset state when dialog closes
  useEffect(() => {
    if (!open) {
      setSearch('');
      setSelectedCategory('all');
      setSelectedWidgetType(null);
    }
  }, [open]);

  // Derive effective selection: if current selection is not in filtered list, fall back to first
  const effectiveType = selectedWidgetType && filtered.some((d) => d.type === selectedWidgetType)
    ? selectedWidgetType
    : filtered[0]?.type ?? null;

  const selectedDef = effectiveType ? getWidgetDef(effectiveType) : undefined;

  function handleCategoryClick(cat: WidgetCategory | 'all') {
    setSelectedCategory(cat);
    setSearch('');
  }

  function handleSearchChange(value: string) {
    setSearch(value);
    if (value.trim()) {
      setSelectedCategory('all');
    }
  }

  function handleAdd() {
    if (effectiveType) {
      onAdd(effectiveType);
    }
  }

  function categoryLabel(cat: WidgetCategory | 'all'): string {
    return t(`catalog.${cat}`);
  }

  const PreviewIcon = selectedDef?.icon ?? LayoutDashboard;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-4xl p-0 gap-0">
        <DialogHeader className="px-6 pt-6 pb-4">
          <DialogTitle>{t('widgetCatalog')}</DialogTitle>
          <DialogDescription className="sr-only">
            {t('catalog.description')}
          </DialogDescription>
        </DialogHeader>

        {/* Search */}
        <div className="px-6 pb-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => handleSearchChange(e.target.value)}
              placeholder={t('catalog.searchPlaceholder')}
              className="pl-9"
            />
          </div>
        </div>

        {/* Body: 3-column layout */}
        <div className="flex border-t border-border h-[28rem]">
          {/* Left column — Category sidebar */}
          <div className="hidden sm:flex flex-col gap-1 p-4 border-r border-border w-36 shrink-0">
            {CATEGORIES.map((cat) => (
              <button
                key={cat}
                onClick={() => handleCategoryClick(cat)}
                className={cn(
                  'flex items-center gap-2 text-left text-sm px-2 py-1.5 rounded-md transition-colors cursor-pointer',
                  selectedCategory === cat
                    ? 'bg-muted font-medium text-foreground'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/50',
                )}
              >
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{
                    backgroundColor: cat === 'all'
                      ? 'var(--color-muted-foreground)'
                      : CATEGORY_COLORS[cat],
                  }}
                />
                {categoryLabel(cat)}
              </button>
            ))}
          </div>

          {/* Center column — Icon grid */}
          <div className="flex-1 overflow-y-auto p-4">
            {filtered.length === 0 ? (
              <div className="flex items-center justify-center h-full">
                <p className="text-sm text-muted-foreground">
                  {t('catalog.noResults')}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(80px,1fr))] gap-2">
                {filtered.map((def) => {
                  const Icon = def.icon ?? LayoutDashboard;
                  const isSelected = effectiveType === def.type;
                  const label = t(def.i18nKey);
                  return (
                    <button
                      key={def.type}
                      onClick={() => setSelectedWidgetType(def.type)}
                      title={label}
                      aria-label={label}
                      className={cn(
                        'flex flex-col items-center justify-center gap-1.5 p-3 rounded-lg border cursor-pointer transition-colors',
                        isSelected
                          ? 'border-primary bg-primary/10'
                          : 'border-transparent hover:border-border hover:bg-muted/50',
                      )}
                    >
                      <Icon className="h-7 w-7 text-muted-foreground shrink-0" />
                      <span className="text-xs text-center truncate w-full">
                        {label}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Right column — Preview panel */}
          <div className="hidden sm:flex flex-col h-full w-56 shrink-0 border-l border-border p-4">
            {selectedDef ? (
              <>
                {/* Top: category + title */}
                <div>
                  <div className="flex items-center gap-1.5">
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: CATEGORY_COLORS[selectedDef.category] }}
                    />
                    <span className="text-xs text-muted-foreground">
                      {categoryLabel(selectedDef.category)}
                    </span>
                  </div>
                  <p className="text-lg font-semibold mt-1">{t(selectedDef.i18nKey)}</p>
                </div>

                {/* Middle: preview icon + description */}
                <div className="flex-1 min-h-0">
                  <div className="flex items-center justify-center rounded-lg bg-muted h-24 my-3">
                    <PreviewIcon className="h-12 w-12 text-muted-foreground" />
                  </div>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {t(selectedDef.descriptionKey)}
                  </p>
                </div>

                {/* Bottom: add button */}
                <Button className="w-full mt-3" onClick={handleAdd}>
                  {t('catalog.addToDashboard')}
                </Button>
              </>
            ) : (
              <div className="flex items-center justify-center h-full">
                <p className="text-sm text-muted-foreground">
                  {t('catalog.noResults')}
                </p>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
