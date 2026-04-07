# Design Foundation: Warm Palette & Polish

**Date:** 2026-04-07
**Status:** Approved
**Scope:** CSS design tokens, color system, animation polish, one new dependency

## Goal

Shift quovibe's visual foundation from cold institutional (default Tailwind grays) to a warm, Flexoki-inspired palette. Add animated financial digits via `@number-flow/react`. No structural or layout changes — design tokens and polish only.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Color direction | Warm Flexoki-inspired | Biggest perceived quality jump; warm neutrals feel "designed" |
| Motion | `@number-flow/react` only | Single biggest bang-for-buck; no Framer Motion weight |
| Typography | Inter only | Tabular nums built-in; hierarchy via weight/size/opacity |
| Animation improvements | CSS only (snappier timings) | No new deps for animation |

## 1. Color Palette

### Light Mode Surfaces

| Token | Current | Proposed |
|-------|---------|----------|
| `--qv-bg` | `#f4f5f7` (cold gray) | `#f2f0e5` (warm cream) |
| `--qv-surface` | `#ffffff` (pure white) | `#fffcf0` (warm white) |
| `--qv-surface-elevated` | `#f0f1f4` | `#e6e4d9` |
| `--qv-surface-3` | `#e4e5e9` | `#d6d4c8` |
| `--qv-border` | `#d4d6dc` | `#d0cdc2` |
| `--qv-border-strong` | `#b4b7bf` | `#b7b5ac` |
| `--qv-text-primary` | `#09090b` | `#100f0f` |
| `--qv-text-muted` | `#71717a` | `#6f6e69` |
| `--qv-text-faint` | `#a1a1aa` | `#b7b5ac` |

### Dark Mode Surfaces

| Token | Current | Proposed |
|-------|---------|----------|
| `--qv-bg` | `#09090b` (cold zinc) | `#100f0f` (warm black) |
| `--qv-surface` | `#18181b` | `#1c1b1a` |
| `--qv-surface-elevated` | `rgba(39,39,42,0.80)` | `#282726` (solid — opacity layering not needed on warm palette) |
| `--qv-surface-3` | `rgba(63,63,70,0.60)` | `#343331` |
| `--qv-border` | `rgba(255,255,255,0.07)` | `rgba(255,252,240,0.07)` |
| `--qv-border-strong` | `rgba(255,255,255,0.13)` | `rgba(255,252,240,0.12)` |
| `--qv-text-primary` | `#f4f4f5` | `#cecdc3` |
| `--qv-text-muted` | `#a1a1aa` | `#878580` |
| `--qv-text-faint` | `#71717a` | `#575653` |

### Semantic Colors

| Token | Current (Light) | Proposed (Light) | Current (Dark) | Proposed (Dark) |
|-------|----------------|-----------------|----------------|-----------------|
| `--qv-success` | `#0a8f6c` | `#66800b` | `#34d399` | `#99d52a` |
| `--qv-danger` | `#c8222e` | `#af3029` | `#fb7185` | `#d14d41` |
| `--qv-warning` | `#b86e00` | `#ad8301` | `#fbbf24` | `#d0a215` |
| `--qv-info` | `#0284c7` | `#4385be` | `#38bdf8` | `#4385be` |
| `--qv-positive` | `#059669` | `#66800b` | `rgba(52,211,153,0.90)` | `#99d52a` |
| `--qv-negative` | `#dc2626` | `#d14d41` | `rgba(251,113,133,0.90)` | `#d14d41` |

### Chart Palette (8 colors, Flexoki accents)

| Slot | Current (Light) | Proposed (Light) |
|------|----------------|-----------------|
| chart-1 | `hsl(220, 28%, 52%)` | `#4385BE` (blue) |
| chart-2 | `hsl(175, 25%, 48%)` | `#3AA99F` (cyan) |
| chart-3 | `hsl(35, 30%, 52%)` | `#DA702C` (orange) |
| chart-4 | `hsl(350, 25%, 52%)` | `#D14D41` (red) |
| chart-5 | `hsl(245, 25%, 56%)` | `#8B7EC8` (purple) |
| chart-6 | `hsl(155, 22%, 48%)` | `#879A39` (green) |
| chart-7 | `hsl(25, 30%, 52%)` | `#D0A215` (yellow) |
| chart-8 | `hsl(195, 28%, 48%)` | `#CE5D97` (magenta) |

Dark mode: same hex values — Flexoki accents are designed to work on both backgrounds.

### Primary Color

| | Current | Proposed |
|---|---------|----------|
| Light | `hsl(225, 32%, 46%)` | `hsl(225, 25%, 48%)` |
| Dark | `hsl(225, 30%, 52%)` | `hsl(225, 25%, 52%)` |

Slightly desaturated to harmonize with warm neutrals.

## 2. Typography Hierarchy

No new fonts. Hierarchy via weight, size, and the muted-fraction pattern:

| Role | Size | Weight | Color Treatment |
|------|------|--------|----------------|
| Hero number | `text-3xl` (2rem) | 700 | `text-primary` |
| Hero fraction | `text-3xl` | 700 | `text-faint` |
| Card metric value | `text-2xl` (1.5rem) | 600 | Semantic color |
| Card metric fraction | `text-2xl` | 600 | Same color at 50% opacity |
| Section heading | `text-sm` | 500 | `text-muted`, uppercase, `tracking-wider` |
| Body text | `text-sm` | 400 | `text-primary` |
| Table data | `text-[13px]` | 400 | `text-primary`, `tabular-nums` |
| Label / caption | `text-xs` | 500 | `text-faint` |

### Muted Fraction Digits

Every financial number renders decimal separator + fraction digits in a dimmer color:
- Non-colored values: use `--qv-text-faint`
- Colored values (profit/loss): same semantic color at 50% opacity
- Implementation via `@number-flow/react` CSS `::part()` selectors:
  ```css
  number-flow-react::part(decimal),
  number-flow-react::part(fraction) {
    color: var(--qv-text-faint);
  }
  ```
- For colored NumberFlow instances, override with inline style or variant class

## 3. Elevation & Shadows

Same pattern (shadows light, borders dark) with warm-tinted values:

### Light Mode
```css
/* Card */
box-shadow: 0 1px 3px rgba(16,15,15,0.05), 0 4px 12px rgba(16,15,15,0.03);
/* Card hover */
box-shadow: 0 2px 6px rgba(16,15,15,0.07), 0 8px 20px rgba(16,15,15,0.05);
```

### Dark Mode
```css
/* Card */
border-color: rgba(255,252,240,0.07);
/* Card hover */
border-color: rgba(255,252,240,0.12);
```

### Body Gradient (Light Only)
```css
radial-gradient(ellipse 75% 45% at 15% 0%, rgba(100,90,70,0.05), transparent 60%),
radial-gradient(ellipse 55% 35% at 88% 100%, rgba(100,90,70,0.03), transparent 55%)
```

## 4. Animations

### Improved Timings

| Animation | Current | Proposed |
|-----------|---------|----------|
| Page entrance | 150ms fade | 200ms fade + `translateY(8px)` |
| Widget stagger | 500ms, 60ms delay | 400ms, 50ms delay |
| Skeleton shimmer | unchanged | unchanged |
| Fade-in | 300ms | unchanged |
| Surface transitions | 150ms | unchanged |

### `@number-flow/react` Integration

- **New dependency:** `@number-flow/react` (lightweight, ~5KB gzipped)
- Replace `useCountUp` hook usage with `<NumberFlow>` component
- Apply muted-fraction CSS globally
- Privacy mode: conditionally render `••••••` instead of `<NumberFlow>` when `isPrivate`
- Format config: `{ style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }`

### Page Entrance (Updated Keyframes)
```css
@keyframes qv-page-enter {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}
```
Duration: 200ms ease-out (was 150ms opacity-only).

### Widget Stagger (Updated Keyframes)
Duration: 400ms (was 500ms). Delay: `index * 50ms` (was 60ms).

## 5. Atmospheric Effects

### Frosted Glass Sticky Header

TopBar gains scroll-aware frosted glass effect:
- **Default (not scrolled):** transparent background, no border
- **Scrolled:** `bg-background/80 backdrop-blur-xl border-b border-border shadow-sm`
- **Transition:** 300ms ease-out
- **Detection:** scroll event on the `<main>` container (the TopBar's sibling), tracked via ref or context
- **Implementation:** Add `isScrolled` state to TopBar (or Shell), toggle class conditionally

## 6. Files Changed

### `globals.css`
- All `--qv-*` token values (light + dark)
- All `--color-chart-*` values
- `--color-primary` and `--color-primary-foreground`
- Shadow values in `@layer base`
- Body gradient values
- Keyframe timings (`qv-page-enter`, `qv-stagger-in`)
- New CSS rules for `number-flow-react::part()` selectors
- Ring color updates

### `package.json` (packages/web)
- Add `@number-flow/react` dependency

### Components (targeted updates)
- `CurrencyDisplay.tsx` — integrate `<NumberFlow>` with muted-fraction styling
- `MetricCard.tsx` — integrate `<NumberFlow>` for metric values
- Widget value displays — replace `useCountUp` with `<NumberFlow>`
- `TopBar.tsx` — add frosted glass scroll behavior
- `Shell.tsx` — pass scroll ref or context for TopBar awareness
- `use-chart-colors.ts` — update any hardcoded fallback colors
- `colors.ts` — update fallback values

### Potentially removable
- `useCountUp` hook — replaced by `@number-flow/react` (verify no other consumers first)

## 7. What This Does NOT Change

- Layout structure (sidebar, grid, page structure)
- Component architecture
- Routing
- Data flow / React Query hooks
- Chart library (lightweight-charts / recharts)
- Business logic
- i18n
- Responsive breakpoints
