// packages/web/src/pages/PortfolioSettings.tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { usePortfolioRegistry } from '@/api/use-portfolios';
import { usePortfolio } from '@/context/PortfolioContext';
import { RenamePortfolioDialog } from '@/components/domain/RenamePortfolioDialog';
import { DeletePortfolioDialog } from '@/components/domain/DeletePortfolioDialog';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { Button } from '@/components/ui/button';

export default function PortfolioSettings() {
  useDocumentTitle('Settings');
  const { t } = useTranslation('portfolioSettings');
  const { portfolioId } = useParams<{ portfolioId: string }>();
  const portfolio = usePortfolio();
  const registry = usePortfolioRegistry();
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const entry = registry.data?.portfolios.find((p) => p.id === portfolioId);
  if (!entry) return <div />;

  const onExport = (): void => {
    window.location.assign(`/api/portfolios/${entry.id}/export`);
  };
  const onUpdatePrices = async (): Promise<void> => {
    await fetch(`/api/p/${entry.id}/prices/fetch-all`, { method: 'POST' });
  };

  if (portfolio.kind === 'demo') {
    return (
      <main className="mx-auto max-w-2xl p-6">
        <h1 className="text-xl font-semibold">{t('current')}</h1>
        <p className="mt-2 font-medium">{entry.name} · {t('builtInPlayground')}</p>
        <p className="mt-4 text-sm text-muted-foreground">{t('demoExplainer')}</p>
        <div className="mt-6 flex gap-3">
          <Button onClick={onExport}>📤 {t('export')}</Button>
        </div>
        <h2 className="mt-10 text-lg font-semibold">{t('updates')}</h2>
        <Button className="mt-2" variant="outline" onClick={onUpdatePrices}>⬇ {t('updatePrices')}</Button>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl p-6">
      <h1 className="text-xl font-semibold">{t('current')}</h1>
      <p className="mt-2 font-medium">
        {entry.name} · {t('real')} · {t('createdOn', { date: entry.createdAt.slice(0, 10) })}
      </p>
      <div className="mt-6 flex flex-wrap gap-3">
        <Button variant="outline" onClick={() => setRenameOpen(true)}>✏️ {t('rename.cta')}</Button>
        <Button variant="outline" onClick={onExport}>📤 {t('export')}</Button>
        <Button variant="destructive" onClick={() => setDeleteOpen(true)}>🗑 {t('delete.cta')}</Button>
      </div>
      <h2 className="mt-10 text-lg font-semibold">{t('updates')}</h2>
      <Button className="mt-2" variant="outline" onClick={onUpdatePrices}>⬇ {t('updatePrices')}</Button>

      <RenamePortfolioDialog
        open={renameOpen}
        onOpenChange={setRenameOpen}
        id={entry.id}
        currentName={entry.name}
      />
      <DeletePortfolioDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        id={entry.id}
        name={entry.name}
      />
    </main>
  );
}
