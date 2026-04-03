import { useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  horizontalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Eye, EyeOff } from 'lucide-react';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { LineStyle } from '@quovibe/shared';

// ---------- Types ----------

export interface StaticLegendItem {
  kind: 'static';
  key: string;
  color: string;
  label: string;
  indicator: 'dot' | 'line';
}

export interface InteractiveLegendItem {
  kind: 'interactive';
  id: string;
  color: string;
  label: string;
  lineStyle: LineStyle;
  seriesType: 'line' | 'bar';
  areaFill?: boolean;
}

export type LegendItem = StaticLegendItem | InteractiveLegendItem;

export interface InteractiveChartLegendProps {
  items: LegendItem[];
  hiddenIds: Set<string>;
  isolatedId: string | null;
  onToggleVisibility: (id: string) => void;
  onIsolate: (id: string) => void;
  onColorChange: (id: string, color: string) => void;
  onLineStyleChange: (id: string, style: LineStyle) => void;
  onAreaFillToggle: (id: string) => void;
  onRemove: (id: string) => void;
  onReorder: (orderedIds: string[]) => void;
  className?: string;
}

// ---------- Preset palette (8 chart colors) ----------

const PRESET_COLORS = [
  '#5b74a8', '#5ba89e', '#a8885b', '#a85b6e',
  '#7b5ba8', '#5ba870', '#a8705b', '#5b8ea8',
];

// ---------- Color Picker ----------

function ColorPicker({ currentColor, onSelect }: { currentColor: string; onSelect: (c: string) => void }) {
  const { t } = useTranslation('performance');
  const [hex, setHex] = useState(currentColor.replace('#', ''));

  function applyHex() {
    const cleaned = hex.replace('#', '').slice(0, 6);
    if (/^[0-9a-fA-F]{6}$/.test(cleaned)) {
      onSelect(`#${cleaned}`);
    }
  }

  return (
    <div className="p-3 w-[200px]">
      <div className="text-xs text-muted-foreground mb-2">{t('chart.presetColors')}</div>
      <div className="flex flex-wrap gap-1.5 mb-3">
        {PRESET_COLORS.map((c) => (
          <button
            key={c}
            className={cn(
              'w-6 h-6 rounded-full border-2 transition-transform hover:scale-110',
              c === currentColor ? 'border-foreground' : 'border-transparent',
            )}
            style={{ backgroundColor: c }}
            onClick={() => onSelect(c)}
          />
        ))}
      </div>
      <div className="text-xs text-muted-foreground mb-1">{t('chart.customColor')}</div>
      <div className="flex items-center gap-1.5">
        <span className="text-muted-foreground text-xs">#</span>
        <Input
          className="h-7 text-xs font-mono w-20"
          value={hex}
          maxLength={6}
          onChange={(e) => setHex(e.target.value)}
          onBlur={applyHex}
          onKeyDown={(e) => { if (e.key === 'Enter') applyHex(); }}
        />
        <span
          className="w-5 h-5 rounded border border-border shrink-0"
          style={{ backgroundColor: /^[0-9a-fA-F]{6}$/.test(hex) ? `#${hex}` : currentColor }}
        />
      </div>
    </div>
  );
}

// ---------- Sortable Legend Item ----------

function SortableItem({
  item,
  isHidden,
  isIsolated,
  onToggleVisibility,
  onIsolate,
  onColorChange,
  onLineStyleChange,
  onAreaFillToggle,
  onRemove,
}: {
  item: InteractiveLegendItem;
  isHidden: boolean;
  isIsolated: boolean;
  onToggleVisibility: () => void;
  onIsolate: () => void;
  onColorChange: (color: string) => void;
  onLineStyleChange: (style: LineStyle) => void;
  onAreaFillToggle: () => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation('performance');
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : isHidden ? 0.4 : 1,
  };

  // Double-click detection
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleClick() {
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
      onIsolate();
    } else {
      clickTimerRef.current = setTimeout(() => {
        clickTimerRef.current = null;
        onToggleVisibility();
      }, 250); // native-ok
    }
  }

  // Mobile long-press for context menu
  function handleTouchStart(e: React.TouchEvent) {
    longPressTimer.current = setTimeout(() => {
      const touch = e.touches[0];
      if (touch) {
        // Programmatic context menu trigger — the ContextMenu wrapping handles display
        const el = e.currentTarget;
        el.dispatchEvent(new MouseEvent('contextmenu', {
          bubbles: true,
          clientX: touch.clientX,
          clientY: touch.clientY,
        }));
      }
    }, 500); // native-ok
  }

  function handleTouchEnd() {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }

  const indicator = item.seriesType === 'bar' ? (
    <span className="inline-block w-3 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: item.color, opacity: 0.6 }} />
  ) : item.lineStyle === 'dashed' ? (
    <span className="inline-block w-3 h-0 border-t-2 border-dashed shrink-0" style={{ borderColor: item.color }} />
  ) : item.lineStyle === 'dotted' ? (
    <span className="inline-block w-3 h-0 border-t-2 border-dotted shrink-0" style={{ borderColor: item.color }} />
  ) : (
    <span className="inline-block w-3 h-0 border-t-2 shrink-0" style={{ borderColor: item.color }} />
  );

  const lineStyles: Array<{ value: LineStyle; label: string }> = [
    { value: 'solid', label: t('chart.styleSolid') },
    { value: 'dashed', label: t('chart.styleDashed') },
    { value: 'dotted', label: t('chart.styleDotted') },
  ];

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          ref={setNodeRef}
          style={style}
          className={cn(
            'flex items-center gap-1.5 px-2 py-1 rounded-md text-xs cursor-pointer select-none',
            'border border-transparent hover:border-border/50 hover:bg-muted/30 transition-colors',
            isIsolated && 'border-primary/50 bg-primary/5',
          )}
          onClick={handleClick}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
          onTouchMove={handleTouchEnd}
        >
          <span
            className="text-muted-foreground/50 hover:text-muted-foreground cursor-grab active:cursor-grabbing opacity-0 group-hover/legend:opacity-100 transition-opacity"
            {...attributes}
            {...listeners}
          >
            <GripVertical className="h-3 w-3" />
          </span>
          {indicator}
          <span className={cn('text-muted-foreground', isHidden && 'line-through')}>
            {item.label}
          </span>
          <span className="text-muted-foreground/40 ml-0.5">
            {isHidden ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
          </span>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        {/* Color — render ColorPicker directly inside submenu */}
        <ContextMenuSub>
          <ContextMenuSubTrigger>{t('chart.colorLabel')}</ContextMenuSubTrigger>
          <ContextMenuSubContent className="p-0">
            <ColorPicker
              currentColor={item.color}
              onSelect={(c) => onColorChange(c)}
            />
          </ContextMenuSubContent>
        </ContextMenuSub>

        {/* Line style submenu (only for line series) */}
        {item.seriesType === 'line' && (
          <ContextMenuSub>
            <ContextMenuSubTrigger>{t('chart.lineStyleLabel')}</ContextMenuSubTrigger>
            <ContextMenuSubContent>
              {lineStyles.map((ls) => (
                <ContextMenuItem
                  key={ls.value}
                  onSelect={() => onLineStyleChange(ls.value)}
                  className={cn(item.lineStyle === ls.value && 'font-semibold')}
                >
                  {ls.label}
                </ContextMenuItem>
              ))}
            </ContextMenuSubContent>
          </ContextMenuSub>
        )}

        {/* Area fill toggle (only for line series) */}
        {item.seriesType === 'line' && (
          <ContextMenuItem onSelect={onAreaFillToggle}>
            {t('chart.areaFillLabel')} — {item.areaFill ? 'On' : 'Off'}
          </ContextMenuItem>
        )}

        <ContextMenuSeparator />

        <ContextMenuItem className="text-destructive" onSelect={onRemove}>
          {t('chart.removeFromChart')}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

// ---------- Main Component ----------

export function InteractiveChartLegend({
  items,
  hiddenIds,
  isolatedId,
  onToggleVisibility,
  onIsolate,
  onColorChange,
  onLineStyleChange,
  onAreaFillToggle,
  onRemove,
  onReorder,
  className,
}: InteractiveChartLegendProps) {
  const interactiveItems = items.filter((i): i is InteractiveLegendItem => i.kind === 'interactive');
  const staticItems = items.filter((i): i is StaticLegendItem => i.kind === 'static');

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = interactiveItems.findIndex((i) => i.id === active.id);
    const newIndex = interactiveItems.findIndex((i) => i.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return; // native-ok
    const reordered = arrayMove(interactiveItems, oldIndex, newIndex);
    onReorder(reordered.map((i) => i.id));
  }

  return (
    <div className={cn('group/legend flex items-center justify-center gap-2 mt-2 flex-wrap text-xs text-muted-foreground', className)}>
      {/* Static items first (MV, TTWROR) */}
      {staticItems.map((item) => (
        <span key={item.key} className="flex items-center gap-1.5 px-2 py-1">
          {item.indicator === 'dot' ? (
            <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: item.color }} />
          ) : (
            <span className="inline-block w-3 h-0 border-t-2" style={{ borderColor: item.color }} />
          )}
          {item.label}
        </span>
      ))}

      {/* Interactive items with dnd-kit */}
      {interactiveItems.length > 0 && (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={interactiveItems.map((i) => i.id)} strategy={horizontalListSortingStrategy}>
            {interactiveItems.map((item) => (
              <SortableItem
                key={item.id}
                item={item}
                isHidden={isolatedId ? isolatedId !== item.id : hiddenIds.has(item.id)}
                isIsolated={isolatedId === item.id}
                onToggleVisibility={() => onToggleVisibility(item.id)}
                onIsolate={() => onIsolate(item.id)}
                onColorChange={(c) => onColorChange(item.id, c)}
                onLineStyleChange={(s) => onLineStyleChange(item.id, s)}
                onAreaFillToggle={() => onAreaFillToggle(item.id)}
                onRemove={() => onRemove(item.id)}
              />
            ))}
          </SortableContext>
        </DndContext>
      )}
    </div>
  );
}
