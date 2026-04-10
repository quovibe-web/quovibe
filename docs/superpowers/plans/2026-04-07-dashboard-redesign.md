# Dashboard Redesign: Four-Zone Layout — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the dashboard from a flat widget grid into a four-zone layout: hero (balance + sparkline), metrics strip (4 KPIs), charts zone (full-width), and detail zone (compact grid).

**Architecture:** Two new standalone components (DashboardHero, DashboardMetricsStrip) render above the widget grid. The widget grid is split into two zones at render time based on a `zone` field in the widget registry. WidgetShell gains a `compact` prop for detail-zone density. No API/DB changes.

**Tech Stack:** React 19, NumberFlow, SVG sparkline, existing TanStack Query hooks, Zod schema extension

**Spec:** `docs/superpowers/specs/2026-04-07-dashboard-redesign-design.md`

---

## File Structure

| Category | File | Action |
|----------|------|--------|
| Widget registry | `packages/web/src/lib/widget-registry.ts` | Modify — add `zone` field to each widget def |
| Shared schema | `packages/shared/src/schemas/settings.schema.ts` | Modify — add optional `metricsStripIds` to dashboard schema |
| Hero component | `packages/web/src/components/domain/DashboardHero.tsx` | Create |
| Metrics strip | `packages/web/src/components/domain/DashboardMetricsStrip.tsx` | Create |
| Settings popover | `packages/web/src/components/domain/MetricsStripSettings.tsx` | Create |
| Widget shell | `packages/web/src/components/domain/WidgetShell.tsx` | Modify — add `compact` prop |
| CSS | `packages/web/src/globals.css` | Modify — add compact widget override |
| Dashboard page | `packages/web/src/pages/Dashboard.tsx` | Modify — zone sorting, render hero + strip + zones |
| i18n | `packages/web/src/i18n/locales/*/dashboard.json` (8 files) | Modify — add hero/strip keys |

---

### Task 1: Add zone field to widget registry

**Files:**
- Modify: `packages/web/src/lib/widget-registry.ts`
- Modify: `packages/shared/src/types/widget.ts` (or wherever `WidgetDefBase` is defined)

- [ ] **Step 1: Find and read the WidgetDefBase type**

```bash
cd /c/quovibe && grep -rn "interface WidgetDefBase" packages/shared/src/
```

Read the file to understand the current interface.

- [ ] **Step 2: Add `zone` to WidgetDefBase**

Add to the `WidgetDefBase` interface:
```typescript
zone: 'chart' | 'detail';
```

- [ ] **Step 3: Add `zone` field to every widget in WIDGET_REGISTRY**

In `packages/web/src/lib/widget-registry.ts`, add `zone: 'chart'` to these 3 types:
- `drawdown-chart`
- `perf-chart`
- `returns-heatmap`

Add `zone: 'detail'` to all other 22 widget definitions.

- [ ] **Step 4: Add helper function**

At the bottom of `packages/web/src/lib/widget-registry.ts`, add:
```typescript
/** Classify a widget type into its dashboard zone */
export function getWidgetZone(type: string): 'chart' | 'detail' {
  const def = getWidgetDef(type);
  return def?.zone ?? 'detail';
}

/** Chart widget types for zone filtering */
export const CHART_WIDGET_TYPES = new Set(
  WIDGET_REGISTRY.filter((w) => w.zone === 'chart').map((w) => w.type),
);
```

- [ ] **Step 5: Verify build**

```bash
cd /c/quovibe && pnpm build
```

- [ ] **Step 6: Commit**

```bash
git add packages/shared/ packages/web/src/lib/widget-registry.ts
git commit -m "feat: add zone field to widget registry for dashboard layout"
```

---

### Task 2: Add metricsStripIds to Dashboard schema

**Files:**
- Modify: `packages/shared/src/schemas/settings.schema.ts:89-93`

- [ ] **Step 1: Update dashboardSchema**

In `packages/shared/src/schemas/settings.schema.ts`, change:
```typescript
export const dashboardSchema = z.object({
  id: z.string(),
  name: z.string(),
  widgets: z.array(dashboardWidgetSchema).default([]),
});
```

To:
```typescript
export const dashboardSchema = z.object({
  id: z.string(),
  name: z.string(),
  widgets: z.array(dashboardWidgetSchema).default([]),
  metricsStripIds: z.array(z.string()).optional(),
});
```

- [ ] **Step 2: Verify build**

```bash
cd /c/quovibe && pnpm build
```

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/schemas/settings.schema.ts
git commit -m "feat: add metricsStripIds to dashboard schema"
```

---

### Task 3: Create DashboardHero component

**Files:**
- Create: `packages/web/src/components/domain/DashboardHero.tsx`

This component shows the portfolio balance + gain/loss + sparkline. It uses the existing `useCalculation` hook at portfolio scope and fetches chart data for the sparkline.

- [ ] **Step 1: Create the hero component**

Create `packages/web/src/components/domain/DashboardHero.tsx`:

```tsx
import NumberFlow from '@number-flow/react';
import { useCalculation, useReportingPeriod } from '@/api/use-performance';
import { apiFetch } from '@/api/fetch';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { usePrivacy } from '@/context/privacy-context';
import { CurrencyDisplay } from '@/components/shared/CurrencyDisplay';
import { cn } from '@/lib/utils';
import i18n from '@/i18n';
import { useTranslation } from 'react-i18next';
import { Skeleton } from '@/components/ui/skeleton';

interface ChartPoint {
  date: string;
  marketValue: string;
}

function useHeroSparkline(periodStart: string, periodEnd: string) {
  return useQuery({
    queryKey: ['hero-sparkline', periodStart, periodEnd],
    queryFn: async () => {
      const data = await apiFetch<ChartPoint[]>(
        `/api/performance/chart?periodStart=${periodStart}&periodEnd=${periodEnd}`,
      );
      return data.map((p) => parseFloat(p.marketValue));
    },
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
  });
}

function Sparkline({ values, positive }: { values: number[]; positive: boolean }) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const h = 60;
  const w = 300;

  const points = values.map((v, i) => {
    const x = (i / (values.length - 1)) * w;
    const y = h - ((v - min) / range) * h * 0.9 - h * 0.05;
    return `${x},${y}`;
  });

  const linePath = `M${points.join(' L')}`;
  const areaPath = `${linePath} L${w},${h} L0,${h}Z`;
  const color = positive ? 'var(--qv-positive)' : 'var(--qv-negative)';

  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="w-full h-full">
      <defs>
        <linearGradient id="hero-spark-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.15} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={areaPath} fill="url(#hero-spark-grad)" />
      <path d={linePath} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

export function DashboardHero() {
  const { t } = useTranslation('dashboard');
  const { periodStart, periodEnd } = useReportingPeriod();
  const { data: calc, isLoading } = useCalculation();
  const { data: sparkData } = useHeroSparkline(periodStart, periodEnd);
  const { isPrivate } = usePrivacy();

  if (isLoading || !calc) {
    return (
      <div className="flex items-start gap-6">
        <div>
          <Skeleton className="h-4 w-24 mb-2" />
          <Skeleton className="h-10 w-48 mb-2" />
          <Skeleton className="h-5 w-32" />
        </div>
        <div className="flex-1 hidden md:block">
          <Skeleton className="h-[80px] w-full" />
        </div>
      </div>
    );
  }

  const balance = parseFloat(calc.finalValue);
  const absPerf = parseFloat(calc.absolutePerformance);
  const absPerfPct = parseFloat(calc.absolutePerformancePct);
  const isPositive = absPerf >= 0;

  return (
    <div className="flex items-start gap-6">
      {/* Left: Balance + Gain/Loss */}
      <div className="shrink-0">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          {t('hero.portfolioValue')}
        </div>
        <div className="text-3xl font-bold mt-1">
          {isPrivate ? (
            <span>••••••</span>
          ) : (
            <CurrencyDisplay value={balance} className="text-3xl font-bold" />
          )}
        </div>
        <div className="flex items-baseline gap-3 mt-1.5">
          {isPrivate ? (
            <span className="text-sm text-muted-foreground">••••••</span>
          ) : (
            <>
              <CurrencyDisplay
                value={absPerf}
                colorize
                className="text-sm font-medium"
              />
              <span
                className={cn(
                  'text-xs font-medium px-2 py-0.5 rounded-full',
                  isPositive
                    ? 'bg-[var(--qv-positive)] text-[var(--qv-bg)]'
                    : 'bg-[var(--qv-negative)] text-[var(--qv-bg)]',
                )}
              >
                <NumberFlow
                  value={absPerfPct}
                  locales={i18n.language}
                  format={{ style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2, signDisplay: 'always' }}
                />
              </span>
            </>
          )}
        </div>
      </div>
      {/* Right: Sparkline */}
      <div
        className={cn(
          'flex-1 min-w-0 h-[80px] hidden md:flex items-end pb-1',
          isPrivate && 'blur-sm saturate-0',
        )}
      >
        {sparkData && sparkData.length > 1 && (
          <Sparkline values={sparkData} positive={isPositive} />
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

```bash
cd /c/quovibe && pnpm build --filter @quovibe/web
```

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/domain/DashboardHero.tsx
git commit -m "feat: create DashboardHero component with sparkline"
```

---

### Task 4: Create DashboardMetricsStrip + settings

**Files:**
- Create: `packages/web/src/components/domain/DashboardMetricsStrip.tsx`
- Create: `packages/web/src/components/domain/MetricsStripSettings.tsx`

- [ ] **Step 1: Create MetricsStripSettings popover**

Create `packages/web/src/components/domain/MetricsStripSettings.tsx`:

```tsx
import { Settings2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';

const ALL_METRIC_IDS = [
  'ttwror', 'ttwror-pa', 'irr', 'delta',
  'absolute-performance', 'absolute-change',
  'max-drawdown', 'current-drawdown',
  'volatility', 'sharpe-ratio', 'semivariance',
  'cash-drag', 'invested-capital', 'all-time-high', 'distance-from-ath',
] as const;

interface MetricsStripSettingsProps {
  selected: string[];
  onChange: (ids: string[]) => void;
}

export function MetricsStripSettings({ selected, onChange }: MetricsStripSettingsProps) {
  const { t } = useTranslation('dashboard');

  function toggle(id: string) {
    if (selected.includes(id)) {
      onChange(selected.filter((s) => s !== id));
    } else if (selected.length < 4) {
      onChange([...selected, id]);
    }
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 shrink-0 text-muted-foreground hover:text-foreground"
          aria-label={t('hero.configureMetrics')}
        >
          <Settings2 className="h-3.5 w-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56 p-2">
        <div className="text-xs font-medium text-muted-foreground mb-2 px-1">
          {t('hero.selectMetrics')} ({selected.length}/4)
        </div>
        <div className="space-y-1">
          {ALL_METRIC_IDS.map((id) => {
            const checked = selected.includes(id);
            const disabled = !checked && selected.length >= 4;
            return (
              <label
                key={id}
                className="flex items-center gap-2 px-1 py-1 rounded hover:bg-muted cursor-pointer text-sm"
              >
                <Checkbox
                  checked={checked}
                  disabled={disabled}
                  onCheckedChange={() => toggle(id)}
                />
                {t(`widgetTypes.${id}`)}
              </label>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
```

- [ ] **Step 2: Create DashboardMetricsStrip component**

Create `packages/web/src/components/domain/DashboardMetricsStrip.tsx`:

```tsx
import NumberFlow from '@number-flow/react';
import { useTranslation } from 'react-i18next';
import { useCalculation } from '@/api/use-performance';
import { usePrivacy } from '@/context/privacy-context';
import { CurrencyDisplay } from '@/components/shared/CurrencyDisplay';
import { MetricsStripSettings } from './MetricsStripSettings';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import i18n from '@/i18n';

const DEFAULT_METRICS = ['ttwror', 'delta', 'irr', 'max-drawdown'];

interface MetricsStripProps {
  metricIds?: string[];
  onMetricIdsChange: (ids: string[]) => void;
}

/** Maps metric ID → field in CalculationBreakdownResponse + display config */
function resolveMetric(
  id: string,
  data: Record<string, string | number | boolean | null>,
): { value: number; format: 'percent' | 'currency' } | null {
  switch (id) {
    case 'ttwror':
      return { value: parseFloat(data.ttwror as string), format: 'percent' };
    case 'ttwror-pa':
      return { value: parseFloat(data.ttwrorPa as string), format: 'percent' };
    case 'irr':
      return data.irrConverged && data.irr != null
        ? { value: parseFloat(data.irr as string), format: 'percent' }
        : null;
    case 'delta':
      return { value: parseFloat(data.deltaValue as string), format: 'currency' };
    case 'absolute-performance':
      return { value: parseFloat(data.absolutePerformance as string), format: 'currency' };
    case 'absolute-change':
      return { value: parseFloat(data.absoluteChange as string), format: 'currency' };
    case 'max-drawdown':
      return { value: -parseFloat(data.maxDrawdown as string), format: 'percent' };
    case 'current-drawdown':
      return { value: -parseFloat(data.currentDrawdown as string), format: 'percent' };
    case 'volatility':
      return { value: parseFloat(data.volatility as string), format: 'percent' };
    case 'semivariance':
      return { value: parseFloat(data.semivariance as string), format: 'percent' };
    case 'sharpe-ratio':
      return data.sharpeRatio != null
        ? { value: parseFloat(data.sharpeRatio as string), format: 'percent' }
        : null;
    case 'invested-capital':
      return { value: parseFloat(data.initialValue as string), format: 'currency' };
    case 'all-time-high':
      return { value: parseFloat(data.finalValue as string), format: 'currency' };
    case 'distance-from-ath':
      return { value: parseFloat(data.currentDrawdown as string), format: 'percent' };
    case 'cash-drag':
      return null; // cash-drag requires a different data source, omit from strip
    default:
      return null;
  }
}

function getColorClass(id: string, value: number): string | undefined {
  // Metrics where sign determines color
  const signColored = [
    'ttwror', 'ttwror-pa', 'irr', 'delta',
    'absolute-performance', 'absolute-change', 'sharpe-ratio',
  ];
  if (signColored.includes(id)) {
    if (value > 0) return 'text-[var(--qv-positive)]';
    if (value < 0) return 'text-[var(--qv-negative)]';
    return undefined;
  }
  // Metrics always shown in danger color (drawdowns)
  const dangerMetrics = ['max-drawdown', 'current-drawdown', 'distance-from-ath'];
  if (dangerMetrics.includes(id) && value !== 0) return 'text-[var(--qv-negative)]';
  return undefined;
}

export function DashboardMetricsStrip({ metricIds, onMetricIdsChange }: MetricsStripProps) {
  const { t } = useTranslation('dashboard');
  const { data: calc, isLoading } = useCalculation();
  const { isPrivate } = usePrivacy();
  const ids = metricIds && metricIds.length > 0 ? metricIds : DEFAULT_METRICS;

  if (isLoading || !calc) {
    return (
      <div className="flex gap-0 py-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex-1 px-3">
            <Skeleton className="h-3 w-16 mb-2" />
            <Skeleton className="h-6 w-20" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="flex items-center">
      <div className="flex flex-1 flex-wrap md:flex-nowrap gap-0">
        {ids.map((id, i) => {
          const resolved = resolveMetric(id, calc as unknown as Record<string, string | number | boolean | null>);
          const isLast = i === ids.length - 1;

          return (
            <div
              key={id}
              className={cn(
                'flex-1 min-w-0 py-2 px-3',
                // Desktop: vertical dividers between items
                !isLast && 'md:border-r md:border-border',
                // Mobile: 2x2 grid
                'basis-1/2 md:basis-auto',
              )}
            >
              <div className="text-[0.6rem] text-muted-foreground uppercase tracking-wider font-medium truncate">
                {t(`widgetTypes.${id}`)}
              </div>
              <div className={cn('text-lg font-semibold mt-0.5', resolved ? getColorClass(id, resolved.value) : undefined)}>
                {isPrivate ? (
                  '••••••'
                ) : resolved === null ? (
                  <span className="text-muted-foreground">—</span>
                ) : resolved.format === 'currency' ? (
                  <CurrencyDisplay value={resolved.value} colorize className="text-lg font-semibold" />
                ) : (
                  <NumberFlow
                    className="muted-fraction"
                    value={resolved.value}
                    locales={i18n.language}
                    format={{ style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2 }}
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>
      <MetricsStripSettings selected={ids} onChange={onMetricIdsChange} />
    </div>
  );
}
```

- [ ] **Step 3: Verify build**

```bash
cd /c/quovibe && pnpm build --filter @quovibe/web
```

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/components/domain/DashboardMetricsStrip.tsx \
       packages/web/src/components/domain/MetricsStripSettings.tsx
git commit -m "feat: create DashboardMetricsStrip and settings popover"
```

---

### Task 5: Add compact mode to WidgetShell

**Files:**
- Modify: `packages/web/src/components/domain/WidgetShell.tsx`
- Modify: `packages/web/src/globals.css`

- [ ] **Step 1: Add compact CSS override to globals.css**

Add after the `number-flow-react.muted-fraction` block:

```css
/* Compact widget mode — reduces text-2xl to text-xl in detail zone */
.qv-compact-widget .text-2xl {
  font-size: 1.25rem;
  line-height: 1.75rem;
}
```

- [ ] **Step 2: Add compact prop to WidgetShell**

In `packages/web/src/components/domain/WidgetShell.tsx`:

Add `compact?: boolean` to the `WidgetShellProps` interface:
```typescript
interface WidgetShellProps {
  // ... existing props ...
  /** Compact mode for detail zone — reduced padding and text */
  compact?: boolean;
}
```

Add `compact = false` to the destructured props.

Update the `<Card>` element: when `compact` is true, adjust padding classes. Replace the Card className:

```tsx
<Card
  className={cn(
    'group relative h-full flex flex-col bg-card border border-border rounded-lg transition-colors duration-200',
    compact && 'qv-compact-widget',
  )}
  style={{ animation: 'qv-stagger-in 0.4s ease-out both', animationDelay: `${index * 50}ms` }}
>
```

Update `<CardHeader>` padding for compact:
```tsx
<CardHeader className={cn(
  'flex flex-row items-center gap-2 space-y-0 pb-0',
  compact ? 'pt-2 px-3' : 'pt-2.5 px-4',
)}>
```

Update `<CardContent>` padding for compact:
```tsx
<CardContent className={cn('flex-1', compact ? 'pt-0 px-3 pb-3' : 'pt-0')}>
```

Update grip handle icon size for compact:
```tsx
<GripHorizontal className={cn(
  'text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity duration-150',
  compact ? 'h-3 w-3' : 'h-4 w-4',
)} />
```

- [ ] **Step 3: Verify build**

```bash
cd /c/quovibe && pnpm build --filter @quovibe/web
```

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/components/domain/WidgetShell.tsx packages/web/src/globals.css
git commit -m "feat: add compact mode to WidgetShell for dashboard detail zone"
```

---

### Task 6: Restructure Dashboard.tsx with zone layout

**Files:**
- Modify: `packages/web/src/pages/Dashboard.tsx`

This is the main integration task. The dashboard page renders:
1. Tab bar (unchanged)
2. Hero section (new)
3. Metrics strip (new)
4. Charts zone (chart widgets, full-width)
5. Detail zone (compact grid)

- [ ] **Step 1: Add imports**

At the top of `packages/web/src/pages/Dashboard.tsx`, add:
```typescript
import { DashboardHero } from '@/components/domain/DashboardHero';
import { DashboardMetricsStrip } from '@/components/domain/DashboardMetricsStrip';
import { CHART_WIDGET_TYPES } from '@/lib/widget-registry';
```

- [ ] **Step 2: Add metrics strip config handler**

Inside the `Dashboard` component, add a function to save metricsStripIds:
```typescript
function updateMetricsStripIds(ids: string[]) {
  updateActiveDashboard((d) => ({ ...d, metricsStripIds: ids }));
}
```

- [ ] **Step 3: Split widgets into zones**

Before the render, add zone splitting:
```typescript
const chartWidgets = activeDash?.widgets.filter((w) => CHART_WIDGET_TYPES.has(w.type)) ?? [];
const detailWidgets = activeDash?.widgets.filter((w) => !CHART_WIDGET_TYPES.has(w.type)) ?? [];
const chartIds = chartWidgets.map((w) => w.id);
const detailIds = detailWidgets.map((w) => w.id);
```

- [ ] **Step 4: Update the drag-end handler for two zones**

The current `handleDragEnd` reorders within the flat `widgets` array. With two zones, we need to ensure drag-end only reorders within the same zone. Replace `handleDragEnd`:

```typescript
function handleDragEnd(event: DragEndEvent) {
  const { active, over } = event;
  if (!over || active.id === over.id) return;
  updateActiveDashboard((d) => {
    const oldIdx = d.widgets.findIndex((w) => w.id === active.id);
    const newIdx = d.widgets.findIndex((w) => w.id === over.id);
    if (oldIdx === -1 || newIdx === -1) return d;
    // Only allow reorder within the same zone
    const activeIsChart = CHART_WIDGET_TYPES.has(d.widgets[oldIdx].type);
    const overIsChart = CHART_WIDGET_TYPES.has(d.widgets[newIdx].type);
    if (activeIsChart !== overIsChart) return d;
    return { ...d, widgets: arrayMove(d.widgets, oldIdx, newIdx) };
  });
}
```

- [ ] **Step 5: Replace the widget grid render block**

Replace the block from `{/* ── Widget grid ── */}` (line ~545) through the closing `</DndContext>` (line ~574) with:

```tsx
{/* ── Hero + Metrics Strip ── */}
<DashboardHero />
<DashboardMetricsStrip
  metricIds={activeDash.metricsStripIds}
  onMetricIdsChange={updateMetricsStripIds}
/>
<div className="border-b border-border" />

{activeDash.widgets.length === 0 ? (
  <div className="flex flex-col items-center justify-center py-24 text-muted-foreground gap-4">
    <LayoutDashboard className="h-12 w-12 opacity-30" />
    <p className="text-sm">{t('emptyDashboard')}</p>
    <Button variant="outline" size="sm" onClick={() => setCatalogOpen(true)}>
      <Plus className="h-4 w-4 mr-1" />
      {t('addWidget')}
    </Button>
  </div>
) : (
  <DndContext sensors={widgetSensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
    {/* Charts zone */}
    {chartWidgets.length > 0 && (
      <SortableContext items={chartIds} strategy={rectSortingStrategy}>
        <div className="space-y-4">
          {chartWidgets.map((widget, i) => (
            <SortableWidget
              key={widget.id}
              widget={{ ...widget, span: 3 }}
              dashboardId={activeDash.id}
              index={i}
              onDelete={deleteWidget}
              onTitleChange={changeWidgetTitle}
            />
          ))}
        </div>
      </SortableContext>
    )}

    {/* Detail zone */}
    {detailWidgets.length > 0 && (
      <SortableContext items={detailIds} strategy={rectSortingStrategy}>
        <div
          className="grid gap-2 qv-dashboard-grid"
          style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(220px, 100%), 1fr))' }}
        >
          {detailWidgets.map((widget, i) => (
            <SortableWidget
              key={widget.id}
              widget={widget}
              dashboardId={activeDash.id}
              index={i}
              onDelete={deleteWidget}
              onTitleChange={changeWidgetTitle}
              compact
            />
          ))}
        </div>
      </SortableContext>
    )}
  </DndContext>
)}
```

- [ ] **Step 6: Pass `compact` prop through SortableWidget**

The `SortableWidget` component needs to accept and forward a `compact` prop. Update the interface:

```typescript
interface SortableWidgetProps {
  widget: DashboardWidget;
  dashboardId: string;
  index: number;
  onDelete: (widgetId: string) => void;
  onTitleChange: (widgetId: string, title: string) => void;
  compact?: boolean;
}
```

Add `compact = false` to destructured props. Pass it to `<WidgetShell>`:
```tsx
<WidgetShell
  // ... existing props ...
  compact={compact}
>
```

- [ ] **Step 7: Remove the old `widgetIds` variable**

The old `widgetIds` variable is no longer needed (replaced by `chartIds` and `detailIds`). Remove:
```typescript
const widgetIds = activeDash?.widgets.map((w) => w.id) ?? [];
```

- [ ] **Step 8: Verify build**

```bash
cd /c/quovibe && pnpm build --filter @quovibe/web
```

- [ ] **Step 9: Commit**

```bash
git add packages/web/src/pages/Dashboard.tsx
git commit -m "feat: restructure dashboard with four-zone layout"
```

---

### Task 7: Add i18n keys

**Files:**
- Modify: `packages/web/src/i18n/locales/en/dashboard.json`
- Modify: 7 other language files (`it`, `de`, `fr`, `es`, `nl`, `pl`, `pt`)

- [ ] **Step 1: Add English keys**

In `packages/web/src/i18n/locales/en/dashboard.json`, add inside the `"hero"` object (or create it at the top level if it doesn't exist):

```json
"hero": {
  "portfolioValue": "Portfolio Value",
  "configureMetrics": "Configure metrics",
  "selectMetrics": "Select metrics to display"
}
```

- [ ] **Step 2: Add same keys to all 7 other language files**

For each language, translate the 3 keys. Use established financial terminology. Example for Italian:
```json
"hero": {
  "portfolioValue": "Valore del portafoglio",
  "configureMetrics": "Configura metriche",
  "selectMetrics": "Seleziona le metriche da visualizzare"
}
```

Repeat for `de`, `fr`, `es`, `nl`, `pl`, `pt`.

- [ ] **Step 3: Verify build**

```bash
cd /c/quovibe && pnpm build --filter @quovibe/web
```

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/i18n/
git commit -m "feat: add i18n keys for dashboard hero and metrics strip"
```

---

### Task 8: Build + lint verification

- [ ] **Step 1: Full build**

```bash
cd /c/quovibe && pnpm build
```

- [ ] **Step 2: Lint**

```bash
cd /c/quovibe && pnpm lint
```

- [ ] **Step 3: Run check suite**

```bash
cd /c/quovibe && pnpm check:all
```

- [ ] **Step 4: Final commit if any fixes needed**

If lint or checks reveal issues, fix and commit:
```bash
git add -A && git commit -m "fix: address lint/check issues from dashboard redesign"
```
