# Dashboard Templates & Empty State

**Date:** 2026-04-08
**Status:** Approved
**Scope:** 4 dashboard templates, polished empty state with template cards, template selection in New Dashboard dialog

## Goal

Replace the bare empty dashboard state with a template-driven onboarding experience. Users can start from a pre-built template (Performance Overview, Risk Analysis, Income Tracking, Complete Dashboard) when they see an empty dashboard or create a new one.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Empty state treatment | Template cards + "start from scratch" | Merges empty state polish with template feature |
| Number of templates | 4 | Covers main use cases + "give me everything" option |
| Template locations | Empty dashboard + New Dashboard dialog | Accessible for first and subsequent dashboards |

## 1. Template Definitions

**New file:** `packages/web/src/lib/dashboard-templates.ts`

```typescript
interface DashboardTemplate {
  id: string;
  i18nKey: string;
  descriptionKey: string;
  icon: ComponentType<{ className?: string }>;
  widgets: Omit<DashboardWidget, 'id'>[];
}
```

### Templates

| Template | Widget Types |
|----------|-------------|
| Performance Overview | market-value, ttwror, delta, irr, absolute-performance, perf-chart |
| Risk Analysis | max-drawdown, current-drawdown, volatility, semivariance, sharpe-ratio, drawdown-chart |
| Income Tracking | invested-capital, market-value, delta, absolute-change, returns-heatmap |
| Complete Dashboard | market-value, ttwror, irr, delta, perf-chart, drawdown-chart, max-drawdown, volatility, sharpe-ratio, movers |

Each widget entry uses `defaultSpan` and `defaultConfig` from the widget registry via `getWidgetDef()`. Widget IDs are generated with `nanoid()` at apply time, not in the template definition.

## 2. Empty Dashboard State

Replaces the current minimal empty state in `Dashboard.tsx`.

### Layout
- Container: `flex flex-col items-center py-16 gap-6`
- Heading: "Get started" — `text-lg font-semibold`
- Subtitle: "Choose a template to set up your dashboard, or start from scratch." — `text-sm text-muted-foreground max-w-md text-center`
- Template grid: `grid grid-cols-2 gap-3 max-w-lg w-full`
- Each card: `bg-card border border-border rounded-lg p-4 cursor-pointer hover:border-primary/50 hover:shadow-sm transition-all` with stagger-in animation
- Card content: icon (`h-5 w-5 text-primary`) + name (`text-sm font-medium`) + description (`text-xs text-muted-foreground line-clamp-2`) + widget count (`text-xs text-muted-foreground`)
- Below grid: "Or start from scratch" — `text-sm text-muted-foreground hover:text-foreground cursor-pointer` that opens widget catalog

### Behavior
Clicking a template card:
1. Generates widget IDs with `nanoid()`
2. Calls `updateActiveDashboard` to set the widgets array
3. Dashboard immediately renders with the template's widgets

## 3. New Dashboard Dialog

Extends the existing dialog in `Dashboard.tsx`.

### Changes
- After the name input, add a section:
  - Label: "Start from template" — `text-xs font-medium text-muted-foreground mt-4 mb-2`
  - 4 template options in a vertical list
  - Each option: flex row, `p-2.5 rounded-lg border cursor-pointer transition-all`
    - Left: icon (`h-4 w-4 text-primary`)
    - Middle: name (`text-sm font-medium`) + widget count (`text-xs text-muted-foreground`)
    - Right: radio-style indicator (selected gets `border-primary bg-primary/5`)
  - Click to select (radio behavior — one at a time)
  - None selected = blank dashboard (default)
- Create button: when template selected, creates dashboard with template widgets. Otherwise empty.

## 4. Files Changed

| File | Action |
|------|--------|
| `packages/web/src/lib/dashboard-templates.ts` | Create — template definitions |
| `packages/web/src/pages/Dashboard.tsx` | Modify — empty state + dialog template selection |
| `packages/web/src/i18n/locales/*/dashboard.json` (8 files) | Modify — add template keys |

## 5. i18n Keys

Add to `dashboard` namespace:
```json
"templates": {
  "getStarted": "Get started",
  "getStartedDesc": "Choose a template to set up your dashboard, or start from scratch.",
  "startFromScratch": "Or start from scratch",
  "startFromTemplate": "Start from template",
  "widgetCount": "{{count}} widgets",
  "performance": "Performance Overview",
  "performanceDesc": "Essential metrics and performance chart for your portfolio",
  "risk": "Risk Analysis",
  "riskDesc": "Drawdown, volatility, and risk-adjusted return metrics",
  "income": "Income Tracking",
  "incomeDesc": "Track contributions, changes, and income patterns",
  "complete": "Complete Dashboard",
  "completeDesc": "All key metrics, charts, and top movers in one view"
}
```
