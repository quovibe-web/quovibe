import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { SecurityDetailResponse, TestFetchResponse } from '@/api/types';
import { formatDate } from '@/lib/formatters';
import {
  useUpdateFeedConfig,
  useTestFetchPrices,
  useFetchPrices,
} from '@/api/use-securities';
import { usePortfolio } from '@/api/use-portfolio';

type FeedMode = 'YAHOO' | 'GENERIC_HTML_TABLE' | 'GENERIC-JSON' | 'ALPHAVANTAGE' | '';

function normalizeProvider(feed: string | null): FeedMode {
  if (!feed) return '';
  if (feed === 'YAHOO' || feed === 'YAHOO_FINANCE_2') return 'YAHOO';
  if (feed === 'GENERIC_HTML_TABLE' || feed === 'TABLE') return 'GENERIC_HTML_TABLE';
  if (feed === 'GENERIC-JSON' || feed === 'JSON') return 'GENERIC-JSON';
  if (feed === 'ALPHAVANTAGE') return 'ALPHAVANTAGE';
  return '';
}

interface Props {
  security: SecurityDetailResponse;
}

export function PriceFeedConfig({ security }: Props) {
  const { t } = useTranslation('securities');
  const { data: portfolio } = usePortfolio();
  const hasAvApiKey = portfolio?.config?.['hasAlphaVantageApiKey'] === 'true';
  const [provider, setProvider] = useState<FeedMode>(() => normalizeProvider(security.feed));
  const [feedUrl, setFeedUrl] = useState(security.feedUrl ?? '');
  const [pathToDate, setPathToDate] = useState(security.feedProperties?.['GENERIC-JSON-DATE'] ?? '$[*].date');
  const [pathToClose, setPathToClose] = useState(security.feedProperties?.['GENERIC-JSON-CLOSE'] ?? '$[*].close');
  const [fetchMode, setFetchMode] = useState<'merge' | 'replace'>('merge');
  const [testResult, setTestResult] = useState<TestFetchResponse | null>(null);
  const [testError, setTestError] = useState<string | null>(null);

  // Re-sync when security changes (e.g. after save)
  useEffect(() => {
    setProvider(normalizeProvider(security.feed));
    setFeedUrl(security.feedUrl ?? '');
    setPathToDate(security.feedProperties?.['GENERIC-JSON-DATE'] ?? '$[*].date');
    setPathToClose(security.feedProperties?.['GENERIC-JSON-CLOSE'] ?? '$[*].close');
  }, [security.id]);

  const updateFeed = useUpdateFeedConfig(security.id);
  const testFetch = useTestFetchPrices(security.id);
  const fetchPrices = useFetchPrices(security.id);

  function buildConfig() {
    const base: Parameters<typeof updateFeed.mutate>[0] = { feed: provider };
    if (provider === 'YAHOO' || provider === 'ALPHAVANTAGE') {
      // ticker is stored in security.ticker, no feedUrl needed
    } else if (provider === 'GENERIC_HTML_TABLE') {
      base.feedUrl = feedUrl;
    } else if (provider === 'GENERIC-JSON') {
      base.feedUrl = feedUrl;
      base.pathToDate = pathToDate;
      base.pathToClose = pathToClose;
    }
    return base;
  }

  async function handleSaveConfig() {
    await updateFeed.mutateAsync(buildConfig());
  }

  async function handleTestFetch() {
    setTestResult(null);
    setTestError(null);
    try {
      const config = buildConfig();
      const result = await testFetch.mutateAsync(
        provider ? config : undefined,
      );
      setTestResult(result);
    } catch (e) {
      setTestError(e instanceof Error ? e.message : 'Fetch failed');
    }
  }

  async function handleFetchAndSave() {
    await fetchPrices.mutateAsync(fetchMode);
    setTestResult(null);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Price Feed</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1">
          <Label>{t('historicalQuotes.provider')}</Label>
          <select
            className="w-full border rounded-md px-2 py-1.5 text-sm bg-background"
            value={provider}
            onChange={e => setProvider(e.target.value as FeedMode)}
          >
            <option value="">{t('historicalQuotes.none')}</option>
            <option value="YAHOO">{t('historicalQuotes.yahoo')}</option>
            <option value="GENERIC_HTML_TABLE">{t('historicalQuotes.htmlTable')}</option>
            <option value="GENERIC-JSON">{t('historicalQuotes.jsonFeed')}</option>
            <option value="ALPHAVANTAGE">{t('historicalQuotes.alphaVantage')}</option>
          </select>
        </div>

        {provider === 'YAHOO' && (
          <div className="text-sm text-muted-foreground">
            {t('historicalQuotes.tickerLabel')} <span className="font-mono">{security.ticker ?? '—'}</span> {t('historicalQuotes.editViaMasterData')}
          </div>
        )}

        {provider === 'ALPHAVANTAGE' && (
          <div className="space-y-2">
            <div className="text-sm text-muted-foreground">
              {t('historicalQuotes.tickerLabel')} <span className="font-mono">{security.ticker ?? '—'}</span> {t('historicalQuotes.editViaMasterData')}
            </div>
            {!hasAvApiKey && (
              <p className="text-xs text-[var(--qv-warning)]">
                {t('historicalQuotes.avNoApiKey')}{' '}
                <a href="/settings" className="underline">{t('historicalQuotes.avGoToSettings')}</a>
              </p>
            )}
          </div>
        )}

        {(provider === 'GENERIC_HTML_TABLE' || provider === 'GENERIC-JSON') && (
          <div className="space-y-1">
            <Label>{t('historicalQuotes.feedUrl')}</Label>
            <Input
              value={feedUrl}
              onChange={e => setFeedUrl(e.target.value)}
              placeholder={t('historicalQuotes.feedUrlPlaceholder')}
              className="font-mono text-xs"
            />
          </div>
        )}

        {provider === 'GENERIC-JSON' && (
          <>
            <div className="space-y-1">
              <Label>{t('historicalQuotes.jsonPathDate')}</Label>
              <Input
                value={pathToDate}
                onChange={e => setPathToDate(e.target.value)}
                placeholder={t('historicalQuotes.jsonPathDatePlaceholder')}
                className="font-mono text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label>{t('historicalQuotes.jsonPathClose')}</Label>
              <Input
                value={pathToClose}
                onChange={e => setPathToClose(e.target.value)}
                placeholder={t('historicalQuotes.jsonPathClosePlaceholder')}
                className="font-mono text-xs"
              />
            </div>
          </>
        )}

        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={handleSaveConfig}
            disabled={updateFeed.isPending}
          >
            {updateFeed.isPending ? t('common:saving') : t('common:save')}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={handleTestFetch}
            disabled={testFetch.isPending || !provider}
          >
            {testFetch.isPending ? t('historicalQuotes.fetching') : t('historicalQuotes.testFetch')}
          </Button>
        </div>

        {updateFeed.isSuccess && (
          <p className="text-xs text-[var(--qv-success)]">{t('common:toasts.configSaved')}</p>
        )}
        {updateFeed.isError && (
          <p className="text-xs text-destructive">{t('common:toasts.saveFailed', { error: (updateFeed.error as Error).message })}</p>
        )}

        {testError && (
          <p className="text-xs text-destructive">{t('historicalQuotes.testFetchError')} {testError}</p>
        )}

        {testResult?.error && (
          <p className="text-sm text-destructive mt-1">{t('historicalQuotes.error')} {testResult.error}</p>
        )}

        {testResult && !testResult.error && testResult.count === 0 && (
          <p className="text-xs text-[var(--qv-warning)]">
            {t('historicalQuotes.fetchNoResults')}
          </p>
        )}

        {testResult && testResult.count > 0 && (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              {t('historicalQuotes.found')} <span className="font-semibold text-foreground">{testResult.count}</span> {t('historicalQuotes.prices')}
              {testResult.firstDate && testResult.lastDate && (
                <> ({formatDate(testResult.firstDate)} → {formatDate(testResult.lastDate)})</>
              )}
            </p>

            {testResult.prices.length > 0 && (
              <div className="overflow-auto max-h-48 rounded-md border text-xs">
                <table className="w-full">
                  <thead className="bg-muted sticky top-0">
                    <tr>
                      <th className="px-3 py-1 text-left font-medium">{t('historicalQuotes.tableDate')}</th>
                      <th className="px-3 py-1 text-right font-medium">{t('historicalQuotes.tableClose')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {testResult.prices.slice(0, 10).map(p => (
                      <tr key={p.date} className="border-t">
                        <td className="px-3 py-0.5 font-mono">{formatDate(p.date)}</td>
                        <td className="px-3 py-0.5 font-mono text-right">{p.close}</td>
                      </tr>
                    ))}
                    {testResult.prices.length > 10 && (
                      <tr className="border-t">
                        <td colSpan={2} className="px-3 py-0.5 text-muted-foreground text-center">
                          {t('historicalQuotes.moreRows', { count: testResult.prices.length - 10 })}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}

            <div className="flex items-center gap-2">
              <select
                className="border rounded-md px-2 py-1 text-xs bg-background"
                value={fetchMode}
                onChange={e => setFetchMode(e.target.value as 'merge' | 'replace')}
              >
                <option value="merge">{t('historicalQuotes.mergeMode')}</option>
                <option value="replace">{t('historicalQuotes.replaceAll')}</option>
              </select>
              <Button
                size="sm"
                onClick={handleFetchAndSave}
                disabled={fetchPrices.isPending}
              >
                {fetchPrices.isPending ? t('common:saving') : t('historicalQuotes.fetchAndSave')}
              </Button>
            </div>

            {fetchPrices.isSuccess && (
              <p className="text-xs text-[var(--qv-success)]">
                {t('historicalQuotes.savedPrices', { count: fetchPrices.data?.fetched ?? 0 })}
                {fetchPrices.data?.error && (
                  <span className="text-destructive"> {t('historicalQuotes.error')} {fetchPrices.data.error}</span>
                )}
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
