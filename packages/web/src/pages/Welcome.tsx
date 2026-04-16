// packages/web/src/pages/Welcome.tsx
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useCreatePortfolio, type PortfolioRegistryEntry } from '@/api/use-portfolios';
import { toast } from 'sonner';

export default function Welcome() {
  const { t } = useTranslation('welcome');
  useEffect(() => { document.title = `${t('title')} · quovibe`; }, [t]);
  const navigate = useNavigate();
  const create = useCreatePortfolio();
  const [name, setName] = useState('');
  const [file, setFile] = useState<File | null>(null);

  const handleDemo = (): void => {
    create.mutate({ source: 'demo' }, {
      onSuccess: (r) => navigate(`/p/${r.entry.id}/dashboard`),
      onError: (err) => toast.error(t('errors.demoFailed', { msg: (err as Error).message })),
    });
  };
  const handleFresh = (): void => {
    if (!name.trim()) return;
    create.mutate({ source: 'fresh', name }, {
      onSuccess: (r) => navigate(`/p/${r.entry.id}/dashboard`),
      onError: (err) => toast.error(t('errors.createFailed', { msg: (err as Error).message })),
    });
  };
  const handleImportDb = (): void => {
    if (!file) return;
    create.mutate({ source: 'import-quovibe-db', file }, {
      onSuccess: (r: { entry: PortfolioRegistryEntry }) => navigate(`/p/${r.entry.id}/dashboard`),
      onError: (err) => toast.error(t('errors.importFailed', { msg: (err as Error).message })),
    });
  };
  const handleImportPP = (): void => { navigate('/import'); };

  return (
    <main className="mx-auto grid max-w-5xl gap-6 p-8 md:grid-cols-3">
      <h1 className="col-span-full text-2xl font-semibold">{t('title')}</h1>

      <Card title={t('cards.importPP.title')} body={t('cards.importPP.body')}
            cta={t('cards.importPP.cta')} onClick={handleImportPP} />

      <Card title={t('cards.demo.title')} body={t('cards.demo.body')}
            cta={t('cards.demo.cta')} onClick={handleDemo} disabled={create.isPending} />

      <Card title={t('cards.fresh.title')} body={t('cards.fresh.body')}
            cta={t('cards.fresh.cta')} onClick={handleFresh} disabled={!name.trim() || create.isPending}>
        <input
          className="mt-2 w-full rounded border px-2 py-1 text-sm"
          placeholder={t('cards.fresh.namePlaceholder')}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </Card>

      <details className="col-span-full mt-4 text-sm text-muted-foreground">
        <summary className="cursor-pointer">{t('advanced.label')}</summary>
        <div className="mt-2 flex items-center gap-2">
          <input type="file" accept=".db"
                 onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          <button className="rounded bg-primary px-3 py-1 text-primary-foreground disabled:opacity-50"
                  onClick={handleImportDb} disabled={!file || create.isPending}>
            {t('advanced.importDbCta')}
          </button>
        </div>
      </details>
    </main>
  );
}

function Card(props: {
  title: string; body: string; cta: string; onClick: () => void;
  disabled?: boolean; children?: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border p-6 shadow-sm flex flex-col gap-3">
      <h2 className="text-lg font-semibold">{props.title}</h2>
      <p className="text-sm text-muted-foreground">{props.body}</p>
      {props.children}
      <button className="mt-auto rounded bg-primary px-3 py-2 text-primary-foreground disabled:opacity-50"
              onClick={props.onClick} disabled={props.disabled}>
        {props.cta}
      </button>
    </section>
  );
}
