globs: packages/web/**
---
# Frontend Rules

## Stack
- React 19 + Vite 8 + React Router 7 + TypeScript 5 strict (exact minors live in `package.json`)
- UI: shadcn/ui + Tailwind 4
- Data tables: TanStack Table 8 (`DataTable` wrapper in `components/shared/`)
- Server state: TanStack Query 5 (query hooks in `src/api/use-*.ts`)
- Charts: Recharts 3 + lightweight-charts 5 (price/perf widgets)
- Forms: react-hook-form 7 + `@hookform/resolvers` (Zod), see "Form pattern" below
- Toasts: sonner (global `MutationCache` error handler in `src/api/query-client.ts`)
- Animation: framer-motion 12 (page entrance + stagger only)
- Drag-and-drop: dnd-kit (dashboard widget reorder)
- Date: date-fns 4 (`format`, `parseISO`, `startOfYear`, `subYears`)
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

### Delete mutations — never refetch the deleted id (BUG-63 / BUG-73)

Bare `invalidateQueries({queryKey: ['portfolios', pid, entity]})` is a trap on
DELETE because query keys are hierarchical: it also matches every child key
under the deleted id (detail, holdings, transactions, …). If any observer for
those child keys is still mounted when the mutation lands, React Query refetches
them against the just-deleted id → 404 → `console.error`. A delete mutation
MUST do one of the following (pick by where the stale observer lives):

1. **Optimistic-delete + `removeQueries`** — when the observer is driven by
   list membership (e.g. `AccountsHub` does
   `useQueries(portfolios.map(p => holdings(p.id)))`). In `onMutate`:
   `cancelQueries` the entity prefix, `setQueryData` to drop the id from every
   list variant, then `removeQueries` on the deleted id's prefix. The
   dependent component re-renders with a shorter list and unmounts the child
   observer before the DELETE completes. Snapshot + roll back in `onError`.
   Pattern: `useDeleteAccount` in `src/api/use-accounts.ts`.
2. **Navigate-first-mutate-second** — when the observer is keyed by a URL
   param (e.g. `useDashboard(dashboardId)` from `useParams`). Change the URL
   at the call site BEFORE calling `mutate`. That unmounts the observer
   synchronously on the next render; by the time `invalidateQueries` fires
   in `onSuccess`, nothing is subscribed to the deleted id. Pattern:
   `deleteDashboard` in `src/pages/Dashboard.tsx`.

Either way, keep `invalidateQueries` on the parent prefix in `onSuccess` as
a consistency safety net — it reconciles the optimistic state with the
server. What you must not do is leave the optimistic/unmount step out and
rely on `invalidateQueries` alone; that is exactly the pattern that caused
BUG-63 (accounts /holdings 404 on delete) and BUG-73 (dashboards detail 404
on delete).

### Server error translation

The pipeline is documented at the top of `src/api/query-client.ts`. Rules:
- API routes emit `{ error: 'SCREAMING_SNAKE_CASE' }`; free-text English error
  strings are forbidden on user-facing routes. Every emitted code must have a
  `server.<CODE>` key in `locales/en/errors.json` (governance test:
  `error-translation-coverage.test.ts`). Unreachable codes (URL-tampering UUID
  failures, generic 500 catch-alls) go in the test's `SKIP_LIST`.
- Mutations rely on the global toast by default. DO NOT add a local
  `onError: (err) => toast.error(...)` to a `useMutation` — that double-fires
  with the global handler. The sanctioned escape hatch is
  `meta: { suppressGlobalErrorToast: true }` on the mutation, used only when
  the call site owns a better local UX (inline Alert, or a specialized toast).
- At `suppressGlobalErrorToast` call sites, use `resolveErrorMessage(err)`
  from `@/api/query-client` — never pass `err.message` through directly, since
  on an `ApiError` that's the raw wire code (e.g. `DEMO_SOURCE_MISSING`).

## Routing
- `createBrowserRouter` in `src/router.tsx`.
- Main layout: `<Shell>` (Sidebar + TopBar + `<Outlet>`).
- `/import` is standalone (no sidebar).
- Programmatic navigation: `useNavigate()`. Params: `useParams()`. Query: `useSearchParams()`.

## Routing / Redirects

- Every in-app URL alias — a `<Navigate>` that rewrites one live path to another —
  MUST preserve `location.search`. The app has user-facing bookmarks carrying
  `?periodStart=…&periodEnd=…`, and stripping those silently replaces the user's
  saved reporting period with the default current-year (BUG-08).
- The canonical helper for static targets is `RedirectWithSearch` in
  `packages/web/src/router.tsx`, which wraps `<Navigate replace />` with
  `appendSearch(to, useLocation().search)` from `@/lib/router-helpers`.
  Use it for every new alias with a fixed target.
- For dynamic-target aliases (targets built from route params), call
  `useLocation()` directly in the component body and interpolate `${search}`
  into the template literal. Examples: `RedirectSecurityDetail` in
  `router.tsx`, the auto-pick redirect in `Dashboard.tsx`, the default-
  portfolio redirect in `RootRedirect.tsx`.
- Error-path redirects (invalid state → `/welcome`, unauthorized → login,
  etc.) keep plain `<Navigate>` — forwarding a stale query into an error
  page is misleading, not helpful. Mark these branches with a short inline
  comment (`// error-path redirect: don't preserve search`) so future
  contributors don't "fix" them by adding `${search}`.

## Components
- Use `cn()` (from `src/lib/utils.ts`) to compose conditional Tailwind classes.
- Use `<DataTable>` for data tables — do not create raw tables.
- Follow the pattern of `TransactionForm.tsx` for conditional forms based on `FIELD_CONFIG`.
- Form errors: inline alert() or error messages adjacent to the field — no toast.
- Skeleton/loading: use the existing `*Skeleton` components.

### Form pattern (canonical) — RHF + zodResolver + shadcn FormField

Any form with more than one user-input field MUST use this stack. The
plain-`useState` shape (manual `handleSubmit` validation, top-of-form Alert,
no per-field error rendering, no Save-disabled gate) is the bug class that
produced BUG-110 + BUG-115; do not re-introduce it.

Required wiring:

1. `useForm<Shape>({ resolver: zodResolver(schema), mode: 'onBlur',
   reValidateMode: 'onChange', defaultValues })` — `mode: 'onBlur'` triggers
   per-field validation as the user moves between fields; `reValidateMode`
   clears errors as they're fixed.
2. Wrap each field in `<FormField>/<FormItem>/<FormLabel>/<FormControl>/<FormMessage>`
   from `@/components/ui/form` (the shadcn integration). `FormControl` injects
   `aria-invalid` + `aria-describedby` automatically; `FormMessage` renders the
   schema's error message under the field with `id={formMessageId}`.
3. Submit button gates on `disabled={!form.formState.isValid || form.formState.isSubmitting}`
   (the existing `<SubmitButton>` already supports `disabled`). Save MUST be
   disabled while the form is invalid — do not rely on click + Zod 400 from
   the server as the only feedback channel.
4. Schema messages MUST be i18n keys (translated at the schema level via a
   `t` injected at build time, OR by overriding FormMessage to call
   `t(error.message)` at render). Either pattern is acceptable; pick one per
   form and stick with it.
5. For dynamic schemas (cross-field constraints like cross-currency
   `fxRate`): build the schema with `useMemo([deps])` and route it through
   a stable resolver that reads from a `useRef`. Sync the ref **synchronously
   in render** (`if (ref.current !== schema) ref.current = schema;`) so RHF's
   eager-on-mount validation pass sees the real schema; use `useEffect` only
   to call `form.trigger()` after rebuilds.

Exemplars:
- `packages/web/src/components/domain/TransactionForm.tsx` — canonical full
  form (12 fields, dynamic schema, FormField wrapping, Save gate).
- `packages/web/src/components/domain/portfolio/PortfolioSetupForm.tsx` —
  smaller form with `useFieldArray` + nested errors.

Pure form-side schemas live next to the component as `*-form.schema.ts` and
have their own vitest coverage; they are NOT in `@quovibe/shared` (which is
wire-schema territory and must remain I/O- and view-free).

### Save-button re-entry guard

Every form Save handler that fires a mutation MUST wrap through
`useGuardedSubmit` from `@/hooks/use-guarded-submit`. The wrapped handler
MUST be `async` and MUST `await mutateAsync(...)` (NOT `mutate(...)`
fire-and-forget) — the synchronous re-entry guard only covers the handler's
own promise. `mutate()` returns synchronously, so a fire-and-forget call
slips through and the second click of a rapid double-click fires a duplicate
request.

Pattern:

```tsx
const { mutateAsync, isPending, error } = useCreateX();
const { run, inFlight } = useGuardedSubmit(async (values: FormValues) => {
  try {
    await mutateAsync(payload(values));
    navigate(...);
  } catch {
    // global MutationCache error toast handles user-visible feedback
  }
});
// <Form onSubmit={run} isSubmitting={inFlight || isPending} />
```

Rationale: BUG-141 / BUG-145 are the recurring-class precedent. Class fix
at the sanctioned hook location, not per-form `useRef(false)` copies. See
`docs/superpowers/specs/2026-04-27-bug-145-shared-form-save-guard-design.md`.

## Themes and Colors
- Tailwind v4 with CSS custom properties in `globals.css`.
- **Warm Flexoki-inspired palette** — primary is `--color-primary` (`#205EA6` light / `#4385BE` dark, Flexoki blue), and the chart accents come from the Flexoki swatch (chart-1 blue `#4385BE`, chart-2 cyan `#3AA99F`, chart-3 orange `#DA702C`, chart-4 red `#D14D41`, chart-5 lavender `#8B7EC8`, chart-6 olive `#879A39`, chart-7 yellow `#D0A215`, chart-8 magenta `#CE5D97`). Legacy gradient utility classes and the indigo/cyan brand vars have been removed from CSS; `src/lib/colors.ts` keeps `cyan` and `violet` keys as backward-compat aliases (mapped to `--color-primary` and `--color-chart-5`) — prefer the semantic / chart vars for new code.
- Light-mode surfaces use warm parchment tones (`--qv-bg #f2f0e5`, `--qv-surface #fffcf0`); dark mode uses near-black warm greys (`--qv-bg #100f0f`, `--qv-surface #1c1b1a`).
- Surface hierarchy: `--qv-bg` → `--qv-surface` → `--qv-surface-elevated` → `--qv-surface-3`.
- Semantic colors: `--qv-success`, `--qv-danger`, `--qv-warning`, `--qv-info`, `--qv-positive`, `--qv-negative`.
- Chart palette: 8 Flexoki accents via `--color-chart-1` through `--color-chart-8` (same hex values used in light and dark — they're tuned to be legible on both backgrounds).
- Use `useTheme()` for `resolvedTheme`, `useChartColors()` for chart colors with dark mode (returns 8-color `palette` array).
- Dynamic colors: `getColor('profit')` / `getColor('loss')` via `src/lib/colors.ts` (reads CSS vars at runtime, falls back to hard-coded Flexoki hex when the DOM is unavailable, e.g. SSR/tests).
- Micro-interactions: page entrance fade (`qv-page`), staggered children reveal, fade-in (`qv-fade-in`), surface transitions (`transition-surface`).
- Light mode uses an atmospheric warm-tinted radial gradient on `body` and card shadows; dark mode uses border + lightness delta, no shadows.

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
