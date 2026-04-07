# Dashboard Redesign: Four-Zone Layout

**Date:** 2026-04-07
**Status:** Approved
**Scope:** Dashboard page layout, two new standalone components (hero + metrics strip), widget zone sorting, compact detail cards

## Goal

Redesign the dashboard from a flat widget grid into a four-zone layout: hero section (balance + sparkline), metrics strip (4 primary KPIs), charts zone (full-width chart widgets), and detail zone (compact widget grid). Creates a strong first impression with clear visual hierarchy.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Hero content | Balance + sparkline | Context without competing with chart widgets |
| Widget hierarchy | Size + grouping (zones) | Natural visual rhythm: big → compact → wide → grid |
| Detail density | Compact cards | Higher density while keeping widget system intact |
| Schema changes | None | Zone sorting is render-time based on widget type |

## 1. Hero Component

New standalone component: `packages/web/src/components/domain/DashboardHero.tsx`

Not a widget — sits above the widget system, always visible on every dashboard tab.

### Layout
- **Container:** No card wrapper. Renders directly on page background with horizontal padding matching page container. Flex row with gap.
- **Left side:** Portfolio balance (text-3xl / 2rem, font-weight 700) via `<NumberFlow>` with muted-fraction class. Below the balance: gain/loss amount (text-sm, profit/loss color) + gain/loss percentage in a pill badge (semantic bg color, rounded-full, text-xs font-weight 500).
- **Right side:** SVG sparkline area chart filling remaining width. Height: 80px. Built from chart series data points as an SVG `<path>`.

### Data
- Uses `useCalculation` hook at portfolio scope with the active reporting period
- Balance: `finalValue` field
- Gain/loss amount: `absolutePerformance` field
- Gain/loss percentage: `absolutePerformancePct` field (formatted as percentage)
- Sparkline: Uses `useChartSeries` hook with `type: 'portfolio'`, extracts `marketValue` points to build SVG path

### Sparkline
- SVG element with `viewBox`, `preserveAspectRatio="none"` to fill container
- Two paths: area fill (linearGradient, 15% opacity at top → 0% at bottom) + stroke line (1.5px)
- Color: profit color (`--qv-positive`) when total return >= 0, loss color (`--qv-negative`) when negative
- No axes, labels, or interactivity — purely decorative trend visualization
- Points mapped from data: X = evenly distributed across viewBox width, Y = scaled value (min→max mapped to viewBox height)

### Privacy Mode
- Balance: `••••••`
- Gain/loss: hidden
- Sparkline: `filter: blur(8px) saturate(0)`

### Responsive
- `>= md`: Flex row (balance left, sparkline right)
- `< md`: Balance only, full width. Sparkline hidden.

## 2. Metrics Strip

New standalone component: `packages/web/src/components/domain/DashboardMetricsStrip.tsx`

Not a widget — renders below hero, above widget zones.

### Layout
- **Container:** Flex row, no card wrapper, horizontal padding matching page. Thin `border-b` at bottom to separate from charts zone.
- **Items:** 4 metrics, each `flex: 1`, separated by `border-right` (except last). Each item: label (text-xs, uppercase, tracking-wider, text-muted) + value (text-lg, font-weight 600, semantic color) with `<NumberFlow>`.
- **Settings button:** Small gear icon aligned right at the end of the strip, opens a popover to select which 4 metrics to display.

### Default Metrics
1. TTWROR (cumulative return)
2. Delta (period value change, currency)
3. IRR (annualized)
4. Max Drawdown

### Configuration
- Stored in the dashboard config object as `metricsStripIds: string[]` (array of metric IDs, max 4)
- Available metric IDs: `ttwror`, `ttwror-pa`, `irr`, `delta`, `absolute-performance`, `absolute-change`, `max-drawdown`, `current-drawdown`, `volatility`, `sharpe-ratio`, `semivariance`, `cash-drag`, `invested-capital`, `all-time-high`, `distance-from-ath`
- If `metricsStripIds` is not set or empty, use the 4 defaults above
- Settings popover: checklist of available metrics, max 4 selectable. Save updates dashboard config via existing mutation.

### Data
- Uses `useCalculation` hook at portfolio scope (same as hero)
- Each metric maps to a field in the calculation response (same mapping the widgets use)

### Privacy Mode
- All values show `••••••`

### Responsive
- `>= md`: 4-column flex row with vertical borders
- `< md`: 2x2 grid with `gap-2`, no vertical borders

## 3. Charts Zone

No new component — this is a rendering change in `Dashboard.tsx`.

### Behavior
At render time, the dashboard page filters the `widgets[]` array:
- **Chart widgets:** Types `perf-chart`, `drawdown-chart`, `returns-heatmap` → rendered in the charts zone
- **All others:** → rendered in the detail zone

### Layout
- Charts zone renders below the metrics strip divider
- Each chart widget renders full-width (forced `span: 3` equivalent — single-column stack)
- Standard `WidgetShell` wrapper (keeps toolbar, config, drag handle)
- Drag-and-drop: reorder within charts zone only (uses a separate `SortableContext` from the detail zone)
- Gap: `gap-4` (same as current)
- If no chart widgets exist on the dashboard, this zone is simply absent

## 4. Detail Zone

Rendering change in `Dashboard.tsx` + style adjustments to `WidgetShell`.

### Layout
- Grid: `repeat(auto-fill, minmax(220px, 1fr))` (was `minmax(320px, 1fr)`)
- Gap: `gap-2` (was `gap-4`)
- Drag-and-drop: reorder within detail zone only (separate `SortableContext`)

### Compact Card Adjustments
Applied when a widget renders in the detail zone. The `WidgetShell` receives a `compact` prop (or detects it from context).

| Property | Current | Compact |
|----------|---------|---------|
| Card padding | `px-4 py-4` | `px-3 py-3` |
| CardHeader padding | `pb-1 pt-4 px-4` | `pb-1 pt-3 px-3` |
| Value text | `text-2xl` | `text-xl` |
| Stagger animation | `0.4s / 50ms` | Same |
| Grip handle | Standard | Smaller (`size-3` icon) |
| Kebab menu | Standard | Same |

Widget components use `text-2xl` for their main value. In compact mode, `WidgetShell` wraps the content area in a container with a CSS class (e.g. `qv-compact-widget`) that overrides `text-2xl` to `text-xl` via descendant selector:
```css
.qv-compact-widget .text-2xl { font-size: 1.25rem; line-height: 1.75rem; }
```
This avoids changing every widget component individually. Widget components do NOT need to read a `compact` flag.

### Multi-span widgets in detail zone
`movers` (span: 2) and `cost-tax-drag` (span: 2) keep their span in the detail grid. The narrower min-width means they'll span more effectively.

## 5. Widget Catalog Integration

The widget catalog dialog remains unchanged. When a user adds a widget:
- Chart types auto-appear in the charts zone
- All other types auto-appear in the detail zone
- No user action needed to place widgets in zones — it's automatic by type

## 6. Dashboard Config Schema

No new API endpoints. The existing `PUT /api/dashboard` body is extended with one optional field per dashboard:

```typescript
interface Dashboard {
  id: string;
  name: string;
  widgets: DashboardWidget[];
  metricsStripIds?: string[];  // NEW — which 4 metrics to show in the strip
}
```

This is a frontend-only config field saved to the same dashboard JSON blob. No backend changes needed.

## 7. Files Changed

### New Files
- `packages/web/src/components/domain/DashboardHero.tsx` — hero component
- `packages/web/src/components/domain/DashboardMetricsStrip.tsx` — metrics strip component
- `packages/web/src/components/domain/MetricsStripSettings.tsx` — settings popover for metric selection

### Modified Files
- `packages/web/src/pages/Dashboard.tsx` — zone sorting logic, render hero + strip above widgets, two `SortableContext` instances
- `packages/web/src/components/domain/WidgetShell.tsx` — `compact` prop/context for smaller detail cards
- `packages/web/src/lib/widget-registry.ts` — add `zone: 'chart' | 'detail'` field to each widget definition (declarative zone assignment)
- Dashboard config type (in shared or web types) — add optional `metricsStripIds` field

### i18n
- Add keys for: hero labels, metrics strip labels, settings popover text
- Namespaces: `dashboard`

## 8. What This Does NOT Change

- Widget components themselves (WidgetMarketValue, WidgetTtwror, etc.) — no code changes
- Widget configuration system (data series, period override, options)
- Widget catalog dialog
- Dashboard tab system (create, rename, duplicate, delete, reorder tabs)
- API endpoints
- Database schema
- Chart libraries (lightweight-charts, recharts)
