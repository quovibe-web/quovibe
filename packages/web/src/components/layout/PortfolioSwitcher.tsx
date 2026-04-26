// packages/web/src/components/layout/PortfolioSwitcher.tsx
import { useContext, useState } from 'react';
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
import { usePortfolioRegistry, useCreatePortfolio, useTouchPortfolio } from '@/api/use-portfolios';
import { portfolioSectionPath } from '@/lib/portfolio-switch-route';
import { sortByRecency } from '@/lib/portfolio-recency';
import { toast } from 'sonner';
import { resolveErrorMessage } from '@/api/query-client';
import { Beaker, ChevronDown, Check, Home, Plus } from 'lucide-react';
import { NewPortfolioDialog } from '@/components/domain/portfolio/NewPortfolioDialog';

export function PortfolioSwitcher() {
  const { t } = useTranslation('switcher');
  const { portfolioId } = useParams<{ portfolioId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const registry = usePortfolioRegistry();
  const createDemo = useCreatePortfolio();
  const touch = useTouchPortfolio();
  const [newDialogOpen, setNewDialogOpen] = useState(false);

  const contextPortfolio = useContext(PortfolioContext);

  if (!registry.data) return null;
  const portfolios = registry.data.portfolios;
  const realPortfolios = portfolios.filter((p) => p.kind === 'real').sort(sortByRecency);
  const demoExists = portfolios.some((p) => p.kind === 'demo');
  const currentKind =
    portfolios.find((p) => p.id === portfolioId)?.kind
    ?? contextPortfolio?.kind
    ?? null;
  const currentName =
    portfolios.find((p) => p.id === portfolioId)?.name
    ?? (contextPortfolio ? contextPortfolio.name : null)
    ?? t('noPortfolio');

  const pick = (id: string): void => {
    touch.mutate(id);
    const section = portfolioSectionPath(location.pathname);
    navigate(`/p/${id}${section}${location.search}`);
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
        <DropdownMenuTrigger className="flex min-w-0 items-center gap-1 rounded px-2 py-1 hover:bg-muted">
          <span className="max-w-[120px] truncate text-sm font-medium md:max-w-[200px]">{currentName}</span>
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-64" align="end">
          {realPortfolios.map((p) => (
            <DropdownMenuItem key={p.id} onClick={() => pick(p.id)}>
              {p.id === portfolioId ? <Check className="mr-2 h-4 w-4" /> : <span className="mr-2 w-4" />}
              <span className="truncate">{p.name}</span>
            </DropdownMenuItem>
          ))}
          {realPortfolios.length > 0 && <DropdownMenuSeparator />}
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
