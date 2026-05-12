import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { FileText, Plus, FlaskConical } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
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
    <main className="mx-auto mt-12 max-w-2xl px-6 text-center qv-page">
      <h2
        className="text-3xl md:text-4xl font-medium leading-tight tracking-[-0.015em]"
        style={{
          fontFamily: 'var(--font-display)',
          fontVariationSettings: "'opsz' 72, 'wght' 500",
        }}
      >
        {t('empty.title')}
      </h2>

      <section className="mt-10">
        <div className="qv-eyebrow mb-4">{t('empty.importHeader')}</div>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Button
            onClick={() => navigate(`/p/${portfolioId}/import/csv`)}
            className="gap-2"
          >
            <FileText className="h-4 w-4" />
            {t('empty.importCsv')}
          </Button>
          <Button
            variant="outline"
            onClick={() => navigate(`/p/${portfolioId}/transactions/new`)}
            className="gap-2"
          >
            <Plus className="h-4 w-4" />
            {t('empty.addManually')}
          </Button>
        </div>
      </section>

      <div className="my-10 flex items-center justify-center">
        <Separator className="max-w-[120px]" />
      </div>

      <section>
        <p className="text-sm text-[var(--qv-text-secondary)] mb-4">{t('empty.wantToSee')}</p>
        <Button variant="ghost" onClick={onTryDemo} className="gap-2">
          <FlaskConical className="h-4 w-4" />
          {t('empty.tryDemo')}
        </Button>
      </section>
    </main>
  );
}
