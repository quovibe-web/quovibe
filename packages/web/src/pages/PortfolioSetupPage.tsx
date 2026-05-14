// Full-page setup form for legacy N=0 portfolios. Reached via the
// PortfolioLayout redirect when a portfolio's `account` table is empty
// (the universal safety net for any source whose creation path didn't seed
// the M3 default account layout — pre-fix fresh portfolios + restored
// pre-fix quovibe-db backups). On submit, calls POST /api/p/:pid/setup
// and lands on the dashboard.
//
// BUG-54/55 Phase 5 — Task 5.1.

import { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { WelcomeBackground } from '@/components/welcome/WelcomeBackground';
import { WelcomeTopBar } from '@/components/welcome/WelcomeTopBar';
import { PageHeader } from '@/components/shared/PageHeader';
import { usePortfolioRegistry } from '@/api/use-portfolios';
import {
  useSecuritiesAccounts,
  useSetupPortfolio,
} from '@/api/use-securities-accounts';
import { PortfolioSetupForm } from '@/components/domain/portfolio/PortfolioSetupForm';
import { useGuardedSubmit } from '@/hooks/use-guarded-submit';
import type { SetupPortfolioInput } from '@quovibe/shared';

export default function PortfolioSetupPage() {
  const { portfolioId } = useParams<{ portfolioId: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation('portfolio-setup');
  const registry = usePortfolioRegistry();
  const sec = useSecuritiesAccounts(portfolioId ?? '');
  const mutation = useSetupPortfolio(portfolioId ?? '');

  const entry = registry.data?.portfolios.find((p) => p.id === portfolioId);

  // Self-guard: if a configured portfolio is opened directly via /setup, bounce
  // to its dashboard instead of showing a setup form they don't need. The
  // PortfolioLayout redirect won't catch this branch because /setup is a
  // sibling route (not nested under PortfolioLayout — that arrangement
  // prevents the inverse infinite loop).
  useEffect(() => {
    if (portfolioId && sec.data && sec.data.length > 0) {
      navigate(`/p/${portfolioId}/dashboard`, { replace: true });
    }
  }, [sec.data, portfolioId, navigate]);

  // Save-button re-entry guard: see frontend.md "Save-button re-entry guard".
  const { run: handleSubmit, inFlight } = useGuardedSubmit(
    async (input: SetupPortfolioInput) => {
      if (!portfolioId) return;
      try {
        await mutation.mutateAsync(input);
        navigate(`/p/${portfolioId}/dashboard`);
      } catch (err) {
        const msg = (err as Error).message;
        // Cross-tab race: another tab finished setup before this one did.
        if (msg === 'ALREADY_SETUP') {
          toast.info(t('errors.alreadySetup'));
          navigate(`/p/${portfolioId}/dashboard`, { replace: true });
          return;
        }
        toast.error(t('errors.setupFailed', { msg }));
      }
    },
  );

  if (sec.isLoading || !entry) {
    return <div className="min-h-svh" />;
  }

  return (
    <>
      <WelcomeBackground />
      <div className="flex min-h-svh flex-col">
        <WelcomeTopBar />
        <main className="flex flex-1 items-center justify-center px-6 py-10">
          <div className="w-full max-w-xl rounded-md border border-[var(--qv-border-subtle)] bg-card p-8 shadow-[var(--shadow-sm)]">
            <div className="mb-6">
              <PageHeader
                title={t('setupPage.title', { name: entry.name })}
                subtitle={t('setupPage.description')}
              />
            </div>
            <PortfolioSetupForm
              onSubmit={handleSubmit}
              isSubmitting={inFlight || mutation.isPending}
              submitLabel={t('submit.finishSetup')}
            />
          </div>
        </main>
      </div>
    </>
  );
}
