import { useState, useRef, useMemo } from 'react';
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
import { Eye, EyeOff, GripVertical, X, Mountain } from 'lucide-react';
import type { IChartApi, ISeriesApi, SeriesType } from 'lightweight-charts';
import type { LineStyle } from '@quovibe/shared';
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
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { colorToHex } from '@/lib/colors';
import { usePrivacy } from '@/context/privacy-context';
import { useChartColors } from '@/hooks/use-chart-colors';
import { useCrosshairValues } from '@/hooks/use-crosshair-values';

export interface LegendSeriesItem {
  id: string;
  label: string;
  color: string;
  series: ISeriesApi<SeriesType>;
  visible: boolean;
  formatValue?: (value: number) => string;
}

interface ChartLegendOverlayProps {
  chart: IChartApi | null;
  items: LegendSeriesItem[];
  onToggleVisibility?: (id: string) => void;
  className?: string;
}

export function ChartLegendOverlay({ chart, items, onToggleVisibility, className }: ChartLegendOverlayProps) {
  const crosshairValues = useCrosshairValues(chart, items);
  const { isPrivate } = usePrivacy();

  if (items.length === 0) return null;

  return (
    <div className={cn(
      'flex flex-wrap gap-x-4 gap-y-1 text-xs py-1',
      className,
    )}>
      {items.map((item) => (
        <div key={item.id} className="flex items-center gap-1.5">
          {onToggleVisibility && (
            <button
              onClick={() => onToggleVisibility(item.id)}
              className="text-muted-foreground hover:text-foreground"
            >
              {item.visible ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
            </button>
          )}
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ backgroundColor: item.color }}
          />
          <span className={cn('text-foreground', !item.visible && 'line-through opacity-50')}>
            {item.label}
          </span>
          {crosshairValues.has(item.id) && (
            <span className={cn('font-mono font-medium text-foreground', isPrivate && 'blur-sm')}>
              {crosshairValues.get(item.id)}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

// ============================================================
// ExtendedChartLegendOverlay — interactive legend for PerformanceChart
// ============================================================

export interface ExtendedLegendSeriesItem extends LegendSeriesItem {
  lineStyle: LineStyle;
  areaFill: boolean;
  /** If true, the item cannot be removed (e.g. the portfolio series) */
  locked?: boolean;
}

interface ExtendedChartLegendOverlayProps {
  chart: IChartApi | null;
  items: ExtendedLegendSeriesItem[];
  onToggleVisibility?: (id: string) => void;
  onColorChange?: (id: string, color: string) => void;
  onLineStyleChange?: (id: string, style: LineStyle) => void;
  onAreaFillToggle?: (id: string) => void;
  onRemove?: (id: string) => void;
  onReorder?: (ids: string[]) => void;
  onIsolate?: (id: string) => void;
  className?: string;
}

// ---------- Color Picker (popover version) ----------

function LegendColorPicker({ currentColor, onSelect }: { currentColor: string; onSelect: (c: string) => void }) {
  const { t } = useTranslation('performance');
  const { palette } = useChartColors();
  // Convert palette colors (may be HSL from CSS vars) to hex for schema compatibility
  const hexPalette = useMemo(() => palette.map(colorToHex), [palette]);
  const [hex, setHex] = useState(currentColor.replace('#', ''));

  function applyHex() {
    const cleaned = hex.replace('#', '').slice(0, 6); // native-ok
    if (/^[0-9a-fA-F]{6}$/.test(cleaned)) {
      onSelect(`#${cleaned}`);
    }
  }

  return (
    <div className="p-3 w-[200px]">
      <div className="text-xs text-muted-foreground mb-2">{t('chart.presetColors')}</div>
      <div className="flex flex-wrap gap-1.5 mb-3">
        {hexPalette.map((c) => (
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

// ---------- Line style indicator (SVG) ----------

function LineStyleIndicator({ style, color }: { style: LineStyle; color: string }) {
  const dashArray = style === 'dashed' ? '4,2' : style === 'dotted' ? '1,2' : 'none';
  return (
    <svg width="14" height="8" viewBox="0 0 14 8" className="shrink-0">
      <line
        x1="0" y1="4" x2="14" y2="4"
        stroke={color}
        strokeWidth="2"
        strokeDasharray={dashArray}
        strokeLinecap="round"
      />
    </svg>
  );
}

// ---------- Cycle helper ----------

const LINE_STYLES: LineStyle[] = ['solid', 'dashed', 'dotted'];

function nextLineStyle(current: LineStyle): LineStyle {
  const idx = LINE_STYLES.indexOf(current); // native-ok
  return LINE_STYLES[(idx + 1) % LINE_STYLES.length]; // native-ok
}

// ---------- Sortable Extended Legend Item ----------

function SortableExtendedItem({
  item,
  crosshairValue,
  isPrivate,
  onToggleVisibility,
  onIsolate,
  onColorChange,
  onLineStyleChange,
  onAreaFillToggle,
  onRemove,
}: {
  item: ExtendedLegendSeriesItem;
  crosshairValue: string | undefined;
  isPrivate: boolean;
  onToggleVisibility?: () => void;
  onIsolate?: () => void;
  onColorChange?: (color: string) => void;
  onLineStyleChange?: (style: LineStyle) => void;
  onAreaFillToggle?: () => void;
  onRemove?: () => void;
}) {
  const { t } = useTranslation('performance');
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    opacity: isDragging ? 0.5 : !item.visible ? 0.4 : 1,
  };

  // Double-click → isolate, single click → toggle visibility
  function handleClick() {
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
      onIsolate?.();
    } else {
      clickTimerRef.current = setTimeout(() => {
        clickTimerRef.current = null;
        onToggleVisibility?.();
      }, 250); // native-ok
    }
  }

  // Mobile long-press triggers context menu
  function handleTouchStart(e: React.TouchEvent) {
    longPressTimer.current = setTimeout(() => {
      const touch = e.touches[0];
      if (touch) {
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
            'flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs cursor-pointer select-none',
            'bg-muted/50 hover:bg-muted transition-colors',
          )}
          onClick={handleClick}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
          onTouchMove={handleTouchEnd}
        >
          {/* Drag handle */}
          <span
            className="text-muted-foreground/30 hover:text-muted-foreground cursor-grab active:cursor-grabbing opacity-0 group-hover/ext-legend:opacity-100 transition-opacity"
            {...attributes}
            {...listeners}
          >
            <GripVertical className="h-3 w-3" />
          </span>

          {/* Color dot — click to open color picker popover */}
          {onColorChange ? (
            <Popover>
              <PopoverTrigger asChild>
                <button
                  className="shrink-0 flex items-center"
                  onClick={(e) => e.stopPropagation()}
                  title={t('chart.colorLabel')}
                >
                  <svg width="8" height="3" className="shrink-0">
                    <line x1="0" y1="1.5" x2="8" y2="1.5"
                      stroke={item.color} strokeWidth="2.5"
                      strokeDasharray={item.lineStyle === 'dashed' ? '3 2' : item.lineStyle === 'dotted' ? '1 2' : undefined}
                    />
                  </svg>
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" side="bottom" align="start">
                <LegendColorPicker currentColor={item.color} onSelect={(c) => onColorChange(c)} />
              </PopoverContent>
            </Popover>
          ) : (
            <svg width="8" height="3" className="shrink-0">
              <line x1="0" y1="1.5" x2="8" y2="1.5"
                stroke={item.color} strokeWidth="2.5"
                strokeDasharray={item.lineStyle === 'dashed' ? '3 2' : item.lineStyle === 'dotted' ? '1 2' : undefined}
              />
            </svg>
          )}

          {/* Line style indicator — click cycles solid → dashed → dotted */}
          {onLineStyleChange ? (
            <button
              className="shrink-0"
              onClick={(e) => { e.stopPropagation(); onLineStyleChange(nextLineStyle(item.lineStyle)); }}
              title={t('chart.lineStyleLabel')}
            >
              <LineStyleIndicator style={item.lineStyle} color={item.color} />
            </button>
          ) : (
            <LineStyleIndicator style={item.lineStyle} color={item.color} />
          )}

          {/* Label */}
          <span className={cn('font-medium text-foreground whitespace-nowrap', !item.visible && 'line-through opacity-50')}>
            {item.label}
          </span>

          {/* Crosshair value */}
          {crosshairValue && (
            <span className={cn('tabular-nums whitespace-nowrap text-muted-foreground', isPrivate && 'blur-sm')}>
              {crosshairValue}
            </span>
          )}

          {/* Area fill indicator */}
          {item.areaFill && (
            <Mountain className="h-3 w-3 text-muted-foreground/50" />
          )}

          {/* Remove button (only for non-locked items) */}
          {onRemove && !item.locked && (
            <button
              className="text-muted-foreground/30 hover:text-destructive opacity-0 group-hover/ext-legend:opacity-100 transition-opacity ml-0.5"
              onClick={(e) => { e.stopPropagation(); onRemove(); }}
              title={t('chart.removeSeries')}
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      </ContextMenuTrigger>

      {/* Context menu — advanced actions */}
      <ContextMenuContent>
        {/* Color submenu */}
        {onColorChange && (
          <ContextMenuSub>
            <ContextMenuSubTrigger>{t('chart.colorLabel')}</ContextMenuSubTrigger>
            <ContextMenuSubContent className="p-0">
              <LegendColorPicker currentColor={item.color} onSelect={(c) => onColorChange(c)} />
            </ContextMenuSubContent>
          </ContextMenuSub>
        )}

        {/* Line style submenu */}
        {onLineStyleChange && (
          <ContextMenuSub>
            <ContextMenuSubTrigger>{t('chart.lineStyleLabel')}</ContextMenuSubTrigger>
            <ContextMenuSubContent>
              {lineStyles.map((ls) => (
                <ContextMenuItem
                  key={ls.value}
                  onSelect={() => onLineStyleChange(ls.value)}
                  className={cn(item.lineStyle === ls.value && 'font-semibold')}
                >
                  <LineStyleIndicator style={ls.value} color={item.color} />
                  {ls.label}
                </ContextMenuItem>
              ))}
            </ContextMenuSubContent>
          </ContextMenuSub>
        )}

        {/* Area fill toggle */}
        {onAreaFillToggle && (
          <ContextMenuItem onSelect={onAreaFillToggle}>
            {t('chart.areaFillLabel')} — {item.areaFill ? 'On' : 'Off'}
          </ContextMenuItem>
        )}

        {(onColorChange || onLineStyleChange || onAreaFillToggle) && (onRemove && !item.locked) && (
          <ContextMenuSeparator />
        )}

        {/* Remove */}
        {onRemove && !item.locked && (
          <ContextMenuItem className="text-destructive" onSelect={onRemove}>
            {t('chart.removeFromChart')}
          </ContextMenuItem>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}

// ---------- ExtendedChartLegendOverlay ----------

export function ExtendedChartLegendOverlay({
  chart,
  items,
  onToggleVisibility,
  onColorChange,
  onLineStyleChange,
  onAreaFillToggle,
  onRemove,
  onReorder,
  onIsolate,
  className,
}: ExtendedChartLegendOverlayProps) {
  const crosshairValues = useCrosshairValues(chart, items);
  const { isPrivate } = usePrivacy();

  // Drag-to-reorder
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = items.findIndex((i) => i.id === active.id); // native-ok
    const newIndex = items.findIndex((i) => i.id === over.id); // native-ok
    if (oldIndex === -1 || newIndex === -1) return; // native-ok
    const reordered = arrayMove(items, oldIndex, newIndex);
    onReorder?.(reordered.map((i) => i.id));
  }

  if (items.length === 0) return null;

  return (
    <div className={cn('group/ext-legend flex flex-wrap gap-1.5 text-xs py-1', className)}>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={items.map((i) => i.id)} strategy={horizontalListSortingStrategy}>
          {items.map((item) => (
            <SortableExtendedItem
              key={item.id}
              item={item}
              crosshairValue={crosshairValues.get(item.id)}
              isPrivate={isPrivate}
              onToggleVisibility={onToggleVisibility ? () => onToggleVisibility(item.id) : undefined}
              onIsolate={onIsolate ? () => onIsolate(item.id) : undefined}
              onColorChange={onColorChange ? (c) => onColorChange(item.id, c) : undefined}
              onLineStyleChange={onLineStyleChange ? (s) => onLineStyleChange(item.id, s) : undefined}
              onAreaFillToggle={onAreaFillToggle ? () => onAreaFillToggle(item.id) : undefined}
              onRemove={onRemove ? () => onRemove(item.id) : undefined}
            />
          ))}
        </SortableContext>
      </DndContext>
    </div>
  );
}
