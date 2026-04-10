# Chart Page Layout & Visual Storytelling

**Date:** 2026-04-07
**Status:** Approved
**Scope:** Performance chart page layout restructure, two new components (summary bar, toolbar row), legend restyling. Builds on the canvas polish from part 1.

## Goal

Remove the Card wrapper from the performance chart page for an edge-to-edge feel, add a performance summary bar for at-a-glance context, replace the mode toggle with a polished segmented control, and restyle the legend with rounded pills.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Page structure | Remove Card, edge-to-edge | Let the chart breathe, warm palette provides containment |
| Legend | Keep position, polish styling | Standard position, existing interactions are solid |
| Visual storytelling | Performance summary bar | Numeric narrative complements the zero-crossing visual narrative |
| Mode toggle | Segmented control with CSS transition | Polished standard pattern, no new deps |

## 1. Page Structure

**File:** `packages/web/src/pages/PerformanceChart.tsx`

### Remove Card Wrapper

Current structure:
```
<Card> → <CardHeader> → title + controls → </CardHeader> → <CardContent> → legend + chart → </CardContent> → </Card>
```

New structure:
```
<div class="qv-page space-y-4">
  <div> Page title + subtitle </div>
  <ChartSummaryBar />
  <ChartToolbarRow />
  <ExtendedChartLegendOverlay />
  <div ref={containerRef} style={{ height: 400 }} />
</div>
```

### Changes
- Remove `Card`, `CardHeader`, `CardContent`, `CardTitle` imports and wrappers
- Page heading: `<h1 className="text-lg font-semibold">` + subtitle `<p className="text-sm text-muted-foreground">`
- Chart container height: 360px → 400px
- Privacy blur filter stays on the chart container div
- Remove unused `FadeIn` import
- Stagger-in animation (`qv-page` class) stays on the outer wrapper

## 2. Performance Summary Bar

**New file:** `packages/web/src/components/domain/ChartSummaryBar.tsx`

A compact presentational component showing period performance at a glance.

### Props
```typescript
interface ChartSummaryBarProps {
  totalReturn: number;       // ttwrorCumulative from last data point (fraction, e.g. 0.1245)
  absoluteGain: number;      // absolutePerformance from calculation
  periodStart: string;       // yyyy-MM-dd
  periodEnd: string;         // yyyy-MM-dd
  isLoading: boolean;
}
```

### Layout
- Flex row: `flex items-center gap-2 text-sm`
- Content: `<NumberFlow value={totalReturn} format={% ...} />` (colored) · `<CurrencyDisplay value={absoluteGain} colorize />` · period label formatted via `formatDate`
- Separator: `<span className="text-muted-foreground/40">·</span>` between each item
- Total return and absolute gain use profit/loss semantic colors
- Period label in `text-muted-foreground`
- Privacy: values show `••••••`, period label stays visible

### Data Source
The parent page (`PerformanceChart.tsx`) already has `usePerformanceChart` and `useCalculation` data. Pass the relevant values as props — no new API calls.

Actually, the page currently only fetches chart data via `usePerformanceChart`, not `useCalculation`. For the absolute gain, we need `useCalculation`. Add a `useCalculation()` call to the page (same hook the dashboard uses, deduplicates via TanStack Query). Extract `absolutePerformance` from it.

For `totalReturn`: derive from the chart data's last point `ttwrorCumulative`.

### Loading State
Show `<Skeleton className="h-5 w-64" />` when `isLoading`.

## 3. Segmented Control Toolbar

**New file:** `packages/web/src/components/domain/ChartToolbarRow.tsx`

### Props
```typescript
interface ChartToolbarRowProps {
  mode: 'cumulative' | 'annualized';
  onModeChange: (mode: 'cumulative' | 'annualized') => void;
  onSettingsClick: () => void;
  onExportClick: () => void;
}
```

### Layout
- Container: `flex items-center justify-between`
- **Left — Segmented control:**
  - Outer: `inline-flex bg-muted rounded-full p-0.5`
  - Each segment: `px-3 py-1 text-xs font-medium rounded-full transition-all duration-200 cursor-pointer`
  - Active: `bg-background text-foreground shadow-sm`
  - Inactive: `text-muted-foreground hover:text-foreground`
  - Two segments: "Cumulative" and "Annualized (p.a.)" (i18n keys)
  - Pure CSS transitions — no Framer Motion, no layoutId. The active state is applied via conditional className.
- **Right — Action buttons:**
  - Settings button: `<Button variant="ghost" size="icon">` with `<Settings>` icon
  - Export button: `<ChartExportButton>` (existing component, already handles the export logic)
  - Grouped in `flex items-center gap-1`

### Behavior
- `onModeChange` replaces the current `ttwrorMode` state setter
- `onSettingsClick` opens the `DataSeriesPickerDialog` (replaces the current gear button in CardHeader)
- `onExportClick` is handled by `ChartExportButton` internally (it has its own click handler)

## 4. Legend Restyling

**File:** `packages/web/src/components/shared/ChartLegendOverlay.tsx` (ExtendedChartLegendOverlay section)

### Visual Changes Only — No Logic Changes

| Property | Current | New |
|----------|---------|-----|
| Item wrapper | Plain flex items | `bg-muted/50 rounded-full px-2.5 py-1 hover:bg-muted transition-colors` |
| Item when hidden | `opacity-50` | `opacity-40` |
| Color indicator | Color dot (circle) | Short line segment: `<svg width="8" height="3"><line x1="0" y1="1.5" x2="8" y2="1.5" stroke={color} strokeWidth="2.5" strokeDasharray={dasharray} /></svg>` matching the series line style |
| Series name | `text-sm` | `text-xs font-medium` |
| Crosshair value | After name, `text-sm` | After name, `text-xs tabular-nums text-muted-foreground` |
| Container gap | `gap-x-4` | `gap-1.5` |
| Container | `flex flex-wrap` | `flex flex-wrap gap-1.5` |

### Line Style Indicator
The color indicator SVG uses `strokeDasharray` based on the series line style:
- `solid`: no dasharray
- `dashed`: `strokeDasharray="3 2"`
- `dotted`: `strokeDasharray="1 2"`

### All Interactions Preserved
- Drag-to-reorder (dnd-kit)
- Right-click context menu (color picker, line style, area fill, remove)
- Click to toggle visibility
- Double-click to isolate
- Color picker popover

## 5. i18n Keys

Add to `dashboard` or `performance` namespace (wherever the chart page uses):

```json
"chart": {
  "segmented": {
    "cumulative": "Cumulative",
    "annualized": "Annualized (p.a.)"
  },
  "summary": {
    "periodLabel": "{{start}} – {{end}}"
  }
}
```

Check if `chart.cumulative` and `chart.annualized` keys already exist before adding duplicates.

## 6. Files Changed

### New Files
| File | Purpose |
|------|---------|
| `packages/web/src/components/domain/ChartSummaryBar.tsx` | Performance summary bar |
| `packages/web/src/components/domain/ChartToolbarRow.tsx` | Segmented control + action buttons |

### Modified Files
| File | Changes |
|------|---------|
| `packages/web/src/pages/PerformanceChart.tsx` | Remove Card wrapper, restructure layout, add useCalculation call, integrate new components |
| `packages/web/src/components/shared/ChartLegendOverlay.tsx` | Restyle ExtendedChartLegendOverlay items (CSS/className only) |
| `packages/web/src/i18n/locales/*/performance.json` (8 files) | Add segmented control and summary bar i18n keys |

## 7. What This Does NOT Change

- Chart canvas rendering (lightweight-charts config — done in part 1)
- Series data fetching or transformation
- Data series picker dialog
- Chart config persistence
- Crosshair behavior or values hook
- PriceChart component (security detail page)
- Widget chart components (dashboard)
- Any API/backend code
