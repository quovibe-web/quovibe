// packages/web/src/components/domain/DashboardEmptyState.tsx
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useCreatePortfolio, usePortfolioRegistry } from '@/api/use-portfolios';

export function DashboardEmptyState() {
  const { t } = useTranslation('dashboard');
  const { portfolioId } = useParams<{ portfolioId: string }>();
  const navigate = useNavigate();
  const registry = usePortfolioRegistry();
  const createDemo = useCreatePortfolio();

  const demoId = registry.data?.portfolios.find((p) => p.kind === 'demo')?.id ?? null;
  const onTryDemo = (): void => {
    if (demoId) {
      navigate(`/p/${demoId}/dashboard`);
      return;
    }
    createDemo.mutate({ source: 'demo' }, {
      onSuccess: (r) => navigate(`/p/${r.entry.id}/dashboard`),
    });
  };

  return (
    <main className="mx-auto mt-10 max-w-2xl rounded-lg border p-10 text-center">
      <h2 className="text-lg font-semibold">{t('empty.title')}</h2>
      <section className="mt-6 space-y-2">
        <h3 className="text-sm font-medium">{t('empty.importHeader')}</h3>
        <button className="rounded bg-primary px-3 py-2 text-primary-foreground"
                onClick={() => navigate(`/p/${portfolioId}/import/csv`)}>
          📄 {t('empty.importCsv')}
        </button>
        <button className="ml-2 rounded border px-3 py-2"
                onClick={() => navigate(`/p/${portfolioId}/transactions/new`)}>
          + {t('empty.addManually')}
        </button>
      </section>
      <hr className="my-6" />
      <section>
        <p className="mb-2 text-sm text-muted-foreground">{t('empty.wantToSee')}</p>
        <button className="rounded border px-3 py-2" onClick={onTryDemo}>
          🧪 {t('empty.tryDemo')}
        </button>
      </section>
    </main>
  );
}
