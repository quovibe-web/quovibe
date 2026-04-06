# Lightweight Charts Migration Design

**Date:** 2026-04-06
**Status:** Approved
**Scope:** Migrate time-series charts from Recharts to TradingView Lightweight Charts

## Overview

Replace all time-series chart rendering (7 components) with TradingView Lightweight Charts for better performance (Canvas vs SVG), professional financial chart aesthetics (crosshair, price scale, time scale), and native features (markers, multi-pane, real-time updates). Keep Recharts only for PieChart/Treemap. Build a custom `<Sparkline>` component for miniature charts.

## Decisions Log

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Non-time-series charts (Pie, Treemap) | Keep on Recharts | No native equivalent in Lightweight Charts |
| Sparklines (Movers, Benchmark, Instrument) | Custom `<Sparkline>` canvas component | Lightweight Charts too heavy for 28-32px charts; ~30 lines, zero deps |
| PriceChart enhancements | Native markers + transaction hover tooltip + OHLC candlestick | Direct upgrade from ReferenceDot approach |
| Chart type switching | On all migrated charts via `<ChartToolbar>` | Line/Area/Baseline/Histogram always; Candlestick/Bar when OHLC available |
| Interactive legend (PerformanceChart) | Custom React overlay with all current features | Lightweight Charts has no built-in legend |
| Export | Keep `html-to-image` | Captures chart + legend + overlays with watermark |
| Real-time updates | React Query polling (refetchInterval ~60s) + `series.update()` | No backend changes needed; sufficient for portfolio tracker |
| OHLC data | Add `open` column to price/latest_price tables | Unlocks candlestick chart type; Yahoo Finance already returns open |

## Architecture

### Approach: Parallel Tracks (Track 1 → Track 2)

**Track 1 — Foundation + Simple Charts:**
Install library → shared hooks/components → WidgetDrawdownChart → WidgetPerfChart → Sparkline replacements

**Track 2 — Complex Charts (after Track 1 hook is stable):**
PriceChart (with markers + OHLC) → TaxonomySeries → Payments → PerformanceChart (with custom legend)

**Cross-cutting:** DB schema change (`open` column) + Yahoo Finance update lands early so OHLC data accumulates.

## Shared Infrastructure

### `useLightweightChart` Hook

Manages chart lifecycle — create, destroy, resize, theme switching.

```typescript
const { chartRef, containerRef, addSeries, removeSeries } = useLightweightChart({
  options?: DeepPartial<ChartOptions>,
  autoResize?: boolean,  // default true
})
```

Responsibilities:
- Creates chart instance on mount, calls `chart.remove()` on unmount
- Reads `useTheme()` and `useChartColors()` to apply CSS vars to chart background, grid, text, crosshair
- Handles dark/light mode transitions via `chart.applyOptions()` on theme change
- Attaches `ResizeObserver` for responsive sizing (autoResize)
- Returns `containerRef` (attach to a div) and `chartRef` (raw IChartApi access)

### `<ChartToolbar>` Component

Floating toolbar overlaid top-right of the chart container. Shows available chart type icons:

- **OHLC data available:** Line | Area | Candlestick | Bar | Baseline | Histogram
- **Single value data:** Line | Area | Baseline | Histogram

Calls `onChartTypeChange(type)` — parent handles series swap. User preference persisted per-chart via `localStorage`.

### `<ChartLegendOverlay>` Component

HTML div positioned absolutely over the chart. Base version for all charts:

- Subscribes to `chart.subscribeCrosshairMove()`
- Shows series name + current value on crosshair hover
- Visibility toggle per series (eye icon)
- Uses existing color palette from `useChartColors()`

Extended version for PerformanceChart adds:
- Color picker
- Drag-to-reorder
- Line style cycling (solid/dashed/dotted)
- Area fill toggle
- Remove series

### `<Sparkline>` Component

Minimal `<canvas>` element, ~30-40 lines, zero dependencies.

```typescript
<Sparkline
  data={number[]}
  width={number}
  height={number}       // 28-32px
  color={string}
  fillOpacity?: number  // 0 = line only, 0.1-0.3 = area fill
/>
```

No axes, no interaction, no price scales. Draws a polyline on a canvas.

## Database & Backend Changes

### Schema Change

Add nullable `open` column to both price tables:

```sql
ALTER TABLE price ADD COLUMN open INTEGER;
ALTER TABLE latest_price ADD COLUMN open INTEGER;
```

Drizzle schema update:
```typescript
open: integer('open'),  // alongside existing high/low
```

Existing rows keep `open = null`. Frontend disables candlestick option when open is missing.

### Yahoo Finance Update

The quote-fetching service already receives OHLC from `yf.chart()`. Add extraction and storage of `open` value. Same for `yf.quote()` writing to `latest_price`.

### API Response

Price endpoints include `open` when available. Service layer divides by `1e8` per existing convention.

```json
{ "date": "2026-04-04", "open": 150.00, "close": 150.25, "high": 151.00, "low": 149.80 }
```

### Real-Time Polling

No backend changes. Frontend uses React Query `refetchInterval` (~60s). On new data, chart calls `series.update(latestPoint)` for efficient single-point update.

## Chart Migrations

### Simple Charts (Track 1)

#### WidgetDrawdownChart
- Single Area series (drawdown %, always <= 0)
- `<ChartToolbar>` with single-value options
- Privacy blur on container div

#### WidgetPerfChart
- Dual Y-axes: Area series for MV (right scale), Line series for TTWROR % (left scale, `priceScaleId: 'left'`)
- `<ChartLegendOverlay>` showing both values on crosshair
- `<ChartToolbar>` — type switching on primary (MV) series
- Cumulative/annualized toggle stays as React button

#### Sparkline Replacements
- **WidgetMovers:** 6+ `ComposedChart` → `<Sparkline height={32} color={gainOrLossColor} />`
- **WidgetBenchmarkComparison:** `AreaChart` → `<Sparkline>` + zero-line CSS border
- **InstrumentDetail:** `LineChart` → `<Sparkline>` for 90-day preview

### Complex Charts (Track 2)

#### PriceChart (Enhanced)
- Default: Line series (close prices). Toolbar unlocks Candlestick/Bar when OHLC available
- Native markers via `createSeriesMarkers()`:
  - BUY: green circle, `belowBar`
  - SELL: red circle, `aboveBar`
  - DIVIDEND: violet circle, `belowBar`
- Click handler on markers shows floating tooltip with transaction details (date, type, shares, amount, fees)
- Volume pane (`paneIndex: 1`) with histogram series — volume data exists in the `price` and `latest_price` tables
- Real-time update via `series.update()`

#### TaxonomySeries
- Mode toggle (MV/TTWROR) switches between Area and Line series
- Multiple series per category (each taxonomy slice colored)
- `<ChartToolbar>` + `<ChartLegendOverlay>` with category names

#### Payments
- Two chart instances (dividends + interest), same layout as current
- Histogram series for bars
- Gross/net toggle swaps histogram data
- Period grouping (month/quarter/year) via React buttons → `series.setData()`
- `<ChartToolbar>` allows switching to Line/Area for trend view

#### PerformanceChart (Most Complex)
- **Main pane (0):** Multiple series — portfolio line/area, securities, benchmarks (dashed via `lineStyle: LineStyle.Dashed`)
- **Bar pane (1):** Periodic returns as histogram, separate pane, synced time axis
- **Dual Y-axes:** MV right scale, TTWROR % left scale
- **Extended `<ChartLegendOverlay>`:**
  - Visibility toggle → `series.applyOptions({ visible: false })`
  - Color picker → `series.applyOptions({ color: newColor })`
  - Line style cycle → `series.applyOptions({ lineStyle: ... })`
  - Area fill toggle → remove/re-add series as Area or Line type
  - Drag-to-reorder → reorder legend items, adjust z-index via remove/re-add
  - Remove series → `chart.removeSeries()`
- Config persistence via existing `useChartConfig` / `useSaveChartConfig` hooks (unchanged)
- Real-time update on latest data

## Migration Strategy

### Coexistence

Both libraries coexist during migration. Each chart is migrated as a complete replacement — old Recharts code deleted when new version is done.

### Shared Component Fate

| Component | Fate |
|-----------|------|
| `ChartTooltip.tsx` | **Delete** — replaced by `ChartLegendOverlay` |
| `ChartLegend.tsx` | **Delete** — replaced by `ChartLegendOverlay` |
| `InteractiveChartLegend.tsx` | **Delete** — replaced by extended `ChartLegendOverlay` |
| `ChartExportButton.tsx` | **Keep** — `html-to-image` works on any container |
| `useChartColors.ts` | **Keep** — feeds colors to both libraries |
| `useChartTheme.ts` | **Adapt** — map to Lightweight Charts options |
| `useChartTicks.ts` | **Delete** — Lightweight Charts handles time axis natively |

### Bundle Impact

- Lightweight Charts: ~45KB gzipped
- Recharts remains for PieChart/Treemap only — significant tree-shaking (drop CartesianGrid, XAxis, YAxis, Line, Area, Bar, ComposedChart imports)
- Net bundle size improvement expected

### Charts Staying on Recharts

- `TaxonomyChart.tsx` — PieChart (donut) + Treemap. No Lightweight Charts equivalent. Permanent.

### Testing

- Each migrated chart: visual smoke test on dev server
- React Query hooks and data flow unchanged — only rendering layer changes
- `useChartConfig` persistence unchanged — saved configs still work
- Privacy mode blur: CSS filter on container div (same mechanism)
- Real-time polling: verify `series.update()` produces smooth single-point updates without full re-render
