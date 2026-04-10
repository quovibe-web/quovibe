# Chart Canvas Polish: Zero-Crossing Gradient + Grid + Line Weight

**Date:** 2026-04-07
**Status:** Approved
**Scope:** Lightweight-charts configuration changes — theme hook, series factory, performance chart series type. No new components, no layout changes.

## Goal

Polish the chart canvas rendering: zero-crossing gradient fill on performance charts (green above zero, red below), subtle dotted horizontal grid, thicker series lines. Pure configuration changes to the existing lightweight-charts integration.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Area fill | Zero-crossing via BaselineSeries | Most impactful visual technique for finance charts |
| Grid | Dotted horizontal only, 15% opacity | Modern finance standard (Bloomberg, TradingView Pro) |
| Line width | 2.5px (was 2px) | More substantial data lines against clean grid |
| Background | Keep transparent | Warm palette + fills are enough, avoid overdesign |

## 1. Chart Theme Updates

**File:** `packages/web/src/hooks/use-chart-theme.ts`

### Grid Changes

| Property | Current | New |
|----------|---------|-----|
| `grid.vertLines.visible` | `true` (implicit) | `false` |
| `grid.horzLines.style` | `1` (solid) | `3` (dotted) — `LineStyle.SparseDotted` |
| `grid.horzLines` opacity | `0.5` via color alpha | `0.15` via color alpha |

The grid color source stays the same (`--qv-border` CSS var). Only the alpha and style change.

### Everything Else Unchanged

Crosshair style, axis colors, border colors, text colors, font — all stay as-is. They already use warm palette CSS vars from the design foundation work.

## 2. Series Factory Updates

**File:** `packages/web/src/lib/chart-series-factory.ts`

### Line Width

All series types that have `lineWidth` in their defaults change from `2` to `2.5`:
- `createLineOptions`
- `createAreaOptions`
- `createBaselineOptions`

### Area Series Fill

`createAreaOptions` — increase `topColor` alpha from `0.25` to `0.35` for a stronger gradient. `bottomColor` stays transparent.

### Baseline Series Defaults

`createBaselineOptions` — ensure the defaults use profit/loss colors for the zero-crossing fill:

```typescript
{
  lineWidth: 2.5,
  topLineColor: color,          // series color (or profit color when used for perf)
  bottomLineColor: lossColor,   // loss color
  topFillColor1: withAlpha(color, 0.25),
  topFillColor2: 'transparent',
  bottomFillColor1: 'transparent',
  bottomFillColor2: withAlpha(lossColor, 0.25),
  baseValue: { type: 'price', price: 0 },
}
```

The `lossColor` parameter needs to be passed to the factory. Add an optional `lossColor` parameter to the baseline factory function.

## 3. Performance Chart Integration

**File:** `packages/web/src/pages/PerformanceChart.tsx`

### Portfolio Series: Area → Baseline

The portfolio TTWROR series currently creates an `AreaSeries`. Change to `BaselineSeries`:

- Series type: `addSeries(BaselineSeries, options)` instead of `addSeries(AreaSeries, options)`
- Options: use `createBaselineOptions(color, { lossColor })` with `baseValue: { type: 'price', price: 0 }`
- The `color` is the portfolio series color (from chart config)
- The `lossColor` comes from `useChartColors()` → `loss` field

### Comparison Series Unchanged

Additional series (securities, benchmarks) stay as `LineSeries`. Only the primary portfolio series gets the zero-crossing treatment. This is because comparison series overlap and baseline fills would create visual clutter.

### Mode-Specific Behavior

- **Cumulative TTWROR mode:** Baseline series with `baseValue: 0` — zero-crossing gradient active
- **Annualized TTWROR (p.a.) mode:** Same baseline series, same `baseValue: 0` — works the same since annualized values also cross zero
- Both modes benefit from the zero-crossing fill because returns can be positive or negative

## 4. Widget Chart Updates

### WidgetPerfChart.tsx

**File:** `packages/web/src/components/domain/widgets/WidgetPerfChart.tsx`

- **TTWROR Cumulative mode:** Switch from `AreaSeries` to `BaselineSeries` with zero-crossing colors
- **TTWROR p.a. mode:** Same baseline treatment
- **Market Value mode:** Keep as `AreaSeries` — market value doesn't cross zero, baseline would be meaningless
- Line width inherits from factory (now 2.5px)

### WidgetDrawdownChart.tsx

**File:** `packages/web/src/components/domain/widgets/WidgetDrawdownChart.tsx`

- Already uses baseline-like styling with danger colors
- Just ensure line width is 2.5px (via factory update)
- No other changes needed

## 5. Files Changed

| File | Change |
|------|--------|
| `packages/web/src/hooks/use-chart-theme.ts` | Grid: hide vertical, dotted horizontal at 15% opacity |
| `packages/web/src/lib/chart-series-factory.ts` | Line width 2→2.5, area alpha 0.25→0.35, baseline lossColor param |
| `packages/web/src/pages/PerformanceChart.tsx` | Portfolio series: AreaSeries → BaselineSeries |
| `packages/web/src/components/domain/widgets/WidgetPerfChart.tsx` | TTWROR modes: AreaSeries → BaselineSeries |
| `packages/web/src/components/domain/widgets/WidgetDrawdownChart.tsx` | Verify line width update (via factory) |

## 6. What This Does NOT Change

- Chart page layout (legend, header, controls, spacing)
- Crosshair behavior
- Export functionality
- Data series picker
- PriceChart component (security detail page charts)
- Legend overlay components
- Any React component structure — this is purely canvas configuration
