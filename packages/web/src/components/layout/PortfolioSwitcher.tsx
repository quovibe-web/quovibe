// packages/web/src/components/layout/PortfolioSwitcher.tsx
import { useContext, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PortfolioContext } from '@/context/PortfolioContext';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { usePortfolioRegistry, useCreatePortfolio } from '@/api/use-portfolios';
import { portfolioSectionPath } from '@/lib/portfolio-switch-route';
import { sortByRecency } from '@/lib/portfolio-recency';
import { toast } from 'sonner';
import { resolveErrorMessage } from '@/api/query-client';
import { Beaker, ChevronDown, Check, Home, Plus } from 'lucide-react';
import { NewPortfolioDialog } from '@/components/domain/portfolio/NewPortfolioDialog';

// Cap inline list at most-recent N real portfolios; full list lives behind
// "All portfolios…" so a long tail (test fixtures, archived backups, large
// user accounts) doesn't push the New / TryDemo / All-portfolios actions
// off-screen.
const SWITCHER_INLINE_CAP = 10;

export function PortfolioSwitcher() {
  const { t } = useTranslation('switcher');
  const { portfolioId } = useParams<{ portfolioId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const registry = usePortfolioRegistry();
  const createDemo = useCreatePortfolio();
  const [newDialogOpen, setNewDialogOpen] = useState(false);

  const contextPortfolio = useContext(PortfolioContext);

  const portfolios = registry.data?.portfolios;
  const derived = useMemo(() => {
    if (!portfolios) return null;
    const realPortfolios = portfolios.filter((p) => p.kind === 'real').sort(sortByRecency);
    const inlinePortfolios = realPortfolios.slice(0, SWITCHER_INLINE_CAP);
    const hiddenCount = realPortfolios.length - inlinePortfolios.length;
    const demoExists = portfolios.some((p) => p.kind === 'demo');
    const currentEntry = portfolios.find((p) => p.id === portfolioId) ?? null;
    return { inlinePortfolios, hiddenCount, demoExists, currentEntry };
  }, [portfolios, portfolioId]);

  if (!registry.data || !portfolios || !derived) return null;
  const { inlinePortfolios, hiddenCount, demoExists, currentEntry } = derived;
  const currentKind = currentEntry?.kind ?? contextPortfolio?.kind ?? null;
  const currentName =
    currentEntry?.name
    ?? (contextPortfolio ? contextPortfolio.name : null)
    ?? t('noPortfolio');

  const pick = (id: string): void => {
    // Server-touch is owned by PortfolioLayout's mount effect — single source of truth.
    const section = portfolioSectionPath(location.pathname);
    // `flushSync: true` forces React to commit the route change synchronously
    // before navigate returns. Without it, the prior portfolio's UI (TopBar
    // header, document.title, dashboard MV) stays painted for ~40 ms while
    // React's async commit cycle runs, producing a cross-portfolio render
    // flash. Complements the `key={portfolioId}` remount in PortfolioLayout:
    // key drives the body to a fresh loading-state, flushSync collapses the
    // commit lag so siblings (TopBar, Sidebar) flip in the same frame.
    // RR7 data-mode supports the option natively (createBrowserRouter).
    navigate(`/p/${id}${section}${location.search}`, { flushSync: true });
  };

  const tryDemo = (): void => {
    if (demoExists) {
      const demo = portfolios.find((p) => p.kind === 'demo');
      if (demo) pick(demo.id);
      return;
    }
    createDemo.mutate({ source: 'demo' }, {
      onSuccess: (r) => {
        navigate(`/p/${r.entry.id}/dashboard`);
      },
      onError: (err) =>
        toast.error(t('errors.demoFailed', { msg: resolveErrorMessage(err) })),
    });
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger className="group flex min-w-0 items-center gap-1 rounded-sm px-2 py-1 hover:bg-muted data-[state=open]:bg-muted">
          <span className="max-w-[120px] truncate text-sm font-medium md:max-w-[200px]">{currentName}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-150 group-data-[state=open]:rotate-180" />
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-64" align="end">
          {inlinePortfolios.map((p) => (
            <DropdownMenuItem key={p.id} onClick={() => pick(p.id)}>
              {p.id === portfolioId ? <Check className="mr-2 h-4 w-4" /> : <span className="mr-2 w-4" />}
              <span className="truncate">{p.name}</span>
            </DropdownMenuItem>
          ))}
          {hiddenCount > 0 && (
            <DropdownMenuItem
              disabled
              className="text-xs text-muted-foreground italic justify-center"
            >
              {t('moreHidden', { count: hiddenCount })}
            </DropdownMenuItem>
          )}
          {inlinePortfolios.length > 0 && <DropdownMenuSeparator />}
          <DropdownMenuItem onSelect={(e) => { e.preventDefault(); setNewDialogOpen(true); }}>
            <Plus className="mr-2 h-4 w-4" /> {t('newPortfolio')}
          </DropdownMenuItem>
          {currentKind !== 'demo' && (
            <DropdownMenuItem onClick={tryDemo} disabled={createDemo.isPending}>
              <Beaker className="mr-2 h-4 w-4" /> {t('tryDemo')}
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          {/* Welcome is portfolio-agnostic — don't forward periodStart/periodEnd from current portfolio context. */}
          <DropdownMenuItem onClick={() => navigate('/welcome')}>
            <Home className="mr-2 h-4 w-4" /> {t('allPortfolios')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <NewPortfolioDialog open={newDialogOpen} onOpenChange={setNewDialogOpen} />
    </>
  );
}
