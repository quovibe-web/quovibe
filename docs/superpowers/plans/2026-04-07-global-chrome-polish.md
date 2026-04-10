# Global Chrome Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Polish sidebar (blended background, left accent bar active state, remove section headers) and TopBar (rounded-full consistency on toggle group and period pills).

**Architecture:** Pure CSS/className changes across 2 files. No structural, logic, or component changes.

**Tech Stack:** Tailwind CSS classes, existing components

**Spec:** `docs/superpowers/specs/2026-04-07-global-chrome-polish-design.md`

---

## File Structure

| File | Changes |
|------|---------|
| `packages/web/src/components/layout/Sidebar.tsx` | Desktop: blended bg, remove section headers, active left bar. Collapsed: blended bg, active bottom bar. Drawer: blended bg, remove section headers. |
| `packages/web/src/components/layout/TopBar.tsx` | Toggle group: rounded-full. Period pills: rounded-full. |

---

### Task 1: Sidebar polish — desktop, collapsed, drawer

**Files:**
- Modify: `packages/web/src/components/layout/Sidebar.tsx`

- [ ] **Step 1: Change DesktopSidebar background**

Find (line 210):
```tsx
<aside className="hidden lg:flex w-64 h-screen border-r border-border bg-card flex-col shrink-0">
```
Replace `bg-card` with `bg-[var(--qv-bg)]`:
```tsx
<aside className="hidden lg:flex w-64 h-screen border-r border-border bg-[var(--qv-bg)] flex-col shrink-0">
```

- [ ] **Step 2: Remove section headers from DesktopSidebar**

Find the navigation render block (lines 219-247). Currently:
```tsx
<nav className="space-y-6">
  {NAV.map((section) => (
    <div key={section.sectionKey}>
      <p className="px-3 mb-2 text-xs font-medium text-[var(--qv-text-faint)] uppercase tracking-wider">
        {t(section.sectionKey)}
      </p>
      <ul className="space-y-0.5">
        {section.items.map((item) => (
          <li key={item.to}>
            {item.to === '/allocation' ? (
              <ExpandableNavItem ... />
            ) : (
              <SidebarNavItem item={item} />
            )}
          </li>
        ))}
      </ul>
    </div>
  ))}
</nav>
```

Remove the `<p>` section header element. The `<div>` and `space-y-6` on `<nav>` already provide spacing between groups:
```tsx
<nav className="space-y-6">
  {NAV.map((section) => (
    <div key={section.sectionKey}>
      <ul className="space-y-0.5">
        {section.items.map((item) => (
          <li key={item.to}>
            {item.to === '/allocation' ? (
              <ExpandableNavItem ... />
            ) : (
              <SidebarNavItem item={item} />
            )}
          </li>
        ))}
      </ul>
    </div>
  ))}
</nav>
```

- [ ] **Step 3: Add left accent bar to active nav item**

In the `SidebarNavItem` component (lines 156-186), update the NavLink className and add `relative` positioning:

Find:
```tsx
className={({ isActive }) =>
  cn(
    'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none',
    isActive
      ? 'bg-[var(--qv-surface-elevated)] text-foreground font-medium'
      : 'text-muted-foreground hover:bg-[var(--qv-surface-elevated)] hover:text-foreground'
  )
}
```

Replace with:
```tsx
className={({ isActive }) =>
  cn(
    'relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none',
    isActive
      ? 'bg-[var(--qv-surface-elevated)] text-foreground font-medium before:absolute before:left-0 before:top-1/2 before:-translate-y-1/2 before:h-4 before:w-[3px] before:rounded-full before:bg-primary'
      : 'text-muted-foreground hover:bg-[var(--qv-surface-elevated)] hover:text-foreground'
  )
}
```

Key additions: `relative` on the base class, and the `before:` pseudo-element chain on the active state.

- [ ] **Step 4: Change CollapsedSidebar background**

Find (line 407):
```tsx
<aside className="hidden md:flex lg:hidden w-14 h-screen border-r border-border bg-card flex-col items-center shrink-0">
```
Replace `bg-card` with `bg-[var(--qv-bg)]`:
```tsx
<aside className="hidden md:flex lg:hidden w-14 h-screen border-r border-border bg-[var(--qv-bg)] flex-col items-center shrink-0">
```

- [ ] **Step 5: Add bottom accent bar to active collapsed nav icon**

In the CollapsedSidebar NavLink (lines 434-441), update:

Find:
```tsx
className={({ isActive }) =>
  cn(
    'flex items-center justify-center w-10 h-10 rounded-lg transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none',
    isActive
      ? 'bg-[var(--qv-surface-elevated)] text-foreground'
      : 'text-muted-foreground hover:bg-[var(--qv-surface-elevated)] hover:text-foreground'
  )
}
```

Replace with:
```tsx
className={({ isActive }) =>
  cn(
    'relative flex items-center justify-center w-10 h-10 rounded-lg transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none',
    isActive
      ? 'bg-[var(--qv-surface-elevated)] text-foreground after:absolute after:bottom-0 after:left-1/2 after:-translate-x-1/2 after:w-4 after:h-[3px] after:rounded-full after:bg-primary'
      : 'text-muted-foreground hover:bg-[var(--qv-surface-elevated)] hover:text-foreground'
  )
}
```

- [ ] **Step 6: Update SidebarDrawer — background and remove section headers**

In the SidebarDrawer (lines 467-502):

Change the SheetContent background. Find:
```tsx
<SheetContent side="left" className="w-64 p-0">
```
Replace with:
```tsx
<SheetContent side="left" className="w-64 p-0 bg-[var(--qv-bg)]">
```

Remove the section header `<p>` elements (same as Step 2). Find the nav render block inside the drawer (lines 479-494):
```tsx
{NAV.map((section) => (
  <div key={section.sectionKey}>
    <p className="px-3 mb-2 text-xs font-medium text-[var(--qv-text-faint)] uppercase tracking-wider">
      {t(section.sectionKey)}
    </p>
    <ul className="space-y-0.5">
      {section.items.map((item) => (
        <li key={item.to}>
          <SidebarNavItem item={item} onClick={() => onOpenChange(false)} />
        </li>
      ))}
    </ul>
  </div>
))}
```

Remove the `<p>` element:
```tsx
{NAV.map((section) => (
  <div key={section.sectionKey}>
    <ul className="space-y-0.5">
      {section.items.map((item) => (
        <li key={item.to}>
          <SidebarNavItem item={item} onClick={() => onOpenChange(false)} />
        </li>
      ))}
    </ul>
  </div>
))}
```

- [ ] **Step 7: Verify build**

```bash
cd /c/quovibe && pnpm --filter @quovibe/web build
```

- [ ] **Step 8: Commit**

```bash
cd /c/quovibe && git add packages/web/src/components/layout/Sidebar.tsx && git commit -m "style: blended sidebar background, left accent bar, remove section headers"
```

---

### Task 2: TopBar rounded-full consistency

**Files:**
- Modify: `packages/web/src/components/layout/TopBar.tsx`

- [ ] **Step 1: Update toggle group container**

Find (line 55):
```tsx
<div className="flex items-center gap-0.5 rounded-lg bg-[var(--qv-surface-elevated)] p-0.5">
```
Replace with:
```tsx
<div className="flex items-center gap-0.5 rounded-full bg-muted p-0.5">
```

- [ ] **Step 2: Update toggle group buttons**

There are 4 toggle buttons (lines 59, 72, 85, 98) each with:
```
'p-1.5 rounded-md transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none'
```

Replace `rounded-md` with `rounded-full` on all 4. Use replace-all for the exact string:

```
'p-1.5 rounded-full transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none'
```

- [ ] **Step 3: Update period pill buttons**

There are several period pill buttons with `rounded-md`. These are on lines 236, 252, 272 with the pattern:
```
'h-7 px-2.5 text-xs font-medium rounded-md'
```

Replace all with:
```
'h-7 px-2.5 text-xs font-medium rounded-full'
```

Also the custom period pills on line 272:
```
'h-7 px-2.5 text-xs font-medium rounded-md max-w-[160px] truncate'
```
Replace with:
```
'h-7 px-2.5 text-xs font-medium rounded-full max-w-[160px] truncate'
```

- [ ] **Step 4: Update popover menu items (optional — inside the period overflow popover)**

The popover dropdown items on lines 313, 331, 351 use `rounded-md`:
```
'w-full text-left px-2.5 py-1.5 rounded-md text-sm transition-colors'
```

These are dropdown list items inside a popover, not pills. Leave them as `rounded-md` — they're not the same UI pattern as pills. Only the pill buttons that appear in the TopBar itself should be rounded-full.

- [ ] **Step 5: Verify build**

```bash
cd /c/quovibe && pnpm --filter @quovibe/web build
```

- [ ] **Step 6: Commit**

```bash
cd /c/quovibe && git add packages/web/src/components/layout/TopBar.tsx && git commit -m "style: rounded-full toggle group and period pills for design consistency"
```

---

### Task 3: Build + lint verification

- [ ] **Step 1: Full build**

```bash
cd /c/quovibe && pnpm build
```

- [ ] **Step 2: Lint**

```bash
cd /c/quovibe && pnpm lint
```

- [ ] **Step 3: Tests**

```bash
cd /c/quovibe && pnpm test
```

- [ ] **Step 4: Commit fixes if needed**

```bash
cd /c/quovibe && git add -A && git commit -m "fix: address lint/test issues from chrome polish"
```
