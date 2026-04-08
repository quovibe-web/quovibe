import { useState, useCallback } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { ExpandableNavItem } from './ExpandableNavItem';
import { CreateTaxonomyDialog } from '../domain/CreateTaxonomyDialog';
import { DeleteTaxonomyDialog } from '../domain/DeleteTaxonomyDialog';
import { apiFetch } from '@/api/fetch';
import { taxonomyKeys } from '@/api/use-taxonomies';
import { useReorderTaxonomy } from '@/api/use-taxonomy-mutations';
import {
  LayoutDashboard,
  Landmark,
  TrendingUp,
  ArrowLeftRight,
  BarChart3,
  Layers,
  GitBranch,
  List,
  Settings,
  Menu,
  ExternalLink,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { cn } from '@/lib/utils';

type NavItem = { to: string; labelKey: string; icon: React.ElementType; end?: boolean };
type NavSection = { sectionKey: string; items: NavItem[] };

const NAV: NavSection[] = [
  {
    sectionKey: 'sections.main',
    items: [
      { to: '/', labelKey: 'items.dashboard', icon: LayoutDashboard },
      { to: '/watchlists', labelKey: 'items.watchlists', icon: List },
    ],
  },
  {
    sectionKey: 'sections.data',
    items: [
      { to: '/accounts', labelKey: 'items.accounts', icon: Landmark },
      { to: '/investments', labelKey: 'items.investments', icon: TrendingUp },
      { to: '/transactions', labelKey: 'items.transactions', icon: ArrowLeftRight },
    ],
  },
  {
    sectionKey: 'sections.analysis',
    items: [
      { to: '/analytics', labelKey: 'items.analytics', icon: BarChart3, end: false },
    ],
  },
  {
    sectionKey: 'sections.taxonomies',
    items: [
      { to: '/allocation', labelKey: 'items.assetAllocation', icon: Layers },
      { to: '/taxonomies/data-series', labelKey: 'items.dataSeries', icon: GitBranch },
    ],
  },
  {
    sectionKey: 'sections.system',
    items: [{ to: '/settings', labelKey: 'items.settings', icon: Settings }],
  },
];

/** Mobile bottom nav — consultation pages only */
const MOBILE_NAV: NavItem[] = [
  { to: '/', labelKey: 'items.dashboard', icon: LayoutDashboard },
  { to: '/investments', labelKey: 'items.investments', icon: TrendingUp },
  { to: '/transactions', labelKey: 'items.transactions', icon: ArrowLeftRight },
  { to: '/analytics', labelKey: 'items.analytics', icon: BarChart3 },
];

function QuovibeLogo() {
  return (
    <svg viewBox="0 0 180 32" fill="none" className="h-8 w-auto">
      <defs>
        <linearGradient id="sidebar-logo-g" x1="0" y1="32" x2="50" y2="0">
          <stop offset="0%" stopColor="var(--color-primary)" />
          <stop offset="100%" stopColor="var(--color-chart-5)" />
        </linearGradient>
      </defs>
      {/* $ prompt */}
      <text x="0" y="23" fontFamily="'JetBrains Mono', monospace" fontSize="22" fontWeight="300" fill="var(--color-chart-5)" opacity="0.6">$</text>
      {/* quo */}
      <text x="16" y="23" fontFamily="'JetBrains Mono', monospace" fontSize="22" fontWeight="800" fill="var(--color-primary)" letterSpacing="-1">quo</text>
      {/* pipe */}
      <text x="57" y="23" fontFamily="'JetBrains Mono', monospace" fontSize="22" fontWeight="300" fill="var(--color-primary)">|</text>
      {/* vibe */}
      <text x="70" y="23" fontFamily="'Outfit', sans-serif" fontSize="22" fontWeight="200" fill="var(--qv-text-muted)" letterSpacing="2">vibe</text>
      {/* Micro sparkline */}
      <path d="M132 22 L138 18 L142 20 L148 12 L152 14 L158 6 L164 9 L170 3"
            stroke="url(#sidebar-logo-g)" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" opacity="0.5" />
      <circle cx="170" cy="3" r="1.5" fill="var(--color-chart-5)" opacity="0.5" />
    </svg>
  );
}

const GITHUB_RELEASES_URL = 'https://github.com/quovibe-web/quovibe/releases';

function VersionBadge({ className }: { className?: string }) {
  const version = __APP_VERSION__;
  return (
    <a
      href={`${GITHUB_RELEASES_URL}/tag/${version}`}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        'group inline-flex items-center gap-1.5 rounded-md px-2 py-1 font-mono text-[11px] text-[var(--qv-text-faint)] transition-colors hover:text-muted-foreground',
        className,
      )}
    >
      {version}
      <ExternalLink className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100" />
    </a>
  );
}

/** Pages that are period-sensitive and should carry search params across navigation. */
const PERIOD_SENSITIVE_PREFIXES = ['/', '/analytics', '/allocation', '/investments', '/accounts', '/taxonomies'];

function isPeriodSensitivePath(path: string): boolean {
  return PERIOD_SENSITIVE_PREFIXES.some((prefix) =>
    prefix === '/' ? path === '/' : path.startsWith(prefix)
  );
}

/** Extract only periodStart/periodEnd from current search params. */
function extractPeriodSearch(search: string): string {
  const params = new URLSearchParams(search);
  const ps = params.get('periodStart');
  const pe = params.get('periodEnd');
  if (!ps || !pe) return '';
  return `?periodStart=${ps}&periodEnd=${pe}`;
}

function SidebarNavItem({ item, onClick }: { item: NavItem; onClick?: () => void }) {
  const { t } = useTranslation('navigation');
  const location = useLocation();

  // Preserve period search params for period-sensitive pages
  const periodSearch = isPeriodSensitivePath(item.to) ? extractPeriodSearch(location.search) : '';
  const to = periodSearch ? { pathname: item.to, search: periodSearch } : item.to;

  return (
    <NavLink
      to={to}
      end={item.end !== false}
      onClick={onClick}
      className={({ isActive }) =>
        cn(
          'relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none',
          isActive
            ? 'bg-[var(--qv-surface-elevated)] text-foreground font-medium before:absolute before:left-0 before:top-1/2 before:-translate-y-1/2 before:h-4 before:w-[3px] before:rounded-full before:bg-primary'
            : 'text-muted-foreground hover:bg-[var(--qv-surface-elevated)] hover:text-foreground'
        )
      }
    >
      {({ isActive }) => (
        <>
          <item.icon className={cn('h-4 w-4 shrink-0', isActive ? 'text-foreground' : 'text-muted-foreground')} />
          {t(item.labelKey)}
        </>
      )}
    </NavLink>
  );
}

export function DesktopSidebar() {
  const { t } = useTranslation('navigation');
  const { t: tr } = useTranslation('reports');
  const qc = useQueryClient();
  const reorderMutation = useReorderTaxonomy();
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [renameTarget, setRenameTarget] = useState<{ id: string; name: string } | null>(null);

  const handleRename = useCallback((id: string, currentName: string) => {
    setRenameTarget({ id, name: currentName });
  }, []);

  const handleMoveUp = useCallback((id: string) => {
    reorderMutation.mutate({ taxonomyId: id, direction: 'up' });
  }, [reorderMutation]);

  const handleMoveDown = useCallback((id: string) => {
    reorderMutation.mutate({ taxonomyId: id, direction: 'down' });
  }, [reorderMutation]);

  return (
    <aside className="hidden lg:flex w-64 h-screen border-r border-border bg-[var(--qv-bg)] flex-col shrink-0">
      {/* Logo */}
      <div className="px-5 py-5">
        <QuovibeLogo />
      </div>
      <Separator />

      {/* Navigation */}
      <ScrollArea className="flex-1 min-h-0 px-3 py-4">
        <nav className="space-y-6">
          {NAV.map((section) => (
            <div key={section.sectionKey}>
              <ul className="space-y-0.5">
                {section.items.map((item) => (
                  <li key={item.to}>
                    {item.to === '/allocation' ? (
                      <ExpandableNavItem
                        labelKey={item.labelKey}
                        icon={item.icon}
                        basePath={item.to}
                        onCreateClick={() => setCreateDialogOpen(true)}
                        onRename={handleRename}
                        onDelete={(id, name) => setDeleteTarget({ id, name })}
                        onMoveUp={handleMoveUp}
                        onMoveDown={handleMoveDown}
                      />
                    ) : (
                      <SidebarNavItem item={item} />
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </ScrollArea>

      {/* Version */}
      <div className="px-4 py-3 border-t border-border">
        <VersionBadge />
      </div>

      <CreateTaxonomyDialog open={createDialogOpen} onOpenChange={setCreateDialogOpen} />
      {deleteTarget && (
        <DeleteTaxonomyDialog
          open
          onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
          taxonomyId={deleteTarget.id}
          taxonomyName={deleteTarget.name}
        />
      )}

      {/* Rename taxonomy dialog */}
      <Dialog open={renameTarget !== null} onOpenChange={(open) => { if (!open) setRenameTarget(null); }}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>{tr('taxonomyManagement.nameLabel')}</DialogTitle>
            <DialogDescription className="sr-only">
              {tr('taxonomyManagement.renameDescription')}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={async (e) => {
            e.preventDefault();
            const newName = (new FormData(e.currentTarget).get('name') as string)?.trim();
            if (!newName || !renameTarget || newName === renameTarget.name) {
              setRenameTarget(null);
              return;
            }
            await apiFetch(`/api/taxonomies/${renameTarget.id}`, {
              method: 'PATCH',
              body: JSON.stringify({ name: newName }),
            });
            qc.invalidateQueries({ queryKey: taxonomyKeys.all });
            qc.invalidateQueries({ queryKey: taxonomyKeys.tree(renameTarget.id) });
            setRenameTarget(null);
          }}>
            <div className="py-4">
              <Label htmlFor="taxonomy-rename-input">{tr('taxonomyManagement.nameLabel')}</Label>
              <Input
                id="taxonomy-rename-input"
                name="name"
                autoFocus
                defaultValue={renameTarget?.name ?? ''}
                className="mt-1.5"
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setRenameTarget(null)}>
                {tr('common:cancel', 'Cancel')}
              </Button>
              <Button type="submit">
                {tr('common:ok', 'OK')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </aside>
  );
}

export function MobileNav() {
  const { t } = useTranslation('navigation');
  const [moreOpen, setMoreOpen] = useState(false);
  const location = useLocation();

  const mobileNavPaths = MOBILE_NAV.map((i) => i.to);
  const isMoreActive = !mobileNavPaths.some(
    (p) => (p === '/' ? location.pathname === '/' : location.pathname.startsWith(p))
  );

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 md:hidden border-t border-border bg-card/95 backdrop-blur-lg safe-bottom">
      <div className="flex items-center justify-around h-16 px-2">
        {MOBILE_NAV.map((item) => {
          const Icon = item.icon;
          const periodSearch = isPeriodSensitivePath(item.to) ? extractPeriodSearch(location.search) : '';
          const to = periodSearch ? { pathname: item.to, search: periodSearch } : item.to;
          return (
            <NavLink
              key={item.to}
              to={to}
              end={item.to === '/'}
              className={({ isActive }) =>
                cn(
                  'flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-lg transition-colors min-w-0',
                  isActive
                    ? 'text-foreground'
                    : 'text-muted-foreground'
                )
              }
            >
              <Icon className="h-5 w-5" />
              <span className="text-[10px] font-medium truncate">{t(item.labelKey)}</span>
            </NavLink>
          );
        })}

        {/* More button → opens full nav sheet */}
        <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
          <SheetTrigger asChild>
            <button
              className={cn(
                'flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-lg transition-colors',
                isMoreActive ? 'text-foreground' : 'text-muted-foreground'
              )}
            >
              <Menu className="h-5 w-5" />
              <span className="text-[10px] font-medium">{t('more')}</span>
            </button>
          </SheetTrigger>
          <SheetContent side="bottom" className="h-auto max-h-[80vh] rounded-t-2xl">
            <SheetHeader>
              <SheetTitle className="text-left">{t('sheetTitle')}</SheetTitle>
            </SheetHeader>
            <ScrollArea className="mt-4 max-h-[60vh]">
              <nav className="space-y-5 pb-8">
                {NAV.map((section) => (
                  <div key={section.sectionKey}>
                    <p className="px-3 mb-1.5 text-xs font-medium text-[var(--qv-text-faint)] uppercase tracking-wider">
                      {t(section.sectionKey)}
                    </p>
                    <ul className="space-y-0.5">
                      {section.items.map((item) => (
                        <li key={item.to}>
                          <SidebarNavItem item={item} onClick={() => setMoreOpen(false)} />
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </nav>
            </ScrollArea>
            <div className="border-t border-border px-4 py-3">
              <VersionBadge />
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </nav>
  );
}

// ---------------------------------------------------------------------------
// CollapsedSidebar — icon-only rail for tablet-width viewports (md to lg)
// ---------------------------------------------------------------------------

export function CollapsedSidebar() {
  const { t } = useTranslation('navigation');
  const location = useLocation();

  const allItems = NAV.flatMap((section) => section.items);

  return (
    <aside className="hidden md:flex lg:hidden w-14 h-screen border-r border-border bg-[var(--qv-bg)] flex-col items-center shrink-0">
      {/* Logo mark */}
      <div className="flex items-center justify-center h-14 shrink-0">
        <span className="text-base tracking-tight">
          <span className="font-normal" style={{ color: 'var(--color-primary)' }}>Q</span>
          <span className="font-extrabold" style={{ color: 'var(--color-chart-5)' }}>V</span>
        </span>
      </div>
      <Separator />

      <TooltipProvider delayDuration={0}>
        <nav className="flex-1 flex flex-col items-center gap-1 py-3 overflow-y-auto">
          {allItems.map((item) => {
            const Icon = item.icon;
            const periodSearch = isPeriodSensitivePath(item.to)
              ? extractPeriodSearch(location.search)
              : '';
            const to = periodSearch
              ? { pathname: item.to, search: periodSearch }
              : item.to;

            return (
              <Tooltip key={item.to}>
                <TooltipTrigger asChild>
                  <NavLink
                    to={to}
                    end={item.end !== false}
                    className={({ isActive }) =>
                      cn(
                        'relative flex items-center justify-center w-10 h-10 rounded-lg transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none',
                        isActive
                          ? 'bg-[var(--qv-surface-elevated)] text-foreground after:absolute after:bottom-0 after:left-1/2 after:-translate-x-1/2 after:w-4 after:h-[3px] after:rounded-full after:bg-primary'
                          : 'text-muted-foreground hover:bg-[var(--qv-surface-elevated)] hover:text-foreground'
                      )
                    }
                  >
                    <Icon className="h-5 w-5" />
                  </NavLink>
                </TooltipTrigger>
                <TooltipContent side="right" sideOffset={8}>
                  {t(item.labelKey)}
                </TooltipContent>
              </Tooltip>
            );
          })}
        </nav>
      </TooltipProvider>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// SidebarDrawer — full nav in a sheet from the left (hamburger / Ctrl+B)
// ---------------------------------------------------------------------------

interface SidebarDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SidebarDrawer({ open, onOpenChange }: SidebarDrawerProps) {
  const { t } = useTranslation('navigation');

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="w-64 p-0 bg-[var(--qv-bg)]">
        <SheetHeader className="px-5 py-5">
          <SheetTitle className="sr-only">{t('sheetTitle')}</SheetTitle>
          <QuovibeLogo />
        </SheetHeader>
        <Separator />
        <ScrollArea className="flex-1 px-3 py-4">
          <nav className="space-y-6">
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
          </nav>
        </ScrollArea>
        <div className="border-t border-border px-4 py-3">
          <VersionBadge />
        </div>
      </SheetContent>
    </Sheet>
  );
}

