import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { useTestFetchPrices, useFetchPrices } from '@/api/use-securities';
import { usePortfolio } from '@/api/use-portfolio';
import { useScopedApi } from '@/api/use-scoped-api';
import { formatDate } from '@/lib/formatters';
import { SectionHeader } from './SectionHeader';
import { CsvPriceImportDialog } from '@/components/domain/csv-import/CsvPriceImportDialog';
import type { TestFetchResponse } from '@/api/types';
import type { CompletenessStatus } from '@/lib/security-completeness';

type FeedProvider = 'YAHOO' | 'GENERIC_HTML_TABLE' | 'GENERIC-JSON' | 'ALPHAVANTAGE' | '';

export interface PriceFeedValues {
  feed: string;
  feedUrl: string;
  pathToDate: string;
  pathToClose: string;
  latestFeed: string;
  latestFeedUrl: string;
}

interface Props {
  securityId?: string;
  ticker?: string;
  values: PriceFeedValues;
  status?: CompletenessStatus;
  onChange: (patch: Partial<PriceFeedValues>) => void;
}

export function PriceFeedSection({ securityId, ticker, values, status, onChange }: Props) {
  const { t } = useTranslation('securities');
  const { data: portfolio } = usePortfolio();
  const hasAvApiKey = portfolio?.config?.['hasAlphaVantageApiKey'] === 'true';
  const [testResult, setTestResult] = useState<TestFetchResponse | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [fetchMode, setFetchMode] = useState<'merge' | 'replace'>('merge');
  const api = useScopedApi();

  const provider = (values.feed || '') as FeedProvider;
  const latestProvider = values.latestFeed as FeedProvider;

  const testFetch = useTestFetchPrices(securityId ?? '');
  const fetchPrices = useFetchPrices(securityId ?? '');

  function buildTestConfig() {
    const base: Record<string, string | undefined> = { feed: provider || undefined };
    if (provider === 'GENERIC_HTML_TABLE') {
      base.feedUrl = values.feedUrl;
    } else if (provider === 'GENERIC-JSON') {
      base.feedUrl = values.feedUrl;
      base.pathToDate = values.pathToDate;
      base.pathToClose = values.pathToClose;
    }
    return base;
  }

  async function handleTestFetch() {
    setTestResult(null);
    setTestError(null);
    try {
      const result = await testFetch.mutateAsync(provider ? buildTestConfig() : undefined);
      setTestResult(result);
    } catch (e) {
      setTestError(e instanceof Error ? e.message : 'Fetch failed');
    }
  }

  async function handleFetchAndSave() {
    if (securityId) {
      await api.fetch(`/api/securities/${securityId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          feed: values.feed || undefined,
          feedUrl: values.feedUrl || undefined,
          pathToDate: values.pathToDate || undefined,
          pathToClose: values.pathToClose || undefined,
        }),
      });
    }
    await fetchPrices.mutateAsync(fetchMode);
  }

  const showUrlField = provider === 'GENERIC_HTML_TABLE' || provider === 'GENERIC-JSON';
  const showJsonPaths = provider === 'GENERIC-JSON';
  const showTickerInfo = provider === 'YAHOO' || provider === 'ALPHAVANTAGE';

  return (
    <div>
      <SectionHeader
        title={t('securityEditor.priceFeed')}
        id="section-price-feed"
        status={status}
      />
      <div className="space-y-4 py-3">
        {/* Historical Feed sub-header */}
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          {t('securityEditor.historicalFeed')}
        </p>

        <div className="space-y-1.5">
          <Label>{t('securityEditor.provider')}</Label>
          <select
            className="w-full border rounded-md px-2 py-1.5 text-sm bg-background"
            value={provider}
            onChange={e => onChange({ feed: e.target.value })}
          >
            <option value="">{t('securityEditor.providerNone')}</option>
            <option value="YAHOO">{t('historicalQuotes.yahoo')}</option>
            <option value="GENERIC_HTML_TABLE">{t('historicalQuotes.htmlTable')}</option>
            <option value="GENERIC-JSON">{t('historicalQuotes.jsonFeed')}</option>
            <option value="ALPHAVANTAGE">{t('historicalQuotes.alphaVantage')}</option>
          </select>
        </div>

        {showTickerInfo && (
          <div className="text-sm text-muted-foreground">
            {t('historicalQuotes.tickerLabel')} <span className="font-mono">{ticker || '—'}</span>
          </div>
        )}

        {provider === 'ALPHAVANTAGE' && !hasAvApiKey && (
          <p className="text-xs text-[var(--qv-warning)]">
            {t('historicalQuotes.avNoApiKey')}{' '}
            <a href="/settings" className="underline">{t('historicalQuotes.avGoToSettings')}</a>
          </p>
        )}

        {showUrlField && (
          <div className="space-y-1.5">
            <Label>{t('securityEditor.feedUrl')}</Label>
            <Input
              value={values.feedUrl}
              onChange={e => onChange({ feedUrl: e.target.value })}
              placeholder={t('securityEditor.feedUrlPlaceholder')}
              className="font-mono text-xs"
            />
          </div>
        )}

        {showJsonPaths && (
          <>
            <div className="space-y-1.5">
              <Label>{t('historicalQuotes.jsonPathDate')}</Label>
              <Input
                value={values.pathToDate}
                onChange={e => onChange({ pathToDate: e.target.value })}
                placeholder={t('historicalQuotes.jsonPathDatePlaceholder')}
                className="font-mono text-xs"
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t('historicalQuotes.jsonPathClose')}</Label>
              <Input
                value={values.pathToClose}
                onChange={e => onChange({ pathToClose: e.target.value })}
                placeholder={t('historicalQuotes.jsonPathClosePlaceholder')}
                className="font-mono text-xs"
              />
            </div>
          </>
        )}

        {!securityId && provider && (
          <p className="text-xs text-muted-foreground">{t('historicalQuotes.saveFirstToTest')}</p>
        )}

        {securityId && (
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={handleTestFetch}
              disabled={testFetch.isPending || !provider}
            >
              {testFetch.isPending ? t('securityEditor.updating') : t('securityEditor.updatePrices')}
            </Button>
            <CsvPriceImportDialog securityId={securityId} securityName={ticker ?? ''} />
          </div>
        )}

        {testError && (
          <p className="text-xs text-destructive">{t('securityEditor.fetchError')}: {testError}</p>
        )}
        {testResult?.error && (
          <p className="text-sm text-destructive">{t('historicalQuotes.error')} {testResult.error}</p>
        )}
        {testResult && !testResult.error && testResult.count === 0 && (
          <p className="text-xs text-[var(--qv-warning)]">{t('historicalQuotes.fetchNoResults')}</p>
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
                    {testResult.prices.slice(0, 20).map(p => (
                      <tr key={p.date} className="border-t">
                        <td className="px-3 py-0.5 font-mono">{formatDate(p.date)}</td>
                        <td className="px-3 py-0.5 font-mono text-right">{p.close}</td>
                      </tr>
                    ))}
                    {testResult.prices.length > 20 && (
                      <tr className="border-t">
                        <td colSpan={2} className="px-3 py-0.5 text-muted-foreground text-center">
                          {t('historicalQuotes.moreRows', { count: testResult.prices.length - 20 })}
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
                type="button"
                size="sm"
                onClick={handleFetchAndSave}
                disabled={fetchPrices.isPending}
              >
                {fetchPrices.isPending ? t('common:saving') : t('securityEditor.fetchAndSave')}
              </Button>
            </div>
            {fetchPrices.isSuccess && (
              <p className="text-xs text-[var(--qv-success)]">
                {t('historicalQuotes.savedPrices', { count: fetchPrices.data?.fetched ?? 0 })}
              </p>
            )}
          </div>
        )}

        <Separator className="my-2" />

        {/* Latest Feed sub-header */}
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          {t('securityEditor.latestFeed')}
        </p>

        <div className="space-y-1.5">
          <Label>{t('securityEditor.provider')}</Label>
          <select
            className="w-full border rounded-md px-2 py-1.5 text-sm bg-background"
            value={values.latestFeed}
            onChange={e => onChange({ latestFeed: e.target.value })}
          >
            <option value="">{t('securityEditor.latestFeedSameAs')}</option>
            <option value="YAHOO">{t('historicalQuotes.yahoo')}</option>
            <option value="GENERIC_HTML_TABLE">{t('historicalQuotes.htmlTable')}</option>
            <option value="GENERIC-JSON">{t('historicalQuotes.jsonFeed')}</option>
            <option value="ALPHAVANTAGE">{t('historicalQuotes.alphaVantage')}</option>
          </select>
        </div>

        {latestProvider && latestProvider !== 'YAHOO' && latestProvider !== 'ALPHAVANTAGE' && (
          <div className="space-y-1.5">
            <Label>{t('latestQuote.url')}</Label>
            <Input
              value={values.latestFeedUrl}
              onChange={e => onChange({ latestFeedUrl: e.target.value })}
              placeholder={t('latestQuote.urlPlaceholder')}
              className="font-mono text-xs"
            />
          </div>
        )}
      </div>
    </div>
  );
}
