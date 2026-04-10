# Chart Page Layout & Visual Storytelling — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the Card wrapper from the performance chart page, add a performance summary bar, restyle the segmented control in the page header actions, and restyle the legend with rounded pills.

**Architecture:** The performance chart page is nested inside the `Analytics` layout (`Analytics.tsx`) which provides a `PageHeader` component. The chart page injects its toggle/export/settings buttons into the PageHeader via `setActions()` from `AnalyticsContext`. The Card wrapper in `PerformanceChart.tsx` only wraps the legend + chart canvas — remove it. New `ChartSummaryBar` component passes data via props from the parent. Legend restyling is CSS/className changes only.

**Tech Stack:** React 19, NumberFlow, lightweight-charts (existing), i18n

**Spec:** `docs/superpowers/specs/2026-04-07-chart-layout-storytelling-design.md`

---

## File Structure

| File | Action |
|------|--------|
| `packages/web/src/components/domain/ChartSummaryBar.tsx` | Create — performance summary bar |
| `packages/web/src/pages/PerformanceChart.tsx` | Modify — remove Card wrapper, add summary bar, restyle setActions toggle, add useCalculation |
| `packages/web/src/components/shared/ChartLegendOverlay.tsx` | Modify — restyle ExtendedChartLegendOverlay items |
| `packages/web/src/i18n/locales/*/performance.json` (8 files) | Modify — verify/add i18n keys |

---

### Task 1: Create ChartSummaryBar component

**Files:**
- Create: `packages/web/src/components/domain/ChartSummaryBar.tsx`

- [ ] **Step 1: Create the component**

Create `packages/web/src/components/domain/ChartSummaryBar.tsx`:

```tsx
import NumberFlow from '@number-flow/react';
import { usePrivacy } from '@/context/privacy-context';
import { CurrencyDisplay } from '@/components/shared/CurrencyDisplay';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDate } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import i18n from '@/i18n';

interface ChartSummaryBarProps {
  totalReturn: number;
  absoluteGain: number;
  periodStart: string;
  periodEnd: string;
  isLoading: boolean;
}

export function ChartSummaryBar({
  totalReturn,
  absoluteGain,
  periodStart,
  periodEnd,
  isLoading,
}: ChartSummaryBarProps) {
  const { isPrivate } = usePrivacy();

  if (isLoading) {
    return <Skeleton className="h-5 w-64" />;
  }

  const isPositive = totalReturn >= 0;

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
      {/* Total return */}
      <span className={cn('font-semibold', isPositive ? 'text-[var(--qv-positive)]' : 'text-[var(--qv-negative)]')}>
        {isPrivate ? '••••••' : (
          <NumberFlow
            className="muted-fraction"
            value={totalReturn}
            locales={i18n.language}
            format={{ style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2, signDisplay: 'always' }}
          />
        )}
      </span>

      <span className="text-muted-foreground/40">·</span>

      {/* Absolute gain/loss */}
      {isPrivate ? (
        <span className="text-muted-foreground">••••••</span>
      ) : (
        <CurrencyDisplay value={absoluteGain} colorize className="text-sm" />
      )}

      <span className="text-muted-foreground/40">·</span>

      {/* Period dates */}
      <span className="text-muted-foreground">
        {formatDate(periodStart)} – {formatDate(periodEnd)}
      </span>
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
cd /c/quovibe && git add packages/web/src/components/domain/ChartSummaryBar.tsx && git commit -m "feat: create ChartSummaryBar component for performance page"
```

---

### Task 2: Restyle the segmented control + remove Card wrapper + add summary bar

**Files:**
- Modify: `packages/web/src/pages/PerformanceChart.tsx`

This is the main integration task. Three changes:
1. Restyle the toggle buttons in `setActions()` to use rounded-full segmented control
2. Remove the Card wrapper
3. Add ChartSummaryBar + useCalculation

- [ ] **Step 1: Update imports**

Remove Card-related imports. Add new imports.

Remove from imports:
```typescript
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
```
Also remove:
```typescript
import { FadeIn } from '@/components/shared/FadeIn';
```

Add:
```typescript
import { ChartSummaryBar } from '@/components/domain/ChartSummaryBar';
import { useCalculation } from '@/api/use-performance';
```

- [ ] **Step 2: Add useCalculation call**

Inside the `PerformanceChart` component, after the existing `usePerformanceChart` call (line 48), add:

```typescript
const { data: calcData, isLoading: calcLoading } = useCalculation();
```

- [ ] **Step 3: Restyle the segmented control in setActions**

Replace the `setActions` useEffect (lines 179-220). The toggle buttons currently use `rounded-lg border` styling. Change to `rounded-full` segmented control:

Replace the entire `setActions(...)` call content:

```tsx
setActions(
  <>
    <div className="inline-flex bg-muted rounded-full p-0.5">
      <button
        className={cn(
          'px-3 py-1 text-xs font-medium rounded-full transition-all duration-200 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none',
          ttwrorMode === 'cumulative'
            ? 'bg-background text-foreground shadow-sm'
            : 'text-muted-foreground hover:text-foreground',
        )}
        onClick={() => setTtwrorMode('cumulative')}
      >
        {t('chart.cumulative')}
      </button>
      <button
        className={cn(
          'px-3 py-1 text-xs font-medium rounded-full transition-all duration-200 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none',
          ttwrorMode === 'annualized'
            ? 'bg-background text-foreground shadow-sm'
            : 'text-muted-foreground hover:text-foreground',
        )}
        onClick={() => setTtwrorMode('annualized')}
      >
        {t('chart.annualizedPa')}
      </button>
    </div>
    <ChartExportButton
      chartRef={chartContainerRef}
      filename={`performance-chart-${periodStart}-to-${periodEnd}`}
    />
    <Button
      variant="ghost"
      size="icon"
      className="h-8 w-8"
      onClick={() => setConfigOpen(true)}
    >
      <Settings className="h-4 w-4" />
    </Button>
  </>
);
```

Key change: outer container goes from `inline-flex rounded-lg border border-border bg-muted/50 p-0.5` to `inline-flex bg-muted rounded-full p-0.5`. Button shape goes from `rounded-md` to `rounded-full`. Added `transition-all duration-200`.

- [ ] **Step 4: Derive summary bar data**

After the `displayData` useMemo (around line 240), add:

```typescript
// Derive total return from last data point for the summary bar
const totalReturn = displayData.length > 0
  ? displayData[displayData.length - 1].ttwror // native-ok
  : 0;
const absoluteGain = calcData ? parseFloat(calcData.absolutePerformance) : 0;
```

- [ ] **Step 5: Replace the return block — remove Card, add summary bar**

Replace the entire return block (lines 450-491). The old structure is:

```tsx
return (
  <Card style={{ animation: ... }}>
    <CardHeader>
      <CardTitle>...</CardTitle>
    </CardHeader>
    <CardContent>
      <div className="relative" style={{ minHeight: 360 }}>
        {isLoading && <ChartSkeleton height={360} />}
        <div className={cn(isLoading && 'invisible')}>
          <div className="flex items-center justify-between mb-1">
            <ExtendedChartLegendOverlay ... />
          </div>
          <div ref={chartContainerRef} ...>
            <div ref={containerRef} ... style={{ height: 360 }} />
          </div>
        </div>
      </div>
    </CardContent>
    <DataSeriesPickerDialog ... />
  </Card>
);
```

Replace with:

```tsx
return (
  <div className="space-y-3" style={{ animation: 'qv-stagger-in 0.4s ease-out both', animationDelay: '120ms' }}>
    {/* Summary bar */}
    <ChartSummaryBar
      totalReturn={totalReturn}
      absoluteGain={absoluteGain}
      periodStart={periodStart}
      periodEnd={periodEnd}
      isLoading={isLoading || calcLoading}
    />

    {/* Chart area */}
    <div className="relative" style={{ minHeight: 400 }}>
      {isLoading && <ChartSkeleton height={400} />}
      <div className={cn(isLoading && 'invisible')}>
        <div className="mb-1">
          <ExtendedChartLegendOverlay
            chart={chartRef.current}
            items={legendItems}
            onToggleVisibility={handleToggleVisibility}
            onColorChange={handleColorChange}
            onLineStyleChange={handleLineStyleChange}
            onAreaFillToggle={handleAreaFillToggle}
            onRemove={handleRemoveSeries}
            onReorder={handleReorder}
            onIsolate={handleIsolate}
          />
        </div>
        <div
          ref={chartContainerRef}
          className={cn(
            'relative',
            isFetching && !isLoading && 'opacity-60 transition-opacity duration-200',
          )}
          style={{
            filter: isPrivate ? 'blur(8px) saturate(0)' : 'none',
            transition: 'filter 0.2s ease',
          }}
        >
          <div ref={containerRef} className="w-full" style={{ height: 400 }} />
        </div>
      </div>
    </div>

    <DataSeriesPickerDialog open={configOpen} onOpenChange={setConfigOpen} />
  </div>
);
```

Key changes:
- `<Card>` → `<div className="space-y-3">`
- `<CardHeader>` + `<CardTitle>` removed entirely (redundant with Analytics PageHeader)
- `<CardContent>` → plain content
- Chart height: 360 → 400
- `ChartSummaryBar` added above the chart
- `<div className="flex items-center justify-between mb-1">` simplified to `<div className="mb-1">` (the justify-between was wrapping the legend, no longer needed without adjacent controls)

- [ ] **Step 6: Verify build**

```bash
cd /c/quovibe && pnpm build --filter @quovibe/web
```

- [ ] **Step 7: Commit**

```bash
cd /c/quovibe && git add packages/web/src/pages/PerformanceChart.tsx && git commit -m "feat: remove Card wrapper, add summary bar, restyle segmented control"
```

---

### Task 3: Restyle ExtendedChartLegendOverlay

**Files:**
- Modify: `packages/web/src/components/shared/ChartLegendOverlay.tsx`

CSS/className changes only to the `SortableExtendedItem` component and the `ExtendedChartLegendOverlay` container.

- [ ] **Step 1: Update the container className**

In `ExtendedChartLegendOverlay` (line 460), replace:
```tsx
<div className={cn('group/ext-legend flex flex-wrap gap-x-1 gap-y-0.5 text-xs py-1', className)}>
```
With:
```tsx
<div className={cn('group/ext-legend flex flex-wrap gap-1.5 text-xs py-1', className)}>
```

- [ ] **Step 2: Update the item wrapper className**

In `SortableExtendedItem` (line 288-291), replace:
```tsx
className={cn(
  'flex items-center gap-1.5 px-1.5 py-0.5 rounded text-xs cursor-pointer select-none',
  'border border-transparent hover:border-border/50 hover:bg-muted/30 transition-colors',
)}
```
With:
```tsx
className={cn(
  'flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs cursor-pointer select-none',
  'bg-muted/50 hover:bg-muted transition-colors',
)}
```

- [ ] **Step 3: Replace color dot with line segment indicator**

In `SortableExtendedItem`, find the color dot section (lines 306-326). The color dot is:
```tsx
<button
  className="inline-block w-2 h-2 rounded-full shrink-0"
  style={{ backgroundColor: item.color }}
  ...
/>
```

Replace the `className` and `style` for BOTH the button version and the plain span version. Instead of a colored circle, render a short line:

For the button (with color picker):
```tsx
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
```

For the plain span (no color change):
```tsx
<svg width="8" height="3" className="shrink-0">
  <line x1="0" y1="1.5" x2="8" y2="1.5"
    stroke={item.color} strokeWidth="2.5"
    strokeDasharray={item.lineStyle === 'dashed' ? '3 2' : item.lineStyle === 'dotted' ? '1 2' : undefined}
  />
</svg>
```

- [ ] **Step 4: Update label and crosshair value styling**

Find the label span (line 342):
```tsx
<span className={cn('text-foreground whitespace-nowrap', !item.visible && 'line-through opacity-50')}>
```
Change to:
```tsx
<span className={cn('font-medium text-foreground whitespace-nowrap', !item.visible && 'line-through opacity-50')}>
```

Find the crosshair value span (line 348):
```tsx
<span className={cn('font-mono font-medium whitespace-nowrap text-foreground', isPrivate && 'blur-sm')}>
```
Change to:
```tsx
<span className={cn('tabular-nums whitespace-nowrap text-muted-foreground', isPrivate && 'blur-sm')}>
```

- [ ] **Step 5: Verify build**

```bash
cd /c/quovibe && pnpm build --filter @quovibe/web
```

- [ ] **Step 6: Commit**

```bash
cd /c/quovibe && git add packages/web/src/components/shared/ChartLegendOverlay.tsx && git commit -m "style: restyle chart legend with rounded pills and line indicators"
```

---

### Task 4: Build + lint verification

- [ ] **Step 1: Full build**

```bash
cd /c/quovibe && pnpm build
```

- [ ] **Step 2: Lint**

```bash
cd /c/quovibe && pnpm lint
```

Check for unused imports in the modified files.

- [ ] **Step 3: Tests**

```bash
cd /c/quovibe && pnpm test
```

- [ ] **Step 4: Commit fixes if needed**

```bash
cd /c/quovibe && git add -A && git commit -m "fix: address lint/test issues from chart layout redesign"
```
