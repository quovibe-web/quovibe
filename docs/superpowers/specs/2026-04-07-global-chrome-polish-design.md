# Global Chrome Polish: Sidebar + TopBar Consistency

**Date:** 2026-04-07
**Status:** Approved
**Scope:** Sidebar visual polish (background, active state, section headers), TopBar rounded-full consistency pass. CSS/className changes only — no structural or logic changes.

## Goal

Polish the sidebar and TopBar to feel cohesive with the warm Flexoki palette and the rounded-full design language established in the chart page. Blended sidebar background, left accent bar on active items, removed section headers, rounded-full pills on all TopBar controls.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Sidebar background | Blended (same as page bg) | Modern, open feel — like Linear/Notion |
| Active nav item | Left accent bar (3px, primary color) | Strong "you are here" without heaviness |
| Section headers | Removed — spacing only | 9-item sidebar doesn't need labels, cleaner |
| TopBar controls | rounded-full consistency | Match chart page segmented control language |
| Mobile nav | Unchanged | Already polished, low impact area |

## 1. Sidebar — Desktop (DesktopSidebar)

**File:** `packages/web/src/components/layout/Sidebar.tsx`

### Background
- Change sidebar container from `bg-card` to `bg-[var(--qv-bg)]`
- The sidebar visually merges with the main content, separated only by `border-r border-border`

### Section Headers
- Remove all section header `<h3>` elements (the "MAIN", "DATA", "ANALYSIS", "TAXONOMIES", "SYSTEM" labels)
- Replace with spacing between nav groups: each group gets `mt-6` (except the first group)
- Within each group, items keep `space-y-1`

### Active Nav Item
Add a left accent bar to the active state using a CSS pseudo-element approach. In the nav item component:

- Active item gets an additional class that creates a left border indicator:
  ```
  before:absolute before:left-0 before:top-1/2 before:-translate-y-1/2
  before:h-4 before:w-[3px] before:rounded-full before:bg-primary
  ```
- The item needs `relative` positioning for the pseudo-element
- Active background stays `bg-[var(--qv-surface-elevated)]`
- Active text stays `text-foreground font-medium`

### Inactive Nav Item
- No changes — `hover:bg-[var(--qv-surface-elevated)]` stays

## 2. Sidebar — Collapsed (CollapsedSidebar / Icon Rail)

**File:** `packages/web/src/components/layout/Sidebar.tsx`

### Background
- Change from `bg-card` to `bg-[var(--qv-bg)]`

### Active Icon
- Add a bottom accent bar instead of left (since icons are centered): 
  ```
  after:absolute after:bottom-0 after:left-1/2 after:-translate-x-1/2
  after:w-4 after:h-[3px] after:rounded-full after:bg-primary
  ```
- The icon wrapper needs `relative` positioning
- Active background stays `bg-[var(--qv-surface-elevated)]`

## 3. Sidebar — Drawer (SidebarDrawer)

**File:** `packages/web/src/components/layout/Sidebar.tsx`

### Background
- The Sheet content should use `bg-[var(--qv-bg)]` instead of default card background
- Same active state changes as desktop sidebar (left accent bar)
- Same section header removal (spacing-only grouping)

## 4. TopBar — Toggle Group

**File:** `packages/web/src/components/layout/TopBar.tsx`

### Toggle Group Container
- Change `rounded-lg bg-[var(--qv-surface-elevated)] p-0.5` to `rounded-full bg-muted p-0.5`

### Toggle Group Buttons
- Change `rounded-md` to `rounded-full` on each button
- Active state: keep `bg-card` (or change to `bg-background` for consistency)

## 5. TopBar — Period Pills

**File:** `packages/web/src/components/layout/TopBar.tsx`

### All Period Pill Buttons
- Change `rounded-md` to `rounded-full` for:
  - Default period pills (1Y, 3M, 6M, YTD, ALL)
  - Custom period pills
  - Add period button
  - Active period pill styling (the `bg-primary text-primary-foreground` pill)

## 6. Files Changed

| File | Changes |
|------|---------|
| `packages/web/src/components/layout/Sidebar.tsx` | Desktop: blended bg, remove section headers, active left bar. Collapsed: blended bg, active bottom bar. Drawer: blended bg, same active state. |
| `packages/web/src/components/layout/TopBar.tsx` | Toggle group: rounded-full container + buttons. Period pills: rounded-full. |

## 7. What This Does NOT Change

- Sidebar structure (sections, items, icons, expandable taxonomies)
- Navigation routing or links
- Sidebar drawer behavior (Ctrl+B toggle)
- Mobile bottom nav (stays as-is)
- TopBar frosted glass scroll behavior
- Period selector logic
- Language switcher
- Privacy toggle behavior
- Shell layout (flex structure, breakpoints)
- Any API or data layer
