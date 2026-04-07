# Lightweight Charts Migration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate all time-series charts from Recharts to TradingView Lightweight Charts v5, add OHLC candlestick support, chart type switching, and real-time polling.

**Architecture:** Two parallel tracks. Track 1 builds shared infrastructure (hook, toolbar, legend, sparkline) and migrates simple widget charts. Track 2 migrates complex charts (PriceChart, TaxonomySeries, Payments, PerformanceChart). A cross-cutting DB schema change adds the `open` column early so OHLC data accumulates during development.

**Tech Stack:** lightweight-charts 5.1, React 19, TypeScript 5.9, TanStack Query 5, Tailwind 4, shadcn/ui, date-fns, @dnd-kit (existing, for legend drag-reorder)

**Spec:** `docs/superpowers/specs/2026-04-06-lightweight-charts-migration-design.md`

---

## File Structure

### New Files (packages/web)
| File | Responsibility |
|------|---------------|
| `src/hooks/use-lightweight-chart.ts` | Chart lifecycle hook (create, destroy, resize, theme) |
| `src/components/shared/ChartToolbar.tsx` | Floating chart type switcher overlay |
| `src/components/shared/ChartLegendOverlay.tsx` | Crosshair-driven legend overlay (base + extended) |
| `src/components/shared/Sparkline.tsx` | Zero-dependency canvas sparkline |
| `src/lib/chart-types.ts` | Chart type enum, series factory, localStorage helpers |

### Modified Files (packages/web)
| File | Change |
|------|--------|
| `src/hooks/use-chart-theme.ts` | Add `toLightweightOptions()` mapper |
| `src/components/domain/widgets/WidgetDrawdownChart.tsx` | Full rewrite: Recharts → Lightweight Charts |
| `src/components/domain/widgets/WidgetPerfChart.tsx` | Full rewrite: Recharts → Lightweight Charts |
| `src/components/domain/widgets/WidgetMovers.tsx` | Replace inline Recharts sparkline with `<Sparkline>` |
| `src/components/domain/widgets/WidgetBenchmarkComparison.tsx` | Replace AreaChart with `<Sparkline>` |
| `src/components/domain/AddInstrumentDialog/InstrumentDetail.tsx` | Replace LineChart with `<Sparkline>` |
| `src/components/domain/PriceChart.tsx` | Full rewrite with OHLC + markers |
| `src/pages/TaxonomySeries.tsx` | Full rewrite: ComposedChart → Lightweight Charts |
| `src/pages/Payments.tsx` | Full rewrite: BarChart → Lightweight Charts histogram |
| `src/pages/PerformanceChart.tsx` | Full rewrite with multi-pane + extended legend |
| `src/components/shared/ChartExportButton.tsx` | Update tooltip filter class name |

### Modified Files (packages/api)
| File | Change |
|------|--------|
| `src/db/schema.ts` | Add `open` column to `prices` and `latestPrices` |
| `src/providers/types.ts` | Add `open` to `FetchedPrice` and `LatestQuote` |
| `src/providers/yahoo.provider.ts` | Extract and return `open` from Yahoo response |
| `src/services/unit-conversion.ts` | Add `open` to `DbPriceRow`, `ConvertedPrice`, `DbPriceWrite`, converters |
| `src/services/prices.service.ts` | Store `open` in INSERT statements |
| `src/routes/securities.ts` | Return `open`, `high`, `low`, `volume` in price response |

### Deleted Files (after all migrations complete)
| File | Reason |
|------|--------|
| `src/components/shared/ChartTooltip.tsx` | Replaced by `ChartLegendOverlay` |
| `src/components/shared/ChartLegend.tsx` | Replaced by `ChartLegendOverlay` |
| `src/components/shared/InteractiveChartLegend.tsx` | Replaced by extended `ChartLegendOverlay` |
| `src/hooks/use-chart-ticks.ts` | Lightweight Charts handles time axis natively |

---

## Task 0: Install Lightweight Charts

**Files:**
- Modify: `packages/web/package.json`

- [ ] **Step 1: Install the package**

Run: `pnpm add lightweight-charts@^5.1.0 --filter @quovibe/web`

- [ ] **Step 2: Verify installation**

Run: `pnpm build --filter @quovibe/web`
Expected: Build succeeds with no errors

- [ ] **Step 3: Commit**

```bash
git add packages/web/package.json pnpm-lock.yaml
git commit -m "chore: add lightweight-charts 5.1 dependency"
```

---

## Task 1: DB Schema — Add `open` Column

**Files:**
- Modify: `packages/api/src/db/schema.ts:90-108`
- Modify: `packages/api/src/providers/types.ts:3-9,16-19`
- Modify: `packages/api/src/services/unit-conversion.ts:22-26,33-37,52-58,67-71,87-102`
- Modify: `packages/api/src/providers/yahoo.provider.ts:32-41,43-59`
- Modify: `packages/api/src/services/prices.service.ts:69-86,103-107,130-139`
- Modify: `packages/api/src/routes/securities.ts:163-166`
- Test: `packages/api/src/services/__tests__/unit-conversion.test.ts`

- [ ] **Step 1: Write failing test for `open` in unit conversion**

Add to `packages/api/src/services/__tests__/unit-conversion.test.ts`:

```typescript
it('convertPriceFromDb includes open when present', () => {
  const result = convertPriceFromDb({ close: 1e8, high: 1.2e8, low: 0.8e8, open: 1.1e8 });
  expect(result.open).not.toBeNull();
  expect(result.open!.toNumber()).toBeCloseTo(1.1);
});

it('convertPriceFromDb returns null open when absent', () => {
  const result = convertPriceFromDb({ close: 1e8 });
  expect(result.open).toBeNull();
});

it('convertPriceToDb includes open when present', () => {
  const result = convertPriceToDb({ close: new Decimal('1'), open: new Decimal('1.1') });
  expect(result.open).toBe(110000000);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test --filter @quovibe/api -- unit-conversion`
Expected: FAIL — `open` not on types

- [ ] **Step 3: Update `DbPriceRow` and `ConvertedPrice` types**

In `packages/api/src/services/unit-conversion.ts`, update:

```typescript
export interface DbPriceRow {
  close: number;
  high?: number | null;
  low?: number | null;
  open?: number | null;
}

export interface ConvertedPrice {
  close: Decimal;
  high: Decimal | null;
  low: Decimal | null;
  open: Decimal | null;
}

export interface DbPriceWrite {
  close: number;
  high?: number;
  low?: number;
  open?: number;
}
```

- [ ] **Step 4: Update `convertPriceFromDb`**

```typescript
export function convertPriceFromDb(row: DbPriceRow): ConvertedPrice {
  return {
    close: safeDecimal(row.close).div(1e8),
    high: row.high != null ? safeDecimal(row.high).div(1e8) : null,
    low: row.low != null ? safeDecimal(row.low).div(1e8) : null,
    open: row.open != null ? safeDecimal(row.open).div(1e8) : null,
  };
}
```

- [ ] **Step 5: Update `convertPriceToDb`**

```typescript
export function convertPriceToDb(values: {
  close: Decimal;
  high?: Decimal;
  low?: Decimal;
  open?: Decimal;
}): DbPriceWrite {
  const result: DbPriceWrite = {
    close: Math.round(parseFloat(values.close.times(1e8).toPrecision(15))),
  };
  if (values.high != null) {
    result.high = Math.round(parseFloat(values.high.times(1e8).toPrecision(15)));
  }
  if (values.low != null) {
    result.low = Math.round(parseFloat(values.low.times(1e8).toPrecision(15)));
  }
  if (values.open != null) {
    result.open = Math.round(parseFloat(values.open.times(1e8).toPrecision(15)));
  }
  return result;
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm test --filter @quovibe/api -- unit-conversion`
Expected: PASS

- [ ] **Step 7: Update `FetchedPrice` and `LatestQuote` types**

In `packages/api/src/providers/types.ts`:

```typescript
export interface FetchedPrice {
  date: string;       // YYYY-MM-DD
  close: Decimal;
  open?: Decimal;
  high?: Decimal;
  low?: Decimal;
  volume?: number;
}

export interface LatestQuote {
  price: Decimal;
  date: string;       // YYYY-MM-DD
  open?: Decimal;
  high?: Decimal;
  low?: Decimal;
}
```

- [ ] **Step 8: Update Yahoo provider to extract `open`**

In `packages/api/src/providers/yahoo.provider.ts`, update the `fetchPricesFromYahoo` map:

```typescript
  return result.quotes
    .filter((r: { close: number | null }) => r.close != null)
    .map((r: { date: Date; open: number | null; close: number; high: number | null; low: number | null; volume: number | null }) => ({
      date: toYMD(r.date),
      close: safeDecimal(r.close),
      open: r.open != null ? safeDecimal(r.open) : undefined,
      high: r.high != null ? safeDecimal(r.high) : undefined,
      low: r.low != null ? safeDecimal(r.low) : undefined,
      volume: r.volume ?? undefined,
    }));
```

Update `fetchLatestQuote` to also capture open/high/low:

```typescript
async function fetchLatestQuote(ticker: string): Promise<LatestQuote | null> {
  try {
    const mod = require('yahoo-finance2');
    const YahooFinance = mod.default ?? mod;
    const yf = new YahooFinance();
    const result = await yf.quote(ticker);
    if (result?.regularMarketPrice == null) return null;
    const price = safeDecimal(result.regularMarketPrice);
    const rawTime = result.regularMarketTime;
    const date = rawTime instanceof Date ? toYMD(rawTime) : toYMD(new Date());
    return {
      price,
      date,
      open: result.regularMarketOpen != null ? safeDecimal(result.regularMarketOpen) : undefined,
      high: result.regularMarketDayHigh != null ? safeDecimal(result.regularMarketDayHigh) : undefined,
      low: result.regularMarketDayLow != null ? safeDecimal(result.regularMarketDayLow) : undefined,
    };
  } catch {
    return null;
  }
}
```

- [ ] **Step 9: Update Drizzle schema**

In `packages/api/src/db/schema.ts`, add `open` to both tables:

For `prices` (after line 95 `low`):
```typescript
  open: integer('open'),
```

For `latestPrices` (after line 106 `low`):
```typescript
  open: integer('open'),
```

- [ ] **Step 10: Update `savePricesToDb` in prices.service.ts**

Update the `insertPrice` statement and the insert call:

```typescript
  const insertPrice = sqlite.prepare(`
    INSERT INTO price (security, tstamp, value, high, low, volume, open) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(security, tstamp) DO UPDATE SET value = excluded.value,
        high = excluded.high, low = excluded.low, volume = excluded.volume, open = excluded.open
  `);
```

Update the insert loop:

```typescript
    for (const p of sorted) {
      const dbPrice = convertPriceToDb({
        close: p.close,
        ...(p.open != null ? { open: p.open } : {}),
        ...(p.high != null ? { high: p.high } : {}),
        ...(p.low != null ? { low: p.low } : {}),
      });
      insertPrice.run(
        securityId, p.date, dbPrice.close,
        dbPrice.high ?? null, dbPrice.low ?? null, p.volume ?? null, dbPrice.open ?? null,
      );
    }
```

- [ ] **Step 11: Update `writeLatestQuote` to store open/high/low**

```typescript
function writeLatestQuote(
  sqlite: BetterSqlite3.Database,
  securityId: string,
  quote: LatestQuote,
  securityName: string,
): boolean {
  try {
    const dbOpen = quote.open != null ? convertPriceToDb({ close: quote.open }).close : null;
    const dbHigh = quote.high != null ? convertPriceToDb({ close: quote.high }).close : null;
    const dbLow = quote.low != null ? convertPriceToDb({ close: quote.low }).close : null;
    sqlite
      .prepare(`INSERT INTO latest_price (security, tstamp, value, open, high, low) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(security) DO UPDATE SET tstamp = excluded.tstamp, value = excluded.value,
          open = excluded.open, high = excluded.high, low = excluded.low`)
      .run(securityId, quote.date, convertPriceToDb({ close: quote.price }).close, dbOpen, dbHigh, dbLow);
    console.log(`[prices] Latest quote for ${securityName}: ${quote.price} @ ${quote.date}`);
    return true;
  } catch (err) {
    console.warn(`[prices] Failed to write latest quote for ${securityName}:`, (err as Error).message);
    return false;
  }
}
```

- [ ] **Step 12: Update securities route to return OHLC data**

In `packages/api/src/routes/securities.ts`, update the price mapping (around line 163):

```typescript
  const allPrices = priceRows.map(p => {
    const converted = convertPriceFromDb({ close: p.close, high: p.high, low: p.low, open: p.open });
    return {
      date: p.date,
      value: converted.close.toString(),
      open: converted.open?.toString() ?? null,
      high: converted.high?.toString() ?? null,
      low: converted.low?.toString() ?? null,
      volume: p.volume ?? null,
    };
  });
```

- [ ] **Step 13: Run full test suite**

Run: `pnpm test --filter @quovibe/api`
Expected: All tests PASS

- [ ] **Step 14: Run the DB migration (add column)**

Create a migration script or document the ALTER TABLE commands. Since the project uses raw SQLite (ppxml2db), the columns need to be added manually on existing databases:

```sql
ALTER TABLE price ADD COLUMN open INTEGER;
ALTER TABLE latest_price ADD COLUMN open INTEGER;
```

Note: New databases created from Drizzle schema will automatically include the column. Existing databases need the ALTER TABLE.

- [ ] **Step 15: Build and verify**

Run: `pnpm build`
Expected: Full build succeeds

- [ ] **Step 16: Commit**

```bash
git add packages/api/src/db/schema.ts packages/api/src/providers/types.ts packages/api/src/providers/yahoo.provider.ts packages/api/src/services/unit-conversion.ts packages/api/src/services/prices.service.ts packages/api/src/routes/securities.ts packages/api/src/services/__tests__/unit-conversion.test.ts
git commit -m "feat: add OHLC open column to price tables and Yahoo provider"
```

---

## Task 2: Chart Type Definitions & Helpers

**Files:**
- Create: `packages/web/src/lib/chart-types.ts`

- [ ] **Step 1: Create the chart types module**

```typescript
// packages/web/src/lib/chart-types.ts

export type ChartSeriesType = 'line' | 'area' | 'candlestick' | 'bar' | 'baseline' | 'histogram';

/** Available chart types based on data shape */
export const SINGLE_VALUE_TYPES: ChartSeriesType[] = ['line', 'area', 'baseline', 'histogram'];
export const OHLC_TYPES: ChartSeriesType[] = ['line', 'area', 'candlestick', 'bar', 'baseline', 'histogram'];

/** Icons for each chart type (Lucide icon names) */
export const CHART_TYPE_ICONS: Record<ChartSeriesType, string> = {
  line: 'TrendingUp',
  area: 'AreaChart',
  candlestick: 'CandlestickChart',
  bar: 'BarChart3',
  baseline: 'GitCompareArrows',
  histogram: 'BarChart',
};

/** Labels for chart type selector (i18n keys) */
export const CHART_TYPE_LABELS: Record<ChartSeriesType, string> = {
  line: 'chartTypes.line',
  area: 'chartTypes.area',
  candlestick: 'chartTypes.candlestick',
  bar: 'chartTypes.bar',
  baseline: 'chartTypes.baseline',
  histogram: 'chartTypes.histogram',
};

const STORAGE_PREFIX = 'qv-chart-type-';

/** Read saved chart type for a specific chart instance */
export function getSavedChartType(chartId: string): ChartSeriesType | null {
  const saved = localStorage.getItem(`${STORAGE_PREFIX}${chartId}`);
  if (saved && (SINGLE_VALUE_TYPES.includes(saved as ChartSeriesType) || OHLC_TYPES.includes(saved as ChartSeriesType))) {
    return saved as ChartSeriesType;
  }
  return null;
}

/** Save chart type preference for a specific chart instance */
export function saveChartType(chartId: string, type: ChartSeriesType): void {
  localStorage.setItem(`${STORAGE_PREFIX}${chartId}`, type);
}
```

- [ ] **Step 2: Verify it compiles**

Run: `pnpm build --filter @quovibe/web`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/lib/chart-types.ts
git commit -m "feat: add chart type definitions and localStorage helpers"
```

---

## Task 3: `useLightweightChart` Hook

**Files:**
- Create: `packages/web/src/hooks/use-lightweight-chart.ts`
- Modify: `packages/web/src/hooks/use-chart-theme.ts`

- [ ] **Step 1: Add Lightweight Charts theme mapper to `use-chart-theme.ts`**

Add at the end of `packages/web/src/hooks/use-chart-theme.ts`:

```typescript
import type { DeepPartial, ChartOptions } from 'lightweight-charts';

/** Map quovibe theme to Lightweight Charts options */
export function toLightweightTheme(theme: ChartTheme): DeepPartial<ChartOptions> {
  return {
    layout: {
      background: { color: 'transparent' },
      textColor: theme.tickColor,
      fontFamily: 'inherit',
    },
    grid: {
      vertLines: { color: theme.gridColor, style: 1 },
      horzLines: { color: theme.gridColor, style: 1 },
    },
    crosshair: {
      vertLine: { color: theme.cursorColor, labelBackgroundColor: theme.cursorColor },
      horzLine: { color: theme.cursorColor, labelBackgroundColor: theme.cursorColor },
    },
    timeScale: {
      borderColor: theme.gridColor,
      timeVisible: false,
    },
    rightPriceScale: {
      borderColor: theme.gridColor,
    },
    leftPriceScale: {
      borderColor: theme.gridColor,
    },
  };
}
```

- [ ] **Step 2: Create the `useLightweightChart` hook**

```typescript
// packages/web/src/hooks/use-lightweight-chart.ts
import { useRef, useEffect, useCallback } from 'react';
import { createChart, type IChartApi, type DeepPartial, type ChartOptions } from 'lightweight-charts';
import { useTheme } from '@/hooks/use-theme';
import { useChartTheme, toLightweightTheme } from '@/hooks/use-chart-theme';

interface UseLightweightChartOptions {
  options?: DeepPartial<ChartOptions>;
  autoResize?: boolean;
}

interface UseLightweightChartReturn {
  containerRef: React.RefObject<HTMLDivElement | null>;
  chartRef: React.MutableRefObject<IChartApi | null>;
}

export function useLightweightChart(
  opts: UseLightweightChartOptions = {},
): UseLightweightChartReturn {
  const { options, autoResize = true } = opts;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const { resolvedTheme } = useTheme();
  const chartTheme = useChartTheme();

  // Create chart on mount
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const themeOptions = toLightweightTheme(chartTheme);
    const chart = createChart(container, {
      width: container.clientWidth,
      height: container.clientHeight,
      ...themeOptions,
      ...options,
    });
    chartRef.current = chart;

    // Auto-resize observer
    let observer: ResizeObserver | undefined;
    if (autoResize) {
      observer = new ResizeObserver((entries) => {
        const entry = entries[0];
        if (entry && chartRef.current) {
          const { width, height } = entry.contentRect;
          chartRef.current.resize(width, height);
        }
      });
      observer.observe(container);
    }

    return () => {
      observer?.disconnect();
      chart.remove();
      chartRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // mount-only — theme changes handled separately

  // Apply theme changes
  useEffect(() => {
    if (!chartRef.current) return;
    const themeOptions = toLightweightTheme(chartTheme);
    chartRef.current.applyOptions(themeOptions);
  }, [resolvedTheme, chartTheme]);

  return { containerRef, chartRef };
}
```

- [ ] **Step 3: Verify it compiles**

Run: `pnpm build --filter @quovibe/web`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/hooks/use-lightweight-chart.ts packages/web/src/hooks/use-chart-theme.ts
git commit -m "feat: add useLightweightChart hook with theme integration"
```

---

## Task 4: `<Sparkline>` Component

**Files:**
- Create: `packages/web/src/components/shared/Sparkline.tsx`

- [ ] **Step 1: Create the Sparkline component**

```typescript
// packages/web/src/components/shared/Sparkline.tsx
import { useRef, useEffect } from 'react';

interface SparklineProps {
  data: number[];
  width: number;
  height: number;
  color: string;
  fillOpacity?: number;
  className?: string;
}

export function Sparkline({ data, width, height, color, fillOpacity = 0, className }: SparklineProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || data.length < 2) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1; // native-ok
    canvas.width = width * dpr; // native-ok
    canvas.height = height * dpr; // native-ok
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height); // native-ok

    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min || 1;
    const padding = 1; // native-ok

    const xStep = (width - padding * 2) / (data.length - 1); // native-ok
    const yScale = (height - padding * 2) / range; // native-ok

    // Build path
    ctx.beginPath();
    for (let i = 0; i < data.length; i++) { // native-ok
      const x = padding + i * xStep; // native-ok
      const y = padding + (max - data[i]) * yScale; // native-ok
      if (i === 0) ctx.moveTo(x, y); // native-ok
      else ctx.lineTo(x, y);
    }

    // Fill area if requested
    if (fillOpacity > 0) {
      ctx.save();
      const lastX = padding + (data.length - 1) * xStep; // native-ok
      ctx.lineTo(lastX, height);
      ctx.lineTo(padding, height);
      ctx.closePath();
      ctx.globalAlpha = fillOpacity;
      ctx.fillStyle = color;
      ctx.fill();
      ctx.restore();

      // Redraw stroke path
      ctx.beginPath();
      for (let i = 0; i < data.length; i++) { // native-ok
        const x = padding + i * xStep; // native-ok
        const y = padding + (max - data[i]) * yScale; // native-ok
        if (i === 0) ctx.moveTo(x, y); // native-ok
        else ctx.lineTo(x, y);
      }
    }

    // Stroke
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';
    ctx.stroke();
  }, [data, width, height, color, fillOpacity]);

  if (data.length < 2) return null;

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      className={className}
      style={{ width, height }}
    />
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `pnpm build --filter @quovibe/web`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/shared/Sparkline.tsx
git commit -m "feat: add zero-dependency canvas Sparkline component"
```

---

## Task 5: `<ChartToolbar>` Component

**Files:**
- Create: `packages/web/src/components/shared/ChartToolbar.tsx`

Depends on: Task 2 (chart-types.ts)

- [ ] **Step 1: Create the ChartToolbar component**

```typescript
// packages/web/src/components/shared/ChartToolbar.tsx
import { useTranslation } from 'react-i18next';
import {
  TrendingUp, AreaChart, CandlestickChart, BarChart3, GitCompareArrows, BarChart,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  type ChartSeriesType, SINGLE_VALUE_TYPES, OHLC_TYPES,
  getSavedChartType, saveChartType,
} from '@/lib/chart-types';

const ICONS: Record<ChartSeriesType, React.ComponentType<{ className?: string }>> = {
  line: TrendingUp,
  area: AreaChart,
  candlestick: CandlestickChart,
  bar: BarChart3,
  baseline: GitCompareArrows,
  histogram: BarChart,
};

interface ChartToolbarProps {
  chartId: string;
  activeType: ChartSeriesType;
  hasOhlc: boolean;
  onTypeChange: (type: ChartSeriesType) => void;
  className?: string;
}

export function ChartToolbar({ chartId, activeType, hasOhlc, onTypeChange, className }: ChartToolbarProps) {
  const { t } = useTranslation('common');
  const types = hasOhlc ? OHLC_TYPES : SINGLE_VALUE_TYPES;

  const handleClick = (type: ChartSeriesType) => {
    saveChartType(chartId, type);
    onTypeChange(type);
  };

  return (
    <div className={cn(
      'absolute top-2 right-2 z-10 flex gap-0.5 rounded-md border bg-background/80 p-0.5 backdrop-blur-sm',
      'opacity-0 transition-opacity group-hover/chart:opacity-100',
      className,
    )}>
      {types.map((type) => {
        const Icon = ICONS[type];
        return (
          <button
            key={type}
            onClick={() => handleClick(type)}
            className={cn(
              'rounded p-1.5 transition-colors',
              activeType === type
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
            title={t(`chartTypes.${type}`)}
          >
            <Icon className="h-3.5 w-3.5" />
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Add i18n keys for chart types**

Add to all 8 locale files in `packages/web/src/i18n/locales/{lang}/common.json`:

For `en/common.json`:
```json
{
  "chartTypes": {
    "line": "Line",
    "area": "Area",
    "candlestick": "Candlestick",
    "bar": "OHLC Bar",
    "baseline": "Baseline",
    "histogram": "Histogram"
  }
}
```

For `de/common.json`:
```json
{
  "chartTypes": {
    "line": "Linie",
    "area": "Fläche",
    "candlestick": "Kerze",
    "bar": "OHLC-Balken",
    "baseline": "Basislinie",
    "histogram": "Histogramm"
  }
}
```

For `it/common.json`:
```json
{
  "chartTypes": {
    "line": "Linea",
    "area": "Area",
    "candlestick": "Candela",
    "bar": "Barra OHLC",
    "baseline": "Linea base",
    "histogram": "Istogramma"
  }
}
```

For `fr/common.json`:
```json
{
  "chartTypes": {
    "line": "Ligne",
    "area": "Zone",
    "candlestick": "Chandelier",
    "bar": "Barre OHLC",
    "baseline": "Ligne de base",
    "histogram": "Histogramme"
  }
}
```

For `es/common.json`:
```json
{
  "chartTypes": {
    "line": "Línea",
    "area": "Área",
    "candlestick": "Vela",
    "bar": "Barra OHLC",
    "baseline": "Línea base",
    "histogram": "Histograma"
  }
}
```

For `nl/common.json`:
```json
{
  "chartTypes": {
    "line": "Lijn",
    "area": "Gebied",
    "candlestick": "Kandelaar",
    "bar": "OHLC-staaf",
    "baseline": "Basislijn",
    "histogram": "Histogram"
  }
}
```

For `pl/common.json`:
```json
{
  "chartTypes": {
    "line": "Linia",
    "area": "Obszar",
    "candlestick": "Świeca",
    "bar": "Słupek OHLC",
    "baseline": "Linia bazowa",
    "histogram": "Histogram"
  }
}
```

For `pt/common.json`:
```json
{
  "chartTypes": {
    "line": "Linha",
    "area": "Área",
    "candlestick": "Vela",
    "bar": "Barra OHLC",
    "baseline": "Linha de base",
    "histogram": "Histograma"
  }
}
```

- [ ] **Step 3: Verify it compiles**

Run: `pnpm build --filter @quovibe/web`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/components/shared/ChartToolbar.tsx packages/web/src/i18n/locales/
git commit -m "feat: add ChartToolbar component with i18n chart type labels"
```

---

## Task 6: `<ChartLegendOverlay>` Component (Base)

**Files:**
- Create: `packages/web/src/components/shared/ChartLegendOverlay.tsx`

- [ ] **Step 1: Create the base legend overlay**

```typescript
// packages/web/src/components/shared/ChartLegendOverlay.tsx
import { useState, useEffect, useCallback } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import type { IChartApi, ISeriesApi, MouseEventParams, SeriesType } from 'lightweight-charts';
import { cn } from '@/lib/utils';
import { usePrivacy } from '@/context/PrivacyContext';

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
  const [crosshairValues, setCrosshairValues] = useState<Map<string, string>>(new Map());
  const { isPrivate } = usePrivacy();

  const handleCrosshairMove = useCallback((param: MouseEventParams) => {
    const values = new Map<string, string>();
    if (param.time) {
      for (const item of items) {
        const data = param.seriesData.get(item.series);
        if (data) {
          const val = 'value' in data ? (data as { value: number }).value
            : 'close' in data ? (data as { close: number }).close
            : null;
          if (val != null) {
            values.set(item.id, item.formatValue ? item.formatValue(val) : val.toFixed(2));
          }
        }
      }
    }
    setCrosshairValues(values);
  }, [items]);

  useEffect(() => {
    if (!chart) return;
    chart.subscribeCrosshairMove(handleCrosshairMove);
    return () => chart.unsubscribeCrosshairMove(handleCrosshairMove);
  }, [chart, handleCrosshairMove]);

  if (items.length === 0) return null;

  return (
    <div className={cn('absolute top-2 left-2 z-10 flex flex-wrap gap-x-4 gap-y-1 text-xs', className)}>
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
          <span className={cn('text-muted-foreground', !item.visible && 'line-through opacity-50')}>
            {item.label}
          </span>
          {crosshairValues.has(item.id) && (
            <span className={cn('font-mono font-medium', isPrivate && 'blur-sm')}>
              {crosshairValues.get(item.id)}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `pnpm build --filter @quovibe/web`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/shared/ChartLegendOverlay.tsx
git commit -m "feat: add ChartLegendOverlay with crosshair value tracking"
```

---

## Task 7: Migrate WidgetDrawdownChart

**Files:**
- Modify: `packages/web/src/components/domain/widgets/WidgetDrawdownChart.tsx`

Depends on: Tasks 3, 5, 6

- [ ] **Step 1: Read the current implementation**

Read `packages/web/src/components/domain/widgets/WidgetDrawdownChart.tsx` in full to understand the current data flow, props, and all features.

- [ ] **Step 2: Rewrite the component**

Replace the Recharts implementation with Lightweight Charts. The component should:

1. Use `useLightweightChart` for chart lifecycle
2. Add an Area series (or Line/Baseline/Histogram based on `ChartToolbar` selection) for drawdown data
3. Use `<ChartToolbar>` with `chartId="widget-drawdown"` and `hasOhlc={false}`
4. Map the existing data shape `{ date: string, drawdown: number }` to Lightweight Charts format `{ time: string, value: number }`
5. Apply the `danger` color from `useChartColors()` for the fill/stroke
6. Apply privacy blur via CSS `filter` on the container (same as current)
7. Use gradient fill: area series with `topColor` (semi-transparent danger) and `bottomColor` (transparent)
8. Wrap the container div in `group/chart` class for toolbar hover reveal

Key mapping:
- Recharts `ResponsiveContainer` → `useLightweightChart` with `autoResize: true`
- Recharts `XAxis` ticks → Lightweight Charts `timeScale` handles this natively
- Recharts `Tooltip` → `<ChartLegendOverlay>` with drawdown format value
- Recharts `CartesianGrid` → `grid` options from `toLightweightTheme`

Handle chart type switching:
- Store current series ref
- On type change: remove old series, create new series of selected type, call `setData()`, update series ref
- Default type: `area`

- [ ] **Step 3: Verify it renders**

Run: `pnpm dev`
Navigate to the dashboard and verify the drawdown widget renders correctly with the new chart.
Check: chart type switcher appears on hover, switching between line/area/baseline/histogram works.

- [ ] **Step 4: Verify build passes**

Run: `pnpm build`
Expected: Build succeeds

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/domain/widgets/WidgetDrawdownChart.tsx
git commit -m "feat: migrate WidgetDrawdownChart from Recharts to Lightweight Charts"
```

---

## Task 8: Migrate WidgetPerfChart

**Files:**
- Modify: `packages/web/src/components/domain/widgets/WidgetPerfChart.tsx`

Depends on: Tasks 3, 5, 6

- [ ] **Step 1: Read the current implementation**

Read `packages/web/src/components/domain/widgets/WidgetPerfChart.tsx` in full.

- [ ] **Step 2: Rewrite the component**

Replace the Recharts implementation with Lightweight Charts. The component should:

1. Use `useLightweightChart` with dual price scales:
   ```typescript
   options: {
     rightPriceScale: { visible: true },
     leftPriceScale: { visible: true },
   }
   ```
2. Create two series:
   - **Market Value**: Area series on right price scale (default), `profit` color
   - **TTWROR %**: Line series on left price scale (`priceScaleId: 'left'`), `dividend` color
3. Map data: `{ date, marketValue, ttwror }` → two `setData()` calls with `{ time: date, value: number }`
4. Use `<ChartToolbar>` with `chartId="widget-perf"`, `hasOhlc={false}` — type switching applies to MV series only
5. Use `<ChartLegendOverlay>` with both series items, format values appropriately (currency for MV, percentage for TTWROR)
6. Keep the cumulative/annualized toggle button as React UI outside the chart
7. Apply privacy blur

Key detail: the TTWROR left scale should format as percentage. Use:
```typescript
leftPriceScale: {
  visible: true,
  ticksVisible: true,
}
```
And set the line series format:
```typescript
chart.addSeries(LineSeries, {
  priceScaleId: 'left',
  color: colors.dividend,
  priceFormat: { type: 'percent' },
})
```

- [ ] **Step 3: Verify it renders**

Run: `pnpm dev`
Navigate to dashboard. Verify: dual axes show, MV area fills, TTWROR line overlays, crosshair shows both values, toolbar works, cumulative/annualized toggle works.

- [ ] **Step 4: Verify build passes**

Run: `pnpm build`
Expected: Build succeeds

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/domain/widgets/WidgetPerfChart.tsx
git commit -m "feat: migrate WidgetPerfChart from Recharts to Lightweight Charts"
```

---

## Task 9: Replace Sparkline Charts

**Files:**
- Modify: `packages/web/src/components/domain/widgets/WidgetMovers.tsx`
- Modify: `packages/web/src/components/domain/widgets/WidgetBenchmarkComparison.tsx`
- Modify: `packages/web/src/components/domain/AddInstrumentDialog/InstrumentDetail.tsx`

Depends on: Task 4

- [ ] **Step 1: Read all three files**

Read the sparkline portions of each file to understand the current data shapes and styling.

- [ ] **Step 2: Migrate WidgetMovers sparklines**

In `WidgetMovers.tsx`:
- Replace the inline `Sparkline` component (which uses ComposedChart) with the new `<Sparkline>` canvas component
- Map data: extract numeric values from `Array<{ date: string, cumR: string }>` → `number[]` by parsing `cumR`
- Use `profit` color for positive movers, `loss` color for negative
- Set `height={32}`, `fillOpacity={0.15}`
- Remove `recharts` imports from this file

- [ ] **Step 3: Migrate WidgetBenchmarkComparison sparkline**

In `WidgetBenchmarkComparison.tsx`:
- Replace the `AreaChart` sparkline with `<Sparkline>`
- Map diff data: `Array<{ date: string, diff: number }>` → `number[]`
- For the zero reference line: add a thin horizontal `<div>` positioned at the visual midpoint of the sparkline (CSS `position: absolute; top: 50%; border-top: 1px dashed`)
- Use `profit` color when alpha > 0, `loss` when < 0
- Remove `recharts` imports (AreaChart, ReferenceLine, Area)

- [ ] **Step 4: Migrate InstrumentDetail sparkline**

In `InstrumentDetail.tsx`:
- Replace the `LineChart` sparkline with `<Sparkline>`
- Map data: `Array<{ date: string, close: number }>` → `number[]` using `close` values
- Use chart palette color
- Remove `recharts` imports (LineChart, Line, ResponsiveContainer)

- [ ] **Step 5: Verify all three render**

Run: `pnpm dev`
Check: Movers widget sparklines, Benchmark comparison sparkline, Instrument search preview sparkline.

- [ ] **Step 6: Verify build passes**

Run: `pnpm build`
Expected: Build succeeds

- [ ] **Step 7: Commit**

```bash
git add packages/web/src/components/domain/widgets/WidgetMovers.tsx packages/web/src/components/domain/widgets/WidgetBenchmarkComparison.tsx packages/web/src/components/domain/AddInstrumentDialog/InstrumentDetail.tsx
git commit -m "feat: replace Recharts sparklines with canvas Sparkline component"
```

---

## Task 10: Migrate PriceChart (Enhanced)

**Files:**
- Modify: `packages/web/src/components/domain/PriceChart.tsx`

Depends on: Tasks 1, 3, 5, 6

- [ ] **Step 1: Read the current implementation**

Read `packages/web/src/components/domain/PriceChart.tsx` in full.

- [ ] **Step 2: Rewrite the component**

Replace the Recharts implementation with Lightweight Charts. The component should:

1. Use `useLightweightChart`
2. Determine if OHLC data is available by checking if `prices[0].open != null`
3. Default chart type: `line` if no OHLC, saved preference or `candlestick` if OHLC available
4. Create the appropriate series based on chart type:
   - **Line/Area/Baseline/Histogram**: map `{ date, value }` → `{ time: date, value: parseFloat(value) }`
   - **Candlestick/Bar**: map `{ date, open, high, low, value }` → `{ time: date, open, high, low, close }` (parse all to float)
5. Add transaction markers using `createSeriesMarkers()`:
   ```typescript
   import { createSeriesMarkers } from 'lightweight-charts';

   const markers = transactions.map(tx => ({
     time: tx.date,
     position: tx.type === 'SELL' ? 'aboveBar' as const : 'belowBar' as const,
     color: tx.type === 'BUY' ? colors.profit
       : tx.type === 'SELL' ? colors.loss
       : colors.violet,
     shape: 'circle' as const,
     text: tx.type.charAt(0),
   }));
   // Sort markers by time (required by Lightweight Charts)
   markers.sort((a, b) => a.time.localeCompare(b.time));
   createSeriesMarkers(series, markers);
   ```
6. Add click handler for marker tooltip:
   ```typescript
   chart.subscribeClick((param) => {
     // Find if click is near a marker timestamp
     if (param.time) {
       const txAtDate = transactionMap.get(param.time as string);
       if (txAtDate) {
         setTooltipData({ x: param.point?.x ?? 0, y: param.point?.y ?? 0, transactions: txAtDate });
       } else {
         setTooltipData(null);
       }
     }
   });
   ```
7. Render a floating tooltip div when `tooltipData` is set, showing transaction details
8. Add volume pane (pane index 1) with histogram series if volume data available:
   ```typescript
   const volumeSeries = chart.addSeries(HistogramSeries, {
     priceFormat: { type: 'volume' },
     priceScaleId: 'volume',
   }, 1); // paneIndex 1
   ```
9. Use `<ChartToolbar>` with `chartId="price-chart"`, `hasOhlc={hasOhlc}`
10. Use `<ChartLegendOverlay>` for the price series
11. Handle chart type switching: remove old series, create new with appropriate type, re-set data + markers
12. Apply privacy blur
13. Call `chart.timeScale().fitContent()` after setting data

- [ ] **Step 3: Verify it renders**

Run: `pnpm dev`
Navigate to a security detail page. Check:
- Price chart renders with correct data
- Transaction markers appear (buy green below, sell red above, dividend violet below)
- Clicking a marker shows transaction tooltip
- Chart type switcher works (if OHLC data: candlestick/bar/line/area)
- Volume pane shows below if volume data exists

- [ ] **Step 4: Verify build passes**

Run: `pnpm build`
Expected: Build succeeds

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/domain/PriceChart.tsx
git commit -m "feat: migrate PriceChart to Lightweight Charts with OHLC and native markers"
```

---

## Task 11: Migrate TaxonomySeries

**Files:**
- Modify: `packages/web/src/pages/TaxonomySeries.tsx`

Depends on: Tasks 3, 5, 6

- [ ] **Step 1: Read the current implementation**

Read `packages/web/src/pages/TaxonomySeries.tsx` in full.

- [ ] **Step 2: Rewrite the chart portion**

Replace the Recharts `ComposedChart` with Lightweight Charts. Keep all surrounding UI (taxonomy selector, mode toggle, page layout) unchanged. The chart should:

1. Use `useLightweightChart`
2. MV mode: create one Area series per taxonomy category, each with its assigned color
3. TTWROR mode: create one Line series per taxonomy category
4. Mode toggle: remove all series, recreate with new type
5. Use `<ChartToolbar>` with `chartId="taxonomy-series"`, `hasOhlc={false}`
6. Use `<ChartLegendOverlay>` with category name/color/value per series
7. `chart.timeScale().fitContent()` after data load
8. Handle chart type switching within the active mode

Data mapping:
- Current: merged data object with `{ date, [categoryKey]: value }`
- Lightweight Charts: each series gets its own `{ time, value }[]` array

- [ ] **Step 3: Verify it renders**

Run: `pnpm dev`
Navigate to taxonomy series page. Check: categories display as separate colored series, MV/TTWROR toggle works, legend shows values on hover, chart type switcher works.

- [ ] **Step 4: Verify build passes**

Run: `pnpm build`
Expected: Build succeeds

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/pages/TaxonomySeries.tsx
git commit -m "feat: migrate TaxonomySeries from Recharts to Lightweight Charts"
```

---

## Task 12: Migrate Payments

**Files:**
- Modify: `packages/web/src/pages/Payments.tsx`

Depends on: Tasks 3, 5, 6

- [ ] **Step 1: Read the current implementation**

Read `packages/web/src/pages/Payments.tsx` in full.

- [ ] **Step 2: Rewrite the chart portions**

The Payments page has two `BarChart` instances (dividends and interest). Replace each with Lightweight Charts:

1. Create a reusable chart section (or inline for each) using `useLightweightChart`
2. Use Histogram series for bars: `chart.addSeries(HistogramSeries, { color: barColor })`
3. Map data: `{ bucket: string, total: number }` → `{ time: bucket, value: total }`
   - **Note:** The `bucket` is a date string (first day of month/quarter/year). Lightweight Charts time scale handles this natively.
4. Gross/net toggle: call `series.setData()` with the appropriate dataset
5. Period grouping buttons (month/quarter/year) stay as React UI — on change, refetch data and call `series.setData()`
6. Keep the hover-triggered prefetch logic (debounced `prefetchQuery`)
7. Use `<ChartToolbar>` with `chartId="payments-dividends"` / `chartId="payments-interest"`, `hasOhlc={false}`
   - Allow switching to Line/Area for trend view
8. Use `<ChartLegendOverlay>` for each chart
9. Handle chart type switching: histogram → line/area and back

For bar coloring (positive/negative): Histogram series supports per-point color via the data format:
```typescript
{ time: date, value: amount, color: amount >= 0 ? colors.profit : colors.loss }
```

- [ ] **Step 3: Verify it renders**

Run: `pnpm dev`
Navigate to payments page. Check: dividend and interest bar charts render, gross/net toggle works, period grouping works, chart type switching works, hover prefetch still fires.

- [ ] **Step 4: Verify build passes**

Run: `pnpm build`
Expected: Build succeeds

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/pages/Payments.tsx
git commit -m "feat: migrate Payments charts from Recharts to Lightweight Charts"
```

---

## Task 13: Extended `<ChartLegendOverlay>` for PerformanceChart

**Files:**
- Modify: `packages/web/src/components/shared/ChartLegendOverlay.tsx`

Depends on: Task 6

This task extends the base ChartLegendOverlay with the interactive features needed by PerformanceChart.

- [ ] **Step 1: Read InteractiveChartLegend for reference**

Read `packages/web/src/components/shared/InteractiveChartLegend.tsx` to understand all interactive features that need to be ported.

- [ ] **Step 2: Add extended props and features**

Add to `ChartLegendOverlay.tsx` an extended variant that supports:

1. **Color picker**: Reuse the existing `ColorPicker` pattern from `InteractiveChartLegend.tsx` — a popover with preset colors + hex input
2. **Line style cycling**: Click cycles solid → dashed → dotted. Map to Lightweight Charts `LineStyle` enum:
   - `solid` → `LineStyle.Solid` (0)
   - `dashed` → `LineStyle.Dashed` (2)
   - `dotted` → `LineStyle.Dotted` (3)
3. **Area fill toggle**: Callback to parent (parent handles series swap between Line and Area)
4. **Drag-to-reorder**: Reuse `@dnd-kit/sortable` with `horizontalListSortingStrategy` (same as current)
5. **Remove series**: X button with callback
6. **Isolate**: Double-click to show only this series

Export as `ExtendedChartLegendOverlay` with additional props:

```typescript
interface ExtendedLegendSeriesItem extends LegendSeriesItem {
  lineStyle: 'solid' | 'dashed' | 'dotted';
  areaFill: boolean;
}

interface ExtendedChartLegendOverlayProps extends ChartLegendOverlayProps {
  items: ExtendedLegendSeriesItem[];
  onColorChange?: (id: string, color: string) => void;
  onLineStyleChange?: (id: string, style: 'solid' | 'dashed' | 'dotted') => void;
  onAreaFillToggle?: (id: string) => void;
  onRemove?: (id: string) => void;
  onReorder?: (ids: string[]) => void;
  onIsolate?: (id: string) => void;
}
```

- [ ] **Step 3: Verify it compiles**

Run: `pnpm build --filter @quovibe/web`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/components/shared/ChartLegendOverlay.tsx
git commit -m "feat: add ExtendedChartLegendOverlay with color/style/reorder support"
```

---

## Task 14: Migrate PerformanceChart

**Files:**
- Modify: `packages/web/src/pages/PerformanceChart.tsx`

Depends on: Tasks 3, 5, 13

This is the most complex migration. Read the current implementation carefully before starting.

- [ ] **Step 1: Read the current implementation thoroughly**

Read `packages/web/src/pages/PerformanceChart.tsx` in full. Pay attention to:
- How `useChartSeries` provides data for each series
- How `useChartConfig` / `useSaveChartConfig` manage persistence
- How the merged data computation works
- How periodic bars are scaled and rendered
- How the InteractiveChartLegend callbacks wire to series visibility/color/style

- [ ] **Step 2: Rewrite the chart component**

Replace the Recharts ComposedChart with Lightweight Charts. The component should:

1. Use `useLightweightChart` with multi-pane support:
   ```typescript
   options: {
     rightPriceScale: { visible: true },
     leftPriceScale: { visible: true },
   }
   ```

2. **Main pane (0)**: For each visible series from `useChartSeries`:
   - Portfolio: Area or Line series (based on `areaFill` config)
   - Securities: Line series with configured color and line style
   - Benchmarks: Line series with `lineStyle: LineStyle.Dashed`
   - Accounts: Line series
   - Map line style from config: `'solid'` → `LineStyle.Solid`, `'dashed'` → `LineStyle.Dashed`, `'dotted'` → `LineStyle.Dotted`
   - Each series gets its own `{ time: date, value: ttwrorValue }[]` array

3. **Bar pane (1)**: If a `periodic_bars` series exists:
   ```typescript
   const barSeries = chart.addSeries(HistogramSeries, {
     priceFormat: { type: 'percent' },
     priceScaleId: 'bars',
   }, 1); // pane index 1
   ```
   Map periodic return data with positive/negative coloring.

4. **Dual Y-axes**: If MV and TTWROR are both shown:
   - TTWROR on right scale (default)
   - MV on left scale with `priceScaleId: 'left'`

5. **Series management**: Maintain a `Map<string, ISeriesApi>` of active series. On config changes:
   - Visibility toggle: `series.applyOptions({ visible: false/true })`
   - Color change: `series.applyOptions({ color: newColor })`
   - Line style change: `series.applyOptions({ lineStyle: newStyle })`
   - Area fill toggle: Remove series, recreate as Area/Line type with same data
   - Remove: `chart.removeSeries(series)`, delete from map
   - Reorder: Remove all series, re-add in new order (z-order is add-order in Lightweight Charts)

6. Use `<ExtendedChartLegendOverlay>` with all callbacks wired to config mutations via `useSaveChartConfig`

7. Use `<ChartToolbar>` with `chartId="performance"`, `hasOhlc={false}` — type switching applies to the portfolio series

8. Annualized mode: recompute data and call `series.setData()` for all series

9. `chart.timeScale().fitContent()` after initial data load

10. Real-time polling: configure the performance query with `refetchInterval: 60000`. On data update, call `series.update(latestPoint)` for the most recent data point if only the last point changed, otherwise `series.setData()` for the full dataset.

- [ ] **Step 3: Verify it renders**

Run: `pnpm dev`
Navigate to the performance chart page. Systematically verify:
- Portfolio line/area renders
- Adding a security series works
- Adding a benchmark series works (dashed line)
- Adding periodic bars creates a second pane below
- Legend: hover shows values, visibility toggle, color picker, line style cycling, area fill toggle, drag reorder, remove
- Annualized/cumulative toggle
- Chart type toolbar
- Privacy blur

- [ ] **Step 4: Verify build passes**

Run: `pnpm build`
Expected: Build succeeds

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/pages/PerformanceChart.tsx
git commit -m "feat: migrate PerformanceChart to Lightweight Charts with multi-pane and interactive legend"
```

---

## Task 15: Update ChartExportButton

**Files:**
- Modify: `packages/web/src/components/shared/ChartExportButton.tsx`

- [ ] **Step 1: Read the current implementation**

Read `packages/web/src/components/shared/ChartExportButton.tsx`. Note the filter function that excludes `.recharts-tooltip-wrapper`.

- [ ] **Step 2: Update the tooltip filter**

The `html-to-image` filter function currently excludes Recharts tooltip elements. Since Lightweight Charts renders on canvas (no DOM tooltip wrapper), update the filter to be more generic:

Remove or update the filter that references `.recharts-tooltip-wrapper`. The new legend overlay is positioned absolutely and should be captured by the screenshot. No special filtering needed for Lightweight Charts elements.

If the crosshair tooltip (Lightweight Charts native) leaves a visual artifact, filter elements with `tv-lightweight-charts` class prefixes as needed.

- [ ] **Step 3: Verify export works**

Run: `pnpm dev`
Navigate to PerformanceChart, click the export button. Verify: PNG export captures the chart + legend overlay + watermark.

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/components/shared/ChartExportButton.tsx
git commit -m "fix: update ChartExportButton filter for Lightweight Charts compatibility"
```

---

## Task 16: Real-Time Polling

**Files:**
- Modify: `packages/web/src/api/use-chart-series.ts`
- Modify: `packages/web/src/api/use-securities.ts` (or equivalent price hook)

- [ ] **Step 1: Read the current hooks**

Read `packages/web/src/api/use-chart-series.ts` and the hook that fetches security prices to understand the current query configuration.

- [ ] **Step 2: Add refetchInterval to relevant queries**

Add `refetchInterval: 60_000` (60 seconds) to the React Query options for:
- The performance chart data query in `use-chart-series.ts`
- The security price data query used by `PriceChart`

```typescript
useQuery({
  queryKey: [...],
  queryFn: ...,
  refetchInterval: 60_000,
})
```

- [ ] **Step 3: Handle incremental updates in chart components**

In the chart components (PriceChart, PerformanceChart, widget charts), when new data arrives from React Query:
- Compare the new data length with the current series data length
- If only the last point changed or one point was added: use `series.update(newLastPoint)` for efficient canvas update
- If the data changed significantly: use `series.setData(newData)` for a full redraw

This logic should be in a `useEffect` that watches the query data.

- [ ] **Step 4: Verify polling works**

Run: `pnpm dev`
Open PriceChart for a security that has active trading. Wait 60s. Verify: chart updates without a full page refresh.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/api/use-chart-series.ts packages/web/src/api/use-securities.ts
git commit -m "feat: add 60s polling interval for real-time chart updates"
```

---

## Task 17: Cleanup — Delete Replaced Components

**Files:**
- Delete: `packages/web/src/components/shared/ChartTooltip.tsx`
- Delete: `packages/web/src/components/shared/ChartLegend.tsx`
- Delete: `packages/web/src/components/shared/InteractiveChartLegend.tsx`
- Delete: `packages/web/src/hooks/use-chart-ticks.ts`

- [ ] **Step 1: Verify no remaining imports**

Run: `grep -r "ChartTooltip\|ChartLegend\|InteractiveChartLegend\|use-chart-ticks\|useChartTicks" packages/web/src/ --include="*.ts" --include="*.tsx" -l`

This should return only the files being deleted. If any other file still imports these, update it first.

- [ ] **Step 2: Check for remaining Recharts imports in migrated files**

Run: `grep -r "from 'recharts'" packages/web/src/ --include="*.ts" --include="*.tsx" -l`

Expected: Only `TaxonomyChart.tsx` should still import from Recharts.

- [ ] **Step 3: Delete the files**

```bash
rm packages/web/src/components/shared/ChartTooltip.tsx
rm packages/web/src/components/shared/ChartLegend.tsx
rm packages/web/src/components/shared/InteractiveChartLegend.tsx
rm packages/web/src/hooks/use-chart-ticks.ts
```

- [ ] **Step 4: Verify build passes**

Run: `pnpm build`
Expected: Build succeeds

- [ ] **Step 5: Verify all tests pass**

Run: `pnpm test`
Expected: All tests PASS

- [ ] **Step 6: Run governance checks**

Run: `pnpm check:all`
Expected: All checks PASS

- [ ] **Step 7: Commit**

```bash
git add -u packages/web/src/components/shared/ChartTooltip.tsx packages/web/src/components/shared/ChartLegend.tsx packages/web/src/components/shared/InteractiveChartLegend.tsx packages/web/src/hooks/use-chart-ticks.ts
git commit -m "chore: remove replaced Recharts chart components and hooks"
```

---

## Task 18: Final Verification

- [ ] **Step 1: Full build**

Run: `pnpm build`
Expected: PASS

- [ ] **Step 2: Full test suite**

Run: `pnpm test`
Expected: PASS

- [ ] **Step 3: Lint**

Run: `pnpm lint`
Expected: PASS (max 50 warnings)

- [ ] **Step 4: Governance checks**

Run: `pnpm check:all`
Expected: PASS

- [ ] **Step 5: Visual smoke test**

Run: `pnpm dev` and verify each migrated chart:

| Chart | Page/Widget | What to check |
|-------|-------------|---------------|
| WidgetDrawdownChart | Dashboard | Area renders, toolbar works, privacy blur |
| WidgetPerfChart | Dashboard | Dual axes, MV area + TTWROR line, legend hover |
| WidgetMovers | Dashboard | 6+ sparklines render, correct colors |
| WidgetBenchmarkComparison | Dashboard | Sparkline with zero reference |
| InstrumentDetail | Add instrument dialog | 90-day preview sparkline |
| PriceChart | Security detail | OHLC candlestick (if data), markers, click tooltip, volume pane |
| TaxonomySeries | Taxonomy series page | Multi-series by category, MV/TTWROR toggle |
| Payments | Payments page | Dividend + interest histograms, gross/net, period grouping |
| PerformanceChart | Performance page | Multi-series, legend interactions, periodic bars pane, export |
| TaxonomyChart | Holdings page | Pie/Treemap still on Recharts, working correctly |

- [ ] **Step 6: Commit any remaining fixes**

```bash
git add -A
git commit -m "fix: address visual polish issues from Lightweight Charts migration smoke test"
```
