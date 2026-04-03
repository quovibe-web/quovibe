globs: packages/web/**
---
# Frontend Rules

## Stack
- React 19.2 + Vite 8.0 + React Router 7.13 + TypeScript 5.9 strict
- UI: shadcn/ui + Tailwind 4.2
- Data tables: TanStack Table 8.21 (`DataTable` wrapper in `components/shared/`)
- Server state: TanStack Query 5.95 (query hooks in `src/api/use-*.ts`)
- Charts: Recharts 3.8
- Date: date-fns 4.1 (`format`, `parseISO`, `startOfYear`, `subYears`)
- Validation: Zod schemas from `@quovibe/shared`

## Structure
```
src/
  api/          # apiFetch + React Query hooks (use-*.ts)
  assets/       # static assets (logo, images)
  components/
    domain/     # components with business logic (form, dialog)
    layout/     # Shell, Sidebar, TopBar
    shared/     # DataTable, CurrencyDisplay, MetricCard, ...
    ui/         # shadcn/ui primitives (do not touch)
  context/      # PrivacyContext, WidgetConfigContext, AnalyticsContext
  hooks/        # use-theme, use-chart-colors, use-count-up, useColumnVisibility, ...
  i18n/         # i18next config + locales/{lang}/{namespace}.json
  lib/          # formatters, utils, colors, enums, metric-registry, period-utils
  pages/        # route-level components
```

## Numeric Data
- All values from the API arrive as **strings** (Decimal.toString()).
- Use `parseFloat()` only at the point of display or UI calculation.
- **Never native floating point for recalculations** — if recalculation is needed in the frontend, use Decimal.js.
- Centralized formatting in `src/lib/formatters.ts`:
  - `formatCurrency(value, currency?)` → Intl.NumberFormat with navigator.language
  - `formatPercentage(value, decimals?)` → fractional value (0.05 → "5,00%")
  - `formatDate(dateStr)` → "dd/MM/yyyy" or "dd/MM/yyyy HH:mm" if it has a time component
- For monetary values always use the `<CurrencyDisplay>` component (handles privacy mode + colorize).

## Privacy Mode
- `usePrivacy()` → `{ isPrivate, togglePrivacy }` from `PrivacyContext`.
- All components that display amounts/prices/percentages must respect `isPrivate`.
- Use `<CurrencyDisplay>` or `maskCurrency()` / `maskShares()` from `src/lib/privacy.ts`.
- For charts and areas: `style={{ filter: isPrivate ? 'blur(8px) saturate(0)' : 'none' }}`.

## Reporting Period
- The period is in the URL searchParams: `periodStart` and `periodEnd` (format `yyyy-MM-dd`).
- Use `useReportingPeriod()` (from `src/api/use-performance.ts`) to read/write the period.
- All performance queries pass `periodStart` and `periodEnd` as query params.
- Default: start of current year → today.

## React Query
- QueryClient: `staleTime 5min`, `gcTime 30min`, `retry 2`, `refetchOnWindowFocus false`.
- Hierarchical query keys for selective invalidation (see pattern in `src/api/use-*.ts`).
- Mutations: always invalidate all related queries in `onSuccess`.
- Never access `fetch` directly in pages — always use the hooks in `src/api/`.

## Routing
- `createBrowserRouter` in `src/router.tsx`.
- Main layout: `<Shell>` (Sidebar + TopBar + `<Outlet>`).
- `/import` is standalone (no sidebar).
- Programmatic navigation: `useNavigate()`. Params: `useParams()`. Query: `useSearchParams()`.

## Components
- Use `cn()` (from `src/lib/utils.ts`) to compose conditional Tailwind classes.
- Use `<DataTable>` for data tables — do not create raw tables.
- Follow the pattern of `TransactionForm.tsx` for conditional forms based on `FIELD_CONFIG`.
- Form errors: inline alert() or error messages adjacent to the field — no toast.
- Skeleton/loading: use the existing `*Skeleton` components.

## Themes and Colors
- Tailwind v4 with CSS custom properties in `globals.css`.
- **Muted indigo palette** — primary is `--color-primary` (hsl 225°), accent is `--color-chart-5` (hsl 245°). Legacy cyan/violet/gradient vars and utility classes have been removed.
- Surface hierarchy: `--qv-bg` → `--qv-surface` → `--qv-surface-elevated` → `--qv-surface-3`.
- Semantic colors: `--qv-success`, `--qv-danger`, `--qv-warning`, `--qv-info`, `--qv-positive`, `--qv-negative`.
- Chart palette: 8-color desaturated palette via `--color-chart-1` through `--color-chart-8` (light and dark variants).
- Use `useTheme()` for `resolvedTheme`, `useChartColors()` for chart colors with dark mode (returns 8-color `palette` array).
- Dynamic colors: `getColor('profit')` / `getColor('loss')` via `src/lib/colors.ts` (reads CSS vars at runtime).
- Micro-interactions: page entrance fade (`qv-page`), staggered children reveal, fade-in (`qv-fade-in`), surface transitions (`transition-surface`).
- Light mode uses atmospheric body gradient and card shadows; dark mode uses border + lightness delta, no shadows.

## i18n (Internationalization)
- **Never hardcode user-visible strings.** See `.claude/rules/frontend-i18n.md` for full rules (namespaces, workflow, formatting, pluralization).

## Performance — useCallback / useMemo
- **Do not wrap page-level handlers in `useCallback`** unless the child component receiving
  the callback is wrapped in `React.memo`. Without `React.memo` on the child, memoizing
  callbacks provides zero benefit and risks stale-closure bugs.
- Handlers that close over derived query state (e.g. `dashboards`, `activeDash`) are
  especially dangerous to memoize: the dependency arrays create circular chains
  (`saveDashboards` → `activeDashboard` → `updateActiveDashboard` → `saveDashboards`)
  that produce stale values and break all interactivity.
- Plain `function` declarations inside the component body are the default. Only reach for
  `useCallback` when you have measured a real performance problem **and** the consumer is memoized.
- Same principle applies to `useMemo`: don't memoize derived values unless profiling shows it matters.

## Conventions
- Components and pages: PascalCase (`SecurityDetail.tsx`).
- Hooks: `use` + camelCase (`usePortfolio.ts`).
- Utils: camelCase (`formatters.ts`).
- Component structure: imports → local types → hooks → derived state → handlers → JSX.
- Explicit types everywhere, never `any`.
- Local state (modals, form fields) lives in `useState`. Global UI state in Context. Server data in React Query.
