// packages/web/src/components/layout/PortfolioSwitcher.tsx
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { usePortfolioRegistry, useCreatePortfolio, useTouchPortfolio } from '@/api/use-portfolios';
import { portfolioSectionPath } from '@/lib/portfolio-switch-route';
import { toast } from 'sonner';
import { Beaker, ChevronDown, Check, Plus } from 'lucide-react';

export function PortfolioSwitcher() {
  const { t } = useTranslation('switcher');
  const { portfolioId } = useParams<{ portfolioId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const registry = usePortfolioRegistry();
  const createDemo = useCreatePortfolio();
  const touch = useTouchPortfolio();

  if (!registry.data) return null;
  const portfolios = registry.data.portfolios;
  const realPortfolios = portfolios.filter((p) => p.kind === 'real');
  const demoExists = portfolios.some((p) => p.kind === 'demo');
  const currentKind = portfolios.find((p) => p.id === portfolioId)?.kind ?? null;
  const currentName = portfolios.find((p) => p.id === portfolioId)?.name ?? t('noPortfolio');

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
      onError: (err) => toast.error(t('errors.demoFailed', { msg: (err as Error).message })),
    });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex items-center gap-1 rounded px-2 py-1 hover:bg-muted">
        <span className="max-w-[200px] truncate text-sm font-medium">{currentName}</span>
        <ChevronDown className="h-4 w-4 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-64" align="end">
        {realPortfolios.map((p) => (
          <DropdownMenuItem key={p.id} onClick={() => pick(p.id)}>
            {p.id === portfolioId ? <Check className="mr-2 h-4 w-4" /> : <span className="mr-2 w-4" />}
            <span className="truncate">{p.name}</span>
          </DropdownMenuItem>
        ))}
        {realPortfolios.length > 0 && <DropdownMenuSeparator />}
        <DropdownMenuItem onClick={() => navigate('/welcome')}>
          <Plus className="mr-2 h-4 w-4" /> {t('newPortfolio')}
        </DropdownMenuItem>
        {currentKind !== 'demo' && (
          <DropdownMenuItem onClick={tryDemo} disabled={createDemo.isPending}>
            <Beaker className="mr-2 h-4 w-4" /> {t('tryDemo')}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
