# Chart Canvas Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Polish chart canvas rendering: zero-crossing gradient fills, dotted horizontal grid, thicker series lines.

**Architecture:** Pure configuration changes to lightweight-charts theme hook and series factory. Performance chart switches portfolio series from AreaSeries to BaselineSeries for zero-crossing fills. No new components, no layout changes.

**Tech Stack:** lightweight-charts, existing hooks and factory

**Spec:** `docs/superpowers/specs/2026-04-07-chart-canvas-polish-design.md`

---

## File Structure

| File | Change |
|------|--------|
| `packages/web/src/hooks/use-chart-theme.ts` | Grid: hide vertical, dotted horizontal at 15% opacity |
| `packages/web/src/lib/chart-series-factory.ts` | Line width 2→2.5, area alpha 0.25→0.35, baseline fill alpha 0.19→0.25 |
| `packages/web/src/pages/PerformanceChart.tsx` | Portfolio series: AreaSeries → BaselineSeries with zero-crossing |
| `packages/web/src/components/domain/widgets/WidgetPerfChart.tsx` | TTWROR modes: default to baseline instead of area |

---

### Task 1: Update chart theme (grid styling)

**Files:**
- Modify: `packages/web/src/hooks/use-chart-theme.ts`

- [ ] **Step 1: Update grid configuration in toLightweightTheme**

In `packages/web/src/hooks/use-chart-theme.ts`, replace the grid section (lines 26-29):

```typescript
/* OLD */
grid: {
  vertLines: { color: theme.gridColor, style: 1 },
  horzLines: { color: theme.gridColor, style: 1 },
},
```

```typescript
/* NEW */
grid: {
  vertLines: { visible: false },
  horzLines: { color: theme.gridColor, style: 3 },
},
```

Note: `style: 3` is `LineStyle.SparseDotted` in lightweight-charts.

- [ ] **Step 2: Reduce grid opacity**

The grid color comes from `resolveCssVar('--qv-border')`. Since lightweight-charts doesn't have a separate opacity prop for grid lines, we need to apply alpha to the grid color. Import `withAlpha` and apply it.

Add import at top of file:
```typescript
import { withAlpha } from '@/lib/chart-types';
```

In the `useChartTheme` hook, change how `gridColor` is computed. Replace (line 64):
```typescript
/* OLD */
gridColor: border,
```
```typescript
/* NEW */
gridColor: withAlpha(border, 0.15),
```

The `gridOpacity` field in the `ChartTheme` interface is no longer needed (alpha baked into color), but leave it for backward compat — it won't cause issues.

- [ ] **Step 3: Verify build**

```bash
cd /c/quovibe && pnpm build --filter @quovibe/web
```

- [ ] **Step 4: Commit**

```bash
cd /c/quovibe && git add packages/web/src/hooks/use-chart-theme.ts && git commit -m "style: dotted horizontal grid at 15% opacity, hide vertical lines"
```

---

### Task 2: Update series factory (line width + fill opacity)

**Files:**
- Modify: `packages/web/src/lib/chart-series-factory.ts`

- [ ] **Step 1: Increase line width**

In `packages/web/src/lib/chart-series-factory.ts`, replace `COMMON_OPTIONS` (lines 24-28):

```typescript
/* OLD */
const COMMON_OPTIONS = {
  lineWidth: 2,
  lastValueVisible: false,
  priceLineVisible: false,
} as const;
```

```typescript
/* NEW */
const COMMON_OPTIONS = {
  lineWidth: 2.5,
  lastValueVisible: false,
  priceLineVisible: false,
} as const;
```

- [ ] **Step 2: Increase area fill opacity**

In the `area` case (lines 58-68), replace:
```typescript
/* OLD */
topColor: withAlpha(color, 0.25),
```
```typescript
/* NEW */
topColor: withAlpha(color, 0.35),
```

- [ ] **Step 3: Increase baseline fill opacity**

In the `baseline` case (lines 70-84), replace:
```typescript
/* OLD */
topFillColor1: withAlpha(input.profitColor ?? color, 0.19),
```
```typescript
/* NEW */
topFillColor1: withAlpha(input.profitColor ?? color, 0.25),
```

And:
```typescript
/* OLD */
bottomFillColor2: withAlpha(input.lossColor ?? color, 0.19),
```
```typescript
/* NEW */
bottomFillColor2: withAlpha(input.lossColor ?? color, 0.25),
```

- [ ] **Step 4: Verify build**

```bash
cd /c/quovibe && pnpm build --filter @quovibe/web
```

- [ ] **Step 5: Commit**

```bash
cd /c/quovibe && git add packages/web/src/lib/chart-series-factory.ts && git commit -m "style: thicker chart lines (2.5px) and stronger fill gradients"
```

---

### Task 3: Performance chart — portfolio series to BaselineSeries

**Files:**
- Modify: `packages/web/src/pages/PerformanceChart.tsx`

The portfolio default series currently switches between `AreaSeries` and `LineSeries` based on the `areaFill` config flag. We change it to always use `BaselineSeries` when `areaFill` is true (instead of `AreaSeries`), providing the zero-crossing gradient.

- [ ] **Step 1: Add BaselineSeries import**

In `packages/web/src/pages/PerformanceChart.tsx`, update the import from `lightweight-charts` (line 6):

```typescript
/* OLD */
import {
  LineSeries, AreaSeries,
  LineStyle as LwcLineStyle,
  PriceScaleMode,
  type ISeriesApi, type SeriesType,
} from 'lightweight-charts';
```

```typescript
/* NEW */
import {
  LineSeries, AreaSeries, BaselineSeries,
  LineStyle as LwcLineStyle,
  PriceScaleMode,
  type ISeriesApi, type SeriesType,
} from 'lightweight-charts';
```

- [ ] **Step 2: Get loss color from useChartColors**

Find where `useChartColors` is called (line 50):
```typescript
/* OLD */
const { dividend, palette } = useChartColors();
```
```typescript
/* NEW */
const { dividend, palette, loss } = useChartColors();
```

- [ ] **Step 3: Change portfolio series construction**

Replace the portfolio series construction block (approximately lines 320-328):

```typescript
/* OLD */
const portfolioType = portfolioAreaFill ? 'area' as const : 'line' as const;
const { options: portfolioOptions } = buildSeriesOptions(portfolioType, {
  color: portfolioColor,
  lineStyle: toLwcLineStyle(portfolioLineStyle),
  priceScaleId: 'right',
  visible: portfolioVisible,
});
const PortfolioConstructor = portfolioAreaFill ? AreaSeries : LineSeries;
const portfolioSeries = chart.addSeries(PortfolioConstructor, portfolioOptions);
```

```typescript
/* NEW */
const portfolioType = portfolioAreaFill ? 'baseline' as const : 'line' as const;
const { options: portfolioOptions } = buildSeriesOptions(portfolioType, {
  color: portfolioColor,
  profitColor: portfolioColor,
  lossColor: loss,
  basePrice: 0,
  lineStyle: toLwcLineStyle(portfolioLineStyle),
  priceScaleId: 'right',
  visible: portfolioVisible,
});
const PortfolioConstructor = portfolioAreaFill ? BaselineSeries : LineSeries;
const portfolioSeries = chart.addSeries(PortfolioConstructor, portfolioOptions);
```

- [ ] **Step 4: Update the useEffect dependency array**

The effect that builds the chart (find the `useEffect` that contains the series construction, starts around line 285) likely has `dividend` and `palette` in its dependency array. Add `loss` to it.

Search for the closing of this useEffect to find the dependency array. It should look something like:
```typescript
}, [chart, ready, chartSeries, displayData, ...]);
```

Add `loss` to the dependency array if not already present.

- [ ] **Step 5: Also update comparison series for area fill**

The comparison series (additional securities/benchmarks, lines ~357-365) also switch between AreaSeries and LineSeries. When `areaFill` is true, change them to also use baseline for consistency:

```typescript
/* OLD */
const rsType = rs.config.areaFill ? 'area' as const : 'line' as const;
const { options: rsOptions } = buildSeriesOptions(rsType, {
  color,
  lineStyle,
  priceScaleId: 'right',
  visible: isVisible,
});
const RsConstructor = rs.config.areaFill ? AreaSeries : LineSeries;
```

```typescript
/* NEW */
const rsType = rs.config.areaFill ? 'baseline' as const : 'line' as const;
const { options: rsOptions } = buildSeriesOptions(rsType, {
  color,
  profitColor: color,
  lossColor: loss,
  basePrice: 0,
  lineStyle,
  priceScaleId: 'right',
  visible: isVisible,
});
const RsConstructor = rs.config.areaFill ? BaselineSeries : LineSeries;
```

- [ ] **Step 6: Verify build**

```bash
cd /c/quovibe && pnpm build --filter @quovibe/web
```

- [ ] **Step 7: Commit**

```bash
cd /c/quovibe && git add packages/web/src/pages/PerformanceChart.tsx && git commit -m "feat: zero-crossing gradient fill for performance chart series"
```

---

### Task 4: Widget perf chart — TTWROR modes to baseline

**Files:**
- Modify: `packages/web/src/components/domain/widgets/WidgetPerfChart.tsx`

The widget already has `BaselineSeries` imported and the factory supports it. The widget uses a `chartType` state (default `'area'`). For TTWROR modes, we want to default to `'baseline'` instead.

- [ ] **Step 1: Change default chart type based on metric mode**

The widget currently initializes `chartType` from localStorage or defaults to `'area'` (line 36-38):

```typescript
/* OLD */
const [chartType, setChartType] = useState<ChartSeriesType>(
  () => getSavedChartType(CHART_ID) ?? 'area',
);
```

This default should be `'baseline'` since the widget shows TTWROR by default (or MV). The saved preference still overrides. Change to:

```typescript
/* NEW */
const [chartType, setChartType] = useState<ChartSeriesType>(
  () => getSavedChartType(CHART_ID) ?? 'baseline',
);
```

This means the zero-crossing fill is the default look. Users who prefer area or line can still switch via the chart toolbar and their preference persists to localStorage.

- [ ] **Step 2: Verify the factory call already handles baseline correctly**

Look at lines 96-103. The widget already passes `profitColor`, `lossColor`, and `basePrice` to `buildSeriesOptions`. The `basePrice` is `0` for percentage modes and first data value for MV. This is already correct — no changes needed here.

Confirm by reading the code:
```typescript
const basePrice = isPercentage ? 0 : (seriesData.length > 0 ? seriesData[0].value : 0);
const { seriesType, options } = buildSeriesOptions(chartType, {
  color: profit,
  basePrice,
  profitColor: profit,
  lossColor: loss,
  priceScaleId: 'right',
});
```

This already works for baseline type. The only change is the default `chartType`.

- [ ] **Step 3: Verify build**

```bash
cd /c/quovibe && pnpm build --filter @quovibe/web
```

- [ ] **Step 4: Commit**

```bash
cd /c/quovibe && git add packages/web/src/components/domain/widgets/WidgetPerfChart.tsx && git commit -m "style: default widget perf chart to baseline for zero-crossing fill"
```

---

### Task 5: Build + lint verification

- [ ] **Step 1: Full build**

```bash
cd /c/quovibe && pnpm build
```

Expected: web, shared, engine pass. api failure is pre-existing.

- [ ] **Step 2: Lint**

```bash
cd /c/quovibe && pnpm lint
```

Expected: No new errors from our changes.

- [ ] **Step 3: Tests**

```bash
cd /c/quovibe && pnpm test
```

Expected: All pass. The chart-series-factory may have tests — verify they still pass with the new values.

- [ ] **Step 4: Commit fixes if needed**

```bash
cd /c/quovibe && git add -A && git commit -m "fix: address lint/test issues from chart polish"
```
