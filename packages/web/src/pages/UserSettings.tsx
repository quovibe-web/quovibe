// packages/web/src/pages/UserSettings.tsx
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '@/api/fetch';
import { Switch } from '@/components/ui/switch';

export default function UserSettings() {
  useEffect(() => { document.title = 'Settings · quovibe'; }, []);
  const { t } = useTranslation('userSettings');
  const [autoFetch, setAutoFetch] = useState<boolean>(false);

  useEffect(() => {
    apiFetch<{ app: { autoFetchPricesOnFirstOpen: boolean } }>('/api/settings')
      .then((s) => setAutoFetch(s.app.autoFetchPricesOnFirstOpen))
      .catch(() => { /* default */ });
  }, []);

  const onToggle = async (next: boolean): Promise<void> => {
    setAutoFetch(next);
    await apiFetch('/api/settings/auto-fetch', {
      method: 'PUT',
      body: JSON.stringify({ autoFetchPricesOnFirstOpen: next }),
    });
  };

  return (
    <main className="mx-auto max-w-2xl p-6">
      <h1 className="text-xl font-semibold">{t('preferences.title')}</h1>
      {/* existing preferences controls: language, theme, sharesPrecision, quotesPrecision,
          showCurrencyCode, showPaSuffix, privacyMode, defaultDataSeriesTaxonomyId */}

      <h2 className="mt-10 text-lg font-semibold">{t('updates.title')}</h2>
      <label className="mt-4 flex items-center gap-3">
        <Switch checked={autoFetch} onCheckedChange={onToggle} />
        <span className="text-sm">{t('updates.autoFetchLabel')}</span>
      </label>
      <p className="mt-1 text-xs text-muted-foreground">{t('updates.autoFetchHint')}</p>
    </main>
  );
}
