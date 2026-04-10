# Design Foundation: Warm Palette & Polish — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Shift quovibe's visual foundation from cold institutional grays to warm Flexoki-inspired palette, add animated financial digits via `@number-flow/react`, and polish animations.

**Architecture:** All changes are CSS token swaps in `globals.css`, color utility fallback updates, a new `@number-flow/react` dependency replacing the custom `useCountUp` hook across 17 widget files + MetricCard, and a frosted glass TopBar. No structural or layout changes.

**Tech Stack:** `@number-flow/react`, CSS custom properties, Tailwind v4

**Spec:** `docs/superpowers/specs/2026-04-07-design-foundation-design.md`

---

## File Structure

| Category | File | Action |
|----------|------|--------|
| CSS tokens | `packages/web/src/globals.css` | Modify — all color tokens, shadows, gradients, keyframes |
| Color utils | `packages/web/src/lib/colors.ts` | Modify — update FALLBACK hex values |
| Chart colors hook | `packages/web/src/hooks/use-chart-colors.ts` | Modify — update fallback hex values |
| Package config | `packages/web/package.json` | Modify — add `@number-flow/react` |
| Shared component | `packages/web/src/components/shared/CurrencyDisplay.tsx` | Modify — integrate NumberFlow |
| Shared component | `packages/web/src/components/shared/MetricCard.tsx` | Modify — remove useCountUp, use raw values |
| Layout | `packages/web/src/components/layout/TopBar.tsx` | Modify — frosted glass scroll behavior |
| Layout | `packages/web/src/components/layout/Shell.tsx` | Modify — scroll ref for TopBar |
| Widgets (17 files) | `packages/web/src/components/domain/widgets/Widget*.tsx` | Modify — replace useCountUp with NumberFlow |
| Hook (delete) | `packages/web/src/hooks/use-count-up.ts` | Delete — replaced by @number-flow/react |

---

### Task 1: Install dependency and update CSS tokens

**Files:**
- Modify: `packages/web/package.json`
- Modify: `packages/web/src/globals.css`

- [ ] **Step 1: Install @number-flow/react**

```bash
cd packages/web && pnpm add @number-flow/react
```

- [ ] **Step 2: Update light mode surface tokens in globals.css**

In `packages/web/src/globals.css`, replace the light mode surfaces block (lines 14–24):

```css
/* OLD */
--qv-bg: #f4f5f7;
--qv-surface: #ffffff;
--qv-surface-elevated: #f0f1f4;
--qv-surface-3: #e4e5e9;
--qv-border: #d4d6dc;
--qv-border-strong: #b4b7bf;
--qv-text-primary: #09090b;
--qv-text-muted: #71717a;
--qv-text-faint: #a1a1aa;
```

```css
/* NEW */
--qv-bg: #f2f0e5;
--qv-surface: #fffcf0;
--qv-surface-elevated: #e6e4d9;
--qv-surface-3: #d6d4c8;
--qv-border: #d0cdc2;
--qv-border-strong: #b7b5ac;
--qv-text-primary: #100f0f;
--qv-text-muted: #6f6e69;
--qv-text-faint: #b7b5ac;
```

- [ ] **Step 3: Update light mode semantic tokens**

Replace (lines 26–31):

```css
/* OLD */
--qv-success: #0a8f6c;
--qv-danger: #c8222e;
--qv-warning: #b86e00;
--qv-info: #0284c7;
--qv-positive: #059669;
--qv-negative: #dc2626;
```

```css
/* NEW */
--qv-success: #66800b;
--qv-danger: #af3029;
--qv-warning: #ad8301;
--qv-info: #4385be;
--qv-positive: #66800b;
--qv-negative: #d14d41;
```

- [ ] **Step 4: Update primary color**

Replace (line 42):

```css
/* OLD */
--color-primary: hsl(225, 32%, 46%);
```

```css
/* NEW */
--color-primary: hsl(225, 25%, 48%);
```

And ring color (line 53):

```css
/* OLD */
--color-ring: hsl(225 30% 50% / 0.35);
```

```css
/* NEW */
--color-ring: hsl(225 25% 48% / 0.35);
```

- [ ] **Step 5: Update chart palette (light)**

Replace (lines 56–63):

```css
/* OLD */
--color-chart-1: hsl(220, 28%, 52%);
--color-chart-2: hsl(175, 25%, 48%);
--color-chart-3: hsl(35, 30%, 52%);
--color-chart-4: hsl(350, 25%, 52%);
--color-chart-5: hsl(245, 25%, 56%);
--color-chart-6: hsl(155, 22%, 48%);
--color-chart-7: hsl(25, 30%, 52%);
--color-chart-8: hsl(195, 28%, 48%);
```

```css
/* NEW — Flexoki accents */
--color-chart-1: #4385BE;
--color-chart-2: #3AA99F;
--color-chart-3: #DA702C;
--color-chart-4: #D14D41;
--color-chart-5: #8B7EC8;
--color-chart-6: #879A39;
--color-chart-7: #D0A215;
--color-chart-8: #CE5D97;
```

- [ ] **Step 6: Update sidebar tokens**

Replace (lines 66–73):

```css
/* OLD */
--color-sidebar: var(--qv-surface);
--color-sidebar-foreground: var(--qv-text-primary);
--color-sidebar-primary: hsl(225, 32%, 46%);
--color-sidebar-primary-foreground: #ffffff;
--color-sidebar-accent: var(--qv-surface-elevated);
--color-sidebar-accent-foreground: var(--qv-text-primary);
--color-sidebar-border: var(--qv-border);
--color-sidebar-ring: hsl(225, 30%, 50%);
```

```css
/* NEW */
--color-sidebar: var(--qv-surface);
--color-sidebar-foreground: var(--qv-text-primary);
--color-sidebar-primary: hsl(225, 25%, 48%);
--color-sidebar-primary-foreground: #ffffff;
--color-sidebar-accent: var(--qv-surface-elevated);
--color-sidebar-accent-foreground: var(--qv-text-primary);
--color-sidebar-border: var(--qv-border);
--color-sidebar-ring: hsl(225, 25%, 48%);
```

- [ ] **Step 7: Update dark mode tokens**

Replace the dark mode surfaces block (lines 95–107):

```css
/* OLD */
--qv-bg: #09090b;
--qv-surface: #18181b;
--qv-surface-elevated: rgba(39, 39, 42, 0.80);
--qv-surface-3: rgba(63, 63, 70, 0.60);
--qv-border: rgba(255, 255, 255, 0.07);
--qv-border-strong: rgba(255, 255, 255, 0.13);
--qv-text-primary: #f4f4f5;
--qv-text-muted: #a1a1aa;
--qv-text-faint: #71717a;
```

```css
/* NEW */
--qv-bg: #100f0f;
--qv-surface: #1c1b1a;
--qv-surface-elevated: #282726;
--qv-surface-3: #343331;
--qv-border: rgba(255, 252, 240, 0.07);
--qv-border-strong: rgba(255, 252, 240, 0.12);
--qv-text-primary: #cecdc3;
--qv-text-muted: #878580;
--qv-text-faint: #575653;
```

- [ ] **Step 8: Update dark mode semantic + primary + chart tokens**

Replace dark semantic (lines 110–115):

```css
/* OLD */
--qv-success: #34d399;
--qv-danger: #fb7185;
--qv-warning: #fbbf24;
--qv-info: #38bdf8;
--qv-positive: rgba(52, 211, 153, 0.90);
--qv-negative: rgba(251, 113, 133, 0.90);
```

```css
/* NEW */
--qv-success: #99d52a;
--qv-danger: #d14d41;
--qv-warning: #d0a215;
--qv-info: #4385be;
--qv-positive: #99d52a;
--qv-negative: #d14d41;
```

Replace dark primary (line 118):

```css
/* OLD */
--color-primary: hsl(225, 30%, 52%);
```

```css
/* NEW */
--color-primary: hsl(225, 25%, 52%);
```

Replace dark ring (line 120):

```css
/* OLD */
--color-ring: hsl(225 30% 55% / 0.35);
```

```css
/* NEW */
--color-ring: hsl(225 25% 52% / 0.35);
```

Replace dark chart palette (lines 123–130):

```css
/* OLD */
--color-chart-1: hsl(220, 33%, 60%);
--color-chart-2: hsl(175, 30%, 56%);
--color-chart-3: hsl(35, 35%, 60%);
--color-chart-4: hsl(350, 30%, 60%);
--color-chart-5: hsl(245, 30%, 64%);
--color-chart-6: hsl(155, 27%, 56%);
--color-chart-7: hsl(25, 35%, 60%);
--color-chart-8: hsl(195, 33%, 56%);
```

```css
/* NEW — same as light (Flexoki accents work on both) */
--color-chart-1: #4385BE;
--color-chart-2: #3AA99F;
--color-chart-3: #DA702C;
--color-chart-4: #D14D41;
--color-chart-5: #8B7EC8;
--color-chart-6: #879A39;
--color-chart-7: #D0A215;
--color-chart-8: #CE5D97;
```

Replace dark sidebar primary (lines 133–134):

```css
/* OLD */
--color-sidebar-primary: hsl(225, 30%, 52%);
```

```css
/* NEW */
--color-sidebar-primary: hsl(225, 25%, 52%);
```

- [ ] **Step 9: Update shadows to warm tint**

Replace light mode card shadows (lines 179–184):

```css
/* OLD */
html:not(.dark) [data-slot="card"] {
  box-shadow: 0 1px 3px rgba(9, 9, 11, 0.06), 0 4px 12px rgba(9, 9, 11, 0.04);
}

html:not(.dark) [data-slot="card"]:hover {
  box-shadow: 0 2px 6px rgba(9, 9, 11, 0.08), 0 8px 20px rgba(9, 9, 11, 0.06);
}
```

```css
/* NEW */
html:not(.dark) [data-slot="card"] {
  box-shadow: 0 1px 3px rgba(16, 15, 15, 0.05), 0 4px 12px rgba(16, 15, 15, 0.03);
}

html:not(.dark) [data-slot="card"]:hover {
  box-shadow: 0 2px 6px rgba(16, 15, 15, 0.07), 0 8px 20px rgba(16, 15, 15, 0.05);
}
```

- [ ] **Step 10: Update body gradient to warm tint**

Replace light mode body gradient (lines 172–175):

```css
/* OLD */
html:not(.dark) body {
  background-image:
    radial-gradient(ellipse 75% 45% at 15% 0%, rgba(80, 95, 143, 0.06) 0%, transparent 60%),
    radial-gradient(ellipse 55% 35% at 88% 100%, rgba(80, 95, 143, 0.04) 0%, transparent 55%);
}
```

```css
/* NEW */
html:not(.dark) body {
  background-image:
    radial-gradient(ellipse 75% 45% at 15% 0%, rgba(100, 90, 70, 0.05) 0%, transparent 60%),
    radial-gradient(ellipse 55% 35% at 88% 100%, rgba(100, 90, 70, 0.03) 0%, transparent 55%);
}
```

- [ ] **Step 11: Update animation keyframes**

Replace page entrance keyframe (lines 206–209):

```css
/* OLD */
@keyframes qv-page-enter {
  from { opacity: 0; }
  to { opacity: 1; }
}
@utility qv-page {
  animation: qv-page-enter 150ms ease-out;
}
```

```css
/* NEW */
@keyframes qv-page-enter {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}
@utility qv-page {
  animation: qv-page-enter 200ms ease-out;
}
```

Replace stagger keyframe duration comment — the keyframe definition stays the same but widgets will use 400ms/50ms (changed in widget shell, not here).

- [ ] **Step 12: Add NumberFlow muted-fraction CSS**

Add after the `@utility qv-fade-in` block (after line 239):

```css
/* Muted fraction digits for financial values (number-flow) */
number-flow-react.muted-fraction::part(decimal),
number-flow-react.muted-fraction::part(fraction) {
  color: var(--qv-text-faint);
}
```

- [ ] **Step 13: Verify build**

```bash
cd /c/quovibe && pnpm build --filter @quovibe/web
```

Expected: Build succeeds. The CSS changes are purely token swaps so no breakage expected.

- [ ] **Step 14: Commit**

```bash
git add packages/web/package.json packages/web/pnpm-lock.yaml packages/web/src/globals.css
git commit -m "style: warm Flexoki palette + number-flow dep + animation polish"
```

---

### Task 2: Update color utility fallbacks

**Files:**
- Modify: `packages/web/src/lib/colors.ts:9-17`
- Modify: `packages/web/src/hooks/use-chart-colors.ts:15-28`

- [ ] **Step 1: Update FALLBACK in colors.ts**

In `packages/web/src/lib/colors.ts`, replace the FALLBACK object (lines 9–18):

```typescript
/* OLD */
const FALLBACK = {
  profit: '#059669',
  loss: '#dc2626',
  dividend: 'hsl(220, 45%, 55%)',
  cyan: 'hsl(225, 32%, 46%)',
  violet: 'hsl(245, 40%, 60%)',
  success: '#059669',
  danger: '#dc2626',
  warning: '#b86e00',
} as const;
```

```typescript
/* NEW */
const FALLBACK = {
  profit: '#66800b',
  loss: '#d14d41',
  dividend: '#4385BE',
  cyan: 'hsl(225, 25%, 48%)',
  violet: '#8B7EC8',
  success: '#66800b',
  danger: '#af3029',
  warning: '#ad8301',
} as const;
```

- [ ] **Step 2: Update fallbacks in use-chart-colors.ts**

In `packages/web/src/hooks/use-chart-colors.ts`, replace the fallback values (lines 15–29):

```typescript
/* OLD */
const profit   = getCssVar('--qv-success')  || (isDark ? '#34d399' : '#059669');
const loss     = getCssVar('--qv-danger')   || (isDark ? '#fb7185' : '#dc2626');
const warning  = getCssVar('--qv-warning')  || (isDark ? '#fbbf24' : '#b86e00');
const success  = profit;
const danger   = loss;
const dividend = getCssVar('--color-chart-1') || (isDark ? 'hsl(220,33%,60%)' : 'hsl(220,28%,52%)');
const interest = getCssVar('--color-chart-5') || (isDark ? 'hsl(245,30%,64%)' : 'hsl(245,25%,56%)');
const cyan     = getCssVar('--color-primary') || (isDark ? 'hsl(225,30%,52%)' : 'hsl(225,32%,46%)');
const violet   = interest;

// Build palette from CSS vars
const fallbacks = [
  'hsl(220,28%,52%)', 'hsl(175,25%,48%)', 'hsl(35,30%,52%)', 'hsl(350,25%,52%)',
  'hsl(245,25%,56%)', 'hsl(155,22%,48%)', 'hsl(25,30%,52%)', 'hsl(195,28%,48%)',
];
```

```typescript
/* NEW */
const profit   = getCssVar('--qv-success')  || (isDark ? '#99d52a' : '#66800b');
const loss     = getCssVar('--qv-danger')   || (isDark ? '#d14d41' : '#af3029');
const warning  = getCssVar('--qv-warning')  || (isDark ? '#d0a215' : '#ad8301');
const success  = profit;
const danger   = loss;
const dividend = getCssVar('--color-chart-1') || '#4385BE';
const interest = getCssVar('--color-chart-5') || '#8B7EC8';
const cyan     = getCssVar('--color-primary') || 'hsl(225,25%,48%)';
const violet   = interest;

// Build palette from CSS vars
const fallbacks = [
  '#4385BE', '#3AA99F', '#DA702C', '#D14D41',
  '#8B7EC8', '#879A39', '#D0A215', '#CE5D97',
];
```

- [ ] **Step 3: Verify build**

```bash
cd /c/quovibe && pnpm build --filter @quovibe/web
```

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/lib/colors.ts packages/web/src/hooks/use-chart-colors.ts
git commit -m "style: update color utility fallbacks to warm palette"
```

---

### Task 3: Integrate NumberFlow into CurrencyDisplay

**Files:**
- Modify: `packages/web/src/components/shared/CurrencyDisplay.tsx`

The key insight: `CurrencyDisplay` currently receives a pre-animated value from `useCountUp` and formats it with `formatCurrency()`. With NumberFlow, it will receive the raw target value and NumberFlow handles both animation and formatting. The `formatCurrency` function uses `i18n.language` for locale — NumberFlow needs the same locale.

- [ ] **Step 1: Rewrite CurrencyDisplay with NumberFlow**

Replace the entire file `packages/web/src/components/shared/CurrencyDisplay.tsx`:

```tsx
import NumberFlow from '@number-flow/react';
import { usePrivacy } from '@/context/privacy-context';
import { useDisplayPreferences } from '@/hooks/use-display-preferences';
import { cn } from '@/lib/utils';
import i18n from '@/i18n';

interface CurrencyDisplayProps {
  value: number;
  currency?: string | null;
  colorize?: boolean;
  /** Override sign for color: 1 = green, -1 = red. Omit to derive from value. */
  colorSign?: 1 | -1;
  className?: string;
  /** Override showCurrencyCode from display preferences */
  showCurrencyCode?: boolean;
  /** Disable NumberFlow animation (render static text) */
  animated?: boolean;
}

export function CurrencyDisplay({
  value,
  currency = 'EUR',
  colorize = false,
  colorSign,
  className,
  showCurrencyCode: showCurrencyCodeProp,
  animated = true,
}: CurrencyDisplayProps) {
  const { isPrivate } = usePrivacy();
  const { showCurrencyCode: showCurrencyCodePref } = useDisplayPreferences();
  const showCurrencyCode = showCurrencyCodeProp ?? showCurrencyCodePref;

  const colorClass =
    !isPrivate && colorize
      ? (colorSign ?? value) > 0
        ? 'text-[var(--qv-positive)]'
        : (colorSign ?? value) < 0
          ? 'text-[var(--qv-negative)]'
          : undefined
      : undefined;

  if (isPrivate) {
    return <span className={cn('tabular-nums', colorClass, className)}>••••••</span>;
  }

  const currencyCode = currency || 'EUR';

  // When showCurrencyCode is true, format as "1,234.56 EUR" (no currency symbol)
  if (showCurrencyCode) {
    return (
      <span className={cn('tabular-nums', colorClass, className)}>
        <NumberFlow
          className="muted-fraction"
          value={value}
          animated={animated}
          locales={i18n.language}
          format={{
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          }}
        />
        {' '}{currencyCode}
      </span>
    );
  }

  return (
    <span className={cn('tabular-nums', colorClass, className)}>
      <NumberFlow
        className="muted-fraction"
        value={value}
        animated={animated}
        locales={i18n.language}
        format={{
          style: 'currency',
          currency: currencyCode,
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }}
      />
    </span>
  );
}
```

- [ ] **Step 2: Verify build**

```bash
cd /c/quovibe && pnpm build --filter @quovibe/web
```

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/shared/CurrencyDisplay.tsx
git commit -m "feat: integrate NumberFlow into CurrencyDisplay for animated digits"
```

---

### Task 4: Update MetricCard to use raw values

**Files:**
- Modify: `packages/web/src/components/shared/MetricCard.tsx`

MetricCard used `useCountUp` to animate its primary value. Now that CurrencyDisplay handles animation via NumberFlow, MetricCard passes the raw value. For percentage format, MetricCard will use NumberFlow directly.

- [ ] **Step 1: Update MetricCard**

In `packages/web/src/components/shared/MetricCard.tsx`:

Remove the import (line 12):
```typescript
import { useCountUp } from '@/hooks/use-count-up';
```

Add NumberFlow import:
```typescript
import NumberFlow from '@number-flow/react';
import i18n from '@/i18n';
```

Replace line 48:
```typescript
/* OLD */
const animatedPrimary = useCountUp(primary, 600, !isPrivate);
```
```typescript
/* NEW (delete this line entirely — pass `primary` directly) */
```

Replace all occurrences of `animatedPrimary` with `primary` in the render function.

In the percentage render block (lines 79–85), replace:
```tsx
/* OLD */
if (definition.format === 'percentage') {
  return (
    <span className="text-2xl font-semibold tabular-nums" style={{ color: valueColor }}>
      {formatPercentage(animatedPrimary)}
    </span>
  );
}
```

```tsx
/* NEW */
if (definition.format === 'percentage') {
  return (
    <span className="text-2xl font-semibold tabular-nums" style={{ color: valueColor }}>
      <NumberFlow
        className="muted-fraction"
        value={primary}
        locales={i18n.language}
        format={{
          style: 'percent',
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }}
      />
    </span>
  );
}
```

In the `currency+pct` secondary block (lines 95–108), replace:
```tsx
/* OLD */
{secondary !== undefined && (
  <span
    className="text-sm tabular-nums"
    style={{
      color:
        definition.colorize
          ? secondary >= 0
            ? COLORS.profit
            : COLORS.loss
          : undefined,
    }}
  >
    {formatPercentage(secondary)}
  </span>
)}
```

```tsx
/* NEW */
{secondary !== undefined && (
  <span
    className="text-sm tabular-nums"
    style={{
      color:
        definition.colorize
          ? secondary >= 0
            ? COLORS.profit
            : COLORS.loss
          : undefined,
    }}
  >
    <NumberFlow
      className="muted-fraction"
      value={secondary}
      locales={i18n.language}
      format={{
        style: 'percent',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }}
    />
  </span>
)}
```

Remove unused import if `formatPercentage` is no longer used in this file.

- [ ] **Step 2: Verify build**

```bash
cd /c/quovibe && pnpm build --filter @quovibe/web
```

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/shared/MetricCard.tsx
git commit -m "refactor: replace useCountUp with NumberFlow in MetricCard"
```

---

### Task 5: Update currency-only widgets

**Files:**
- Modify: `packages/web/src/components/domain/widgets/WidgetMarketValue.tsx`
- Modify: `packages/web/src/components/domain/widgets/WidgetInvestedCapital.tsx`
- Modify: `packages/web/src/components/domain/widgets/WidgetAllTimeHigh.tsx`
- Modify: `packages/web/src/components/domain/widgets/WidgetAbsoluteChange.tsx`

These widgets all follow the same pattern: `useCountUp(value, 1200, !isPrivate)` → pass animated value to `<CurrencyDisplay>`. Since CurrencyDisplay now handles animation internally, just remove `useCountUp` and pass the raw value.

- [ ] **Step 1: Update WidgetMarketValue.tsx**

Remove import:
```typescript
import { useCountUp } from '@/hooks/use-count-up';
```

Replace line 14:
```typescript
/* OLD */
const animated = useCountUp(value, 1200, !isPrivate);
```
```typescript
/* DELETE this line */
```

Replace line 37:
```tsx
/* OLD */
<CurrencyDisplay
  value={animated}
  className="text-2xl font-semibold tabular-nums"
/>
```
```tsx
/* NEW */
<CurrencyDisplay
  value={value}
  className="text-2xl font-semibold tabular-nums"
/>
```

Also remove the `usePrivacy` import if it's only used for useCountUp's `enabled` param. Check — in WidgetMarketValue, `isPrivate` is not used elsewhere in the JSX (CurrencyDisplay handles privacy internally). So remove:
```typescript
import { usePrivacy } from '@/context/privacy-context';
```
And:
```typescript
const { isPrivate } = usePrivacy();
```

- [ ] **Step 2: Apply same pattern to WidgetInvestedCapital.tsx**

Same changes: remove `useCountUp` import, remove `useCountUp` call, pass raw `value` to `CurrencyDisplay`. Remove `usePrivacy` if only used for useCountUp's enabled param.

- [ ] **Step 3: Apply same pattern to WidgetAllTimeHigh.tsx**

Same changes.

- [ ] **Step 4: Apply same pattern to WidgetAbsoluteChange.tsx**

Same changes. Note: this widget uses `colorize` prop on CurrencyDisplay, which is fine — keep it.

- [ ] **Step 5: Verify build**

```bash
cd /c/quovibe && pnpm build --filter @quovibe/web
```

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/components/domain/widgets/WidgetMarketValue.tsx \
       packages/web/src/components/domain/widgets/WidgetInvestedCapital.tsx \
       packages/web/src/components/domain/widgets/WidgetAllTimeHigh.tsx \
       packages/web/src/components/domain/widgets/WidgetAbsoluteChange.tsx
git commit -m "refactor: remove useCountUp from currency-only widgets"
```

---

### Task 6: Update percentage-only widgets

**Files:**
- Modify: `packages/web/src/components/domain/widgets/WidgetTtwror.tsx`
- Modify: `packages/web/src/components/domain/widgets/WidgetTtwrorPa.tsx`
- Modify: `packages/web/src/components/domain/widgets/WidgetVolatility.tsx`
- Modify: `packages/web/src/components/domain/widgets/WidgetCashDrag.tsx`
- Modify: `packages/web/src/components/domain/widgets/WidgetMaxDrawdown.tsx`
- Modify: `packages/web/src/components/domain/widgets/WidgetSemivariance.tsx`
- Modify: `packages/web/src/components/domain/widgets/WidgetIrr.tsx`
- Modify: `packages/web/src/components/domain/widgets/WidgetCurrentDrawdown.tsx`

These widgets use `useCountUp` → `formatPercentage(animated)`. Replace with `<NumberFlow>` for animated percentage display.

- [ ] **Step 1: Update WidgetTtwror.tsx**

Replace imports:
```typescript
/* OLD */
import { useCountUp } from '@/hooks/use-count-up';
```
```typescript
/* NEW */
import NumberFlow from '@number-flow/react';
import i18n from '@/i18n';
```

Remove `formatPercentage` import if only used for the animated value.

Remove line 15:
```typescript
const animated = useCountUp(value, 1200, !isPrivate);
```

Replace the value display (lines 37–38):
```tsx
/* OLD */
<span className="text-2xl font-semibold tabular-nums" style={getValueColorStyle(value, isPrivate)}>
  {isPrivate ? '••••••' : formatPercentage(animated)}
</span>
```

```tsx
/* NEW */
<span className="text-2xl font-semibold tabular-nums" style={getValueColorStyle(value, isPrivate)}>
  {isPrivate ? '••••••' : (
    <NumberFlow
      className="muted-fraction"
      value={value}
      locales={i18n.language}
      format={{ style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2 }}
    />
  )}
</span>
```

- [ ] **Step 2: Apply same pattern to WidgetTtwrorPa.tsx, WidgetMaxDrawdown.tsx, WidgetIrr.tsx**

Same pattern: remove `useCountUp`, add `NumberFlow` import, replace `formatPercentage(animated)` with `<NumberFlow>`. These widgets use `getValueColorStyle` for coloring — keep that unchanged.

For WidgetIrr: keep the convergence check logic (lines 35–42) as-is. Only change the percentage display.

- [ ] **Step 3: Apply same pattern to WidgetVolatility.tsx, WidgetCashDrag.tsx, WidgetSemivariance.tsx**

Same pattern but these have **no color styling** — just plain `formatPercentage(animated)`:

```tsx
/* OLD */
<span className="text-2xl font-semibold tabular-nums">
  {isPrivate ? '••••••' : formatPercentage(animated)}
</span>
```

```tsx
/* NEW */
<span className="text-2xl font-semibold tabular-nums">
  {isPrivate ? '••••••' : (
    <NumberFlow
      className="muted-fraction"
      value={value}
      locales={i18n.language}
      format={{ style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2 }}
    />
  )}
</span>
```

- [ ] **Step 4: Update WidgetCurrentDrawdown.tsx**

This widget uses `getColor('danger')` for coloring, not `getValueColorStyle`. Same NumberFlow pattern:

Remove `useCountUp` import, add `NumberFlow` + `i18n` imports.

Remove:
```typescript
const animated = useCountUp(displayVal, 1200, !isPrivate);
```

Replace display:
```tsx
/* OLD */
<span
  className="text-2xl font-semibold tabular-nums"
  style={{ color: isPrivate || cd === 0 ? undefined : getColor('danger') }}
>
  {isPrivate ? '••••••' : formatPercentage(animated)}
</span>
```

```tsx
/* NEW */
<span
  className="text-2xl font-semibold tabular-nums"
  style={{ color: isPrivate || cd === 0 ? undefined : getColor('danger') }}
>
  {isPrivate ? '••••••' : (
    <NumberFlow
      className="muted-fraction"
      value={displayVal}
      locales={i18n.language}
      format={{ style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2 }}
    />
  )}
</span>
```

- [ ] **Step 5: Verify build**

```bash
cd /c/quovibe && pnpm build --filter @quovibe/web
```

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/components/domain/widgets/WidgetTtwror.tsx \
       packages/web/src/components/domain/widgets/WidgetTtwrorPa.tsx \
       packages/web/src/components/domain/widgets/WidgetVolatility.tsx \
       packages/web/src/components/domain/widgets/WidgetCashDrag.tsx \
       packages/web/src/components/domain/widgets/WidgetMaxDrawdown.tsx \
       packages/web/src/components/domain/widgets/WidgetSemivariance.tsx \
       packages/web/src/components/domain/widgets/WidgetIrr.tsx \
       packages/web/src/components/domain/widgets/WidgetCurrentDrawdown.tsx
git commit -m "refactor: replace useCountUp with NumberFlow in percentage widgets"
```

---

### Task 7: Update dual-value and special widgets

**Files:**
- Modify: `packages/web/src/components/domain/widgets/WidgetAbsolutePerformance.tsx`
- Modify: `packages/web/src/components/domain/widgets/WidgetDelta.tsx`
- Modify: `packages/web/src/components/domain/widgets/WidgetSharpeRatio.tsx`
- Modify: `packages/web/src/components/domain/widgets/WidgetMaxDrawdownDuration.tsx`

- [ ] **Step 1: Update WidgetAbsolutePerformance.tsx**

This widget uses two `useCountUp` calls: one for currency (passed to CurrencyDisplay) and one for percentage.

Remove imports:
```typescript
import { useCountUp } from '@/hooks/use-count-up';
```

Add:
```typescript
import NumberFlow from '@number-flow/react';
import i18n from '@/i18n';
```

Remove lines 17–18:
```typescript
const animatedPerf = useCountUp(absPerf, 1200, !isPrivate);
const animatedPct = useCountUp(absPerfPct, 1200, !isPrivate);
```

Replace CurrencyDisplay value:
```tsx
/* OLD */
<CurrencyDisplay
  value={animatedPerf}
  colorize
  className="text-2xl font-semibold tabular-nums"
/>
```
```tsx
/* NEW */
<CurrencyDisplay
  value={absPerf}
  colorize
  className="text-2xl font-semibold tabular-nums"
/>
```

Replace percentage display:
```tsx
/* OLD */
<span
  className="text-sm tabular-nums"
  style={getValueColorStyle(absPerfPct, isPrivate)}
>
  {isPrivate ? '••••••' : formatPercentage(animatedPct)}
</span>
```
```tsx
/* NEW */
<span
  className="text-sm tabular-nums"
  style={getValueColorStyle(absPerfPct, isPrivate)}
>
  {isPrivate ? '••••••' : (
    <NumberFlow
      className="muted-fraction"
      value={absPerfPct}
      locales={i18n.language}
      format={{ style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2 }}
    />
  )}
</span>
```

- [ ] **Step 2: Update WidgetDelta.tsx**

Same dual-value pattern as WidgetAbsolutePerformance. Same changes: remove `useCountUp`, pass raw values, wrap percentage in `<NumberFlow>`.

- [ ] **Step 3: Update WidgetSharpeRatio.tsx**

This widget uses `useCountUp` + `formatQuote` (not `formatPercentage`). The Sharpe ratio is a plain number, not a percentage.

Remove `useCountUp` import, add `NumberFlow` + `i18n` imports.

Remove:
```typescript
const animatedSharpe = useCountUp(sharpe ?? 0, 1200, !isPrivate && sharpe !== null);
```

Replace display:
```tsx
/* OLD */
{isPrivate ? '••••••' : sharpe !== null ? formatQuote(animatedSharpe) : '—'}
```

```tsx
/* NEW */
{isPrivate ? '••••••' : sharpe !== null ? (
  <NumberFlow
    className="muted-fraction"
    value={sharpe}
    locales={i18n.language}
    format={{ minimumFractionDigits: 2, maximumFractionDigits: 2 }}
  />
) : '—'}
```

Remove `formatQuote` import if no longer used.

- [ ] **Step 4: Update WidgetMaxDrawdownDuration.tsx**

This widget displays integer days using i18n pluralization: `t('widget.days', { count })` returns `"42 days"` / `"1 day"`. Since the i18n key embeds `{{count}}` in the string and NumberFlow can't split that, simply remove the animation and display the static value. Integer days don't benefit from digit morphing the way financial values do.

Remove `useCountUp` import.

Remove:
```typescript
const animated = useCountUp(days, 1200, !isPrivate);
const animatedDays = Math.round(animated); // native-ok
```

Replace display:
```tsx
/* OLD */
<span className="text-2xl font-semibold tabular-nums">
  {isPrivate ? '••••••' : t('widget.days', { count: animatedDays })}
</span>
```

```tsx
/* NEW */
<span className="text-2xl font-semibold tabular-nums">
  {isPrivate ? '••••••' : t('widget.days', { count: days })}
</span>
```

- [ ] **Step 5: Verify build**

```bash
cd /c/quovibe && pnpm build --filter @quovibe/web
```

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/components/domain/widgets/WidgetAbsolutePerformance.tsx \
       packages/web/src/components/domain/widgets/WidgetDelta.tsx \
       packages/web/src/components/domain/widgets/WidgetSharpeRatio.tsx \
       packages/web/src/components/domain/widgets/WidgetMaxDrawdownDuration.tsx
git commit -m "refactor: replace useCountUp with NumberFlow in dual-value and special widgets"
```

---

### Task 8: Frosted glass sticky TopBar

**Files:**
- Modify: `packages/web/src/components/layout/Shell.tsx`
- Modify: `packages/web/src/components/layout/TopBar.tsx`

- [ ] **Step 1: Add scroll detection to Shell.tsx**

In `packages/web/src/components/layout/Shell.tsx`, add a ref for the main element and scroll state:

Add import:
```typescript
import { useState, useEffect, useRef, useCallback } from 'react';
```

Add inside the `Shell` component, before the return:
```typescript
const mainRef = useRef<HTMLElement>(null);
const [isScrolled, setIsScrolled] = useState(false);

const handleScroll = useCallback(() => {
  if (mainRef.current) {
    setIsScrolled(mainRef.current.scrollTop > 0);
  }
}, []);
```

Add the ref to the `<main>` element and pass `isScrolled` to TopBar:
```tsx
/* OLD */
<TopBar onMenuClick={() => setDrawerOpen(true)} />
<main className="flex-1 overflow-y-auto scroll-smooth [scrollbar-gutter:stable] px-4 py-5 pb-24 md:px-6 md:pb-6 lg:px-8 lg:py-6">
```

```tsx
/* NEW */
<TopBar onMenuClick={() => setDrawerOpen(true)} isScrolled={isScrolled} />
<main
  ref={mainRef}
  onScroll={handleScroll}
  className="flex-1 overflow-y-auto scroll-smooth [scrollbar-gutter:stable] px-4 py-5 pb-24 md:px-6 md:pb-6 lg:px-8 lg:py-6"
>
```

- [ ] **Step 2: Update TopBar to accept isScrolled and apply frosted glass**

In `packages/web/src/components/layout/TopBar.tsx`, update the props interface:

```typescript
/* OLD */
interface TopBarProps {
  onMenuClick?: () => void;
}

export function TopBar({ onMenuClick }: TopBarProps) {
```

```typescript
/* NEW */
interface TopBarProps {
  onMenuClick?: () => void;
  isScrolled?: boolean;
}

export function TopBar({ onMenuClick, isScrolled = false }: TopBarProps) {
```

Add `cn` import if not already present. Update the header className:

```tsx
/* OLD */
<header className="h-14 border-b border-border flex items-center gap-3 px-4 lg:px-6 shrink-0 bg-background">
```

```tsx
/* NEW */
<header className={cn(
  "h-14 flex items-center gap-3 px-4 lg:px-6 shrink-0 transition-all duration-300 ease-out border-b",
  isScrolled
    ? "bg-[var(--qv-bg)]/80 backdrop-blur-xl border-border shadow-sm supports-not-[backdrop-filter]:bg-[var(--qv-bg)]"
    : "bg-background border-transparent"
)}>
```

- [ ] **Step 3: Verify build**

```bash
cd /c/quovibe && pnpm build --filter @quovibe/web
```

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/components/layout/Shell.tsx packages/web/src/components/layout/TopBar.tsx
git commit -m "feat: frosted glass sticky TopBar on scroll"
```

---

### Task 9: Delete useCountUp hook and final verification

**Files:**
- Delete: `packages/web/src/hooks/use-count-up.ts`

- [ ] **Step 1: Verify no remaining imports**

```bash
cd /c/quovibe && grep -r "use-count-up\|useCountUp" packages/web/src/ --include="*.ts" --include="*.tsx"
```

Expected: **No results.** If any file still imports `useCountUp`, fix it first.

- [ ] **Step 2: Delete the hook**

```bash
rm packages/web/src/hooks/use-count-up.ts
```

- [ ] **Step 3: Full build**

```bash
cd /c/quovibe && pnpm build
```

Expected: Clean build, no errors.

- [ ] **Step 4: Lint**

```bash
cd /c/quovibe && pnpm lint
```

Expected: No new warnings or errors.

- [ ] **Step 5: Commit**

```bash
git add -u packages/web/src/hooks/use-count-up.ts
git commit -m "chore: remove useCountUp hook (replaced by @number-flow/react)"
```

- [ ] **Step 6: Run full check suite**

```bash
cd /c/quovibe && pnpm check:all
```

Expected: All checks pass.
