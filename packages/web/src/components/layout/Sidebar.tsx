import { useState, useCallback } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { isPeriodSensitivePath, extractPeriodSearch } from '@/lib/period-utils';
import { useQueryClient } from '@tanstack/react-query';
import { ExpandableNavItem } from './ExpandableNavItem';
import { CreateTaxonomyDialog } from '../domain/CreateTaxonomyDialog';
import { DeleteTaxonomyDialog } from '../domain/DeleteTaxonomyDialog';
import { useScopedApi } from '@/api/use-scoped-api';
import { taxonomyKeys } from '@/api/use-taxonomies';
import { useReorderTaxonomy } from '@/api/use-taxonomy-mutations';
import { useTheme } from '@/hooks/use-theme';
import { useUpdateSettings } from '@/api/use-portfolio';
import { LanguageSwitcher } from '@/components/shared/LanguageSwitcher';
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
  Sun,
  Moon,
  Monitor,
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
    <div className="flex items-center gap-2.5">
      <svg viewBox="0 0 120 120" fill="none" className="h-7 w-7 shrink-0">
        <path d="M60 22 Q82 22, 82 44" stroke="var(--qv-text-primary)" strokeWidth="6" fill="none" strokeLinecap="round" />
        <path d="M98 60 Q98 82, 76 82" stroke="var(--qv-text-primary)" strokeWidth="6" fill="none" strokeLinecap="round" />
        <path d="M60 98 Q38 98, 38 76" stroke="var(--qv-text-primary)" strokeWidth="6" fill="none" strokeLinecap="round" />
        <path d="M22 60 Q22 38, 44 38" stroke="var(--qv-text-primary)" strokeWidth="6" fill="none" strokeLinecap="round" />
        <circle cx="60" cy="60" r="6" fill="var(--qv-warning)" />
      </svg>
      <span className="text-xl" style={{ letterSpacing: '-0.3px' }}>
        <span style={{ fontFamily: "'DM Serif Display', serif", color: 'var(--qv-text-primary)' }}>quo</span>
        <span style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 300, color: 'var(--qv-text-muted)' }}>vibe</span>
      </span>
    </div>
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

// isPeriodSensitivePath / extractPeriodSearch imported from period-utils

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
  const api = useScopedApi();
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
            await api.fetch(`/api/taxonomies/${renameTarget.id}`, {
              method: 'PATCH',
              body: JSON.stringify({ name: newName }),
            });
            qc.invalidateQueries({ queryKey: taxonomyKeys.all(api.portfolioId) });
            qc.invalidateQueries({ queryKey: taxonomyKeys.tree(api.portfolioId, renameTarget.id) });
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
    <nav className="fixed bottom-0 left-0 right-0 z-50 md:hidden border-t border-border bg-card/80 backdrop-blur-2xl backdrop-saturate-150 safe-bottom">
      <div className="flex items-center justify-around h-16 px-2">
        {MOBILE_NAV.map((item) => {
          const periodSearch = isPeriodSensitivePath(item.to) ? extractPeriodSearch(location.search) : '';
          const to = periodSearch ? { pathname: item.to, search: periodSearch } : item.to;
          return (
            <NavLink
              key={item.to}
              to={to}
              end={item.to === '/'}
              className="relative flex flex-col items-center gap-0.5 px-3 py-1.5 min-w-0"
            >
              {({ isActive }) => {
                const Icon = item.icon;
                return (
                  <>
                    {isActive && (
                      <motion.div
                        layoutId="mobile-nav-indicator"
                        className="absolute inset-0 rounded-lg bg-[var(--qv-surface-elevated)]"
                        transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                      />
                    )}
                    <Icon className={cn('h-5 w-5 relative z-10', isActive ? 'text-foreground' : 'text-muted-foreground')} />
                    <span className={cn('text-[10px] font-medium truncate relative z-10', isActive ? 'text-foreground' : 'text-muted-foreground')}>
                      {t(item.labelKey)}
                    </span>
                  </>
                );
              }}
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
        <svg viewBox="0 0 120 120" fill="none" className="h-6 w-6">
          <path d="M60 22 Q82 22, 82 44" stroke="var(--qv-text-primary)" strokeWidth="7" fill="none" strokeLinecap="round" />
          <path d="M98 60 Q98 82, 76 82" stroke="var(--qv-text-primary)" strokeWidth="7" fill="none" strokeLinecap="round" />
          <path d="M60 98 Q38 98, 38 76" stroke="var(--qv-text-primary)" strokeWidth="7" fill="none" strokeLinecap="round" />
          <path d="M22 60 Q22 38, 44 38" stroke="var(--qv-text-primary)" strokeWidth="7" fill="none" strokeLinecap="round" />
          <circle cx="60" cy="60" r="7" fill="var(--qv-warning)" />
        </svg>
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
  const { theme, setTheme } = useTheme();
  const { mutate: updateSettings } = useUpdateSettings();

  function handleTheme(next: 'light' | 'dark' | 'system') {
    setTheme(next);
    updateSettings({ theme: next });
  }

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
        {/* Theme + Language (mobile only — hidden from TopBar on small screens) */}
        <div className="border-t border-border px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-1 rounded-full bg-muted p-0.5">
            <button
              onClick={() => handleTheme('light')}
              className={cn(
                'p-1.5 rounded-full transition-colors duration-150',
                theme === 'light' ? 'bg-background text-primary' : 'text-muted-foreground hover:text-foreground'
              )}
              title={t('theme.light')}
              aria-label={t('theme.light')}
            >
              <Sun className="h-4 w-4" />
            </button>
            <button
              onClick={() => handleTheme('system')}
              className={cn(
                'p-1.5 rounded-full transition-colors duration-150',
                theme === 'system' ? 'bg-background text-primary' : 'text-muted-foreground hover:text-foreground'
              )}
              title={t('theme.system')}
              aria-label={t('theme.system')}
            >
              <Monitor className="h-4 w-4" />
            </button>
            <button
              onClick={() => handleTheme('dark')}
              className={cn(
                'p-1.5 rounded-full transition-colors duration-150',
                theme === 'dark' ? 'bg-background text-primary' : 'text-muted-foreground hover:text-foreground'
              )}
              title={t('theme.dark')}
              aria-label={t('theme.dark')}
            >
              <Moon className="h-4 w-4" />
            </button>
          </div>
          <LanguageSwitcher />
        </div>
        <div className="border-t border-border px-4 py-3">
          <VersionBadge />
        </div>
      </SheetContent>
    </Sheet>
  );
}

