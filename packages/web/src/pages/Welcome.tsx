import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Sparkles, PlayCircle, Download, ArrowRight, Clock } from 'lucide-react';
import {
  useCreatePortfolio,
  usePortfolioRegistry,
  type PortfolioRegistryEntry,
} from '@/api/use-portfolios';
import { resolveErrorMessage } from '@/api/query-client';
import { WelcomeBackground } from '@/components/welcome/WelcomeBackground';
import { WelcomeTopBar } from '@/components/welcome/WelcomeTopBar';
import { WelcomeHero } from '@/components/welcome/WelcomeHero';
import { WelcomeFooter } from '@/components/welcome/WelcomeFooter';
import { ActionCard } from '@/components/welcome/ActionCard';
import { NewPortfolioDialog } from '@/components/domain/portfolio/NewPortfolioDialog';
import { formatDate } from '@/lib/formatters';
import { sortByRecency } from '@/lib/portfolio-recency';

const STAGGER_DELAYS = {
  recent: '0ms',
  hero: '0ms',
  card1: '120ms',
  card2: '220ms',
  card3: '320ms',
} as const;

const RECENT_LIMIT = 5;

export default function Welcome() {
  const { t } = useTranslation('welcome');
  const navigate = useNavigate();
  const create = useCreatePortfolio();
  const [dialogOpen, setDialogOpen] = useState(false);
  const registry = usePortfolioRegistry();

  const recentPortfolios = useMemo<PortfolioRegistryEntry[]>(() => {
    const list = registry.data?.portfolios ?? [];
    return [...list].sort(sortByRecency).slice(0, RECENT_LIMIT);
  }, [registry.data?.portfolios]);

  useEffect(() => {
    document.title = 'quovibe';
  }, []);

  const handleDemo = (): void => {
    create.mutate(
      { source: 'demo' },
      {
        onSuccess: (r) => navigate(`/p/${r.entry.id}/dashboard`),
        onError: (err) =>
          toast.error(t('errors.demoFailed', { msg: resolveErrorMessage(err) })),
      },
    );
  };

  const handleFresh = (): void => setDialogOpen(true);

  return (
    <>
      <WelcomeBackground />
      <div className="flex min-h-svh flex-col">
        <WelcomeTopBar />
        <main className="flex-1 px-6 py-8 md:px-10 md:py-14">
          <div className="mx-auto max-w-6xl">
            {recentPortfolios.length > 0 && (
              <section
                aria-labelledby="welcome-recent-heading"
                className="qv-stagger-fade mb-10"
                style={{ animationDelay: STAGGER_DELAYS.recent }}
              >
                <h2
                  id="welcome-recent-heading"
                  className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground"
                >
                  {t('recent.heading')}
                </h2>
                <ul className="flex flex-col gap-2">
                  {recentPortfolios.map((p) => (
                    <li key={p.id}>
                      <Link
                        to={`/p/${p.id}/dashboard`}
                        className="qv-card-interactive group flex items-center gap-3 rounded-xl border bg-card px-4 py-3 text-left no-underline"
                      >
                        <Clock
                          aria-hidden="true"
                          size={18}
                          strokeWidth={1.75}
                          className="shrink-0 text-muted-foreground"
                        />
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">
                          {p.name}
                        </span>
                        {p.kind === 'demo' && (
                          <span
                            className="shrink-0 rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider"
                            style={{
                              color: 'var(--color-chart-2)',
                              background:
                                'color-mix(in srgb, var(--color-chart-2) 12%, transparent)',
                            }}
                          >
                            {t('recent.demoTag')}
                          </span>
                        )}
                        <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
                          {p.lastOpenedAt
                            ? t('recent.lastOpened', { date: formatDate(p.lastOpenedAt) })
                            : t('recent.neverOpened', { date: formatDate(p.createdAt) })}
                        </span>
                        <ArrowRight
                          aria-hidden="true"
                          size={14}
                          className="shrink-0 text-muted-foreground transition-transform duration-200 group-hover:translate-x-0.5"
                        />
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <div className="grid gap-12 md:grid-cols-[1.1fr_1fr] md:gap-16 lg:gap-24">
            <div
              className="qv-stagger-fade"
              style={{ animationDelay: STAGGER_DELAYS.hero }}
            >
              <WelcomeHero />
            </div>
            <div className="flex flex-col gap-4">
              <div
                className="qv-stagger-fade"
                style={{ animationDelay: STAGGER_DELAYS.card1 }}
              >
                <ActionCard
                  accent="primary"
                  icon={Sparkles}
                  title={t('cards.fresh.title')}
                  description={t('cards.fresh.body')}
                  cta={t('cards.fresh.cta')}
                  badge={t('cards.fresh.badge')}
                  disabled={create.isPending}
                  onClick={handleFresh}
                />
              </div>
              <div
                className="qv-stagger-fade"
                style={{ animationDelay: STAGGER_DELAYS.card2 }}
              >
                <ActionCard
                  accent="teal"
                  icon={PlayCircle}
                  title={t('cards.demo.title')}
                  description={t('cards.demo.body')}
                  cta={t('cards.demo.cta')}
                  badge={t('cards.demo.badge')}
                  disabled={create.isPending}
                  onClick={handleDemo}
                />
              </div>
              <div
                className="qv-stagger-fade"
                style={{ animationDelay: STAGGER_DELAYS.card3 }}
              >
                <ActionCard
                  accent="orange"
                  icon={Download}
                  title={t('cards.import.title')}
                  description={t('cards.import.body')}
                  cta={t('cards.import.cta')}
                  badge={t('cards.import.badge')}
                  onClick={() => navigate('/import')}
                />
              </div>
            </div>
            </div>
          </div>
        </main>
        <WelcomeFooter />
      </div>
      <NewPortfolioDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </>
  );
}
