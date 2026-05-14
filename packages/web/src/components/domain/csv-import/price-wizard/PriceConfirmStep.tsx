import { useState } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useExecuteCsvPrices } from '@/api/use-csv-import';
import { useGuardedSubmit } from '@/hooks/use-guarded-submit';
import { appendSearch } from '@/lib/router-helpers';
import type { PriceWizardState } from '@/pages/price-import-wizard.utils';
import type { PriceExecuteResult } from '@quovibe/shared';

interface Props {
  state: PriceWizardState;
  onBack: () => void;
}

export function PriceConfirmStep({ state, onBack }: Props) {
  const { t } = useTranslation('csv-import');
  const navigate = useNavigate();
  const { portfolioId } = useParams<{ portfolioId: string }>();
  const { search } = useLocation();
  const executeMutation = useExecuteCsvPrices();
  const [result, setResult] = useState<PriceExecuteResult | null>(null);

  const headers = state.parseResult?.headers ?? [];
  const dateColumnLabel =
    state.columnMapping.date != null ? headers[state.columnMapping.date] : '—';
  const closeColumnLabel =
    state.columnMapping.close != null ? headers[state.columnMapping.close] : '—';

  const { run, inFlight } = useGuardedSubmit(async () => {
    if (!state.parseResult || !state.securityId) return;
    const dateCol = state.columnMapping.date;
    const closeCol = state.columnMapping.close;
    if (dateCol == null || closeCol == null) return;
    try {
      const res = await executeMutation.mutateAsync({
        tempFileId: state.parseResult.tempFileId,
        securityId: state.securityId,
        columnMapping: {
          date: dateCol,
          close: closeCol,
          high: state.columnMapping.high,
          low: state.columnMapping.low,
          volume: state.columnMapping.volume,
        },
        dateFormat: state.dateFormat,
        decimalSeparator: state.decimalSeparator,
        thousandSeparator: state.thousandSeparator,
        skipLines: 0,
      });
      setResult(res);
    } catch {
      // global MutationCache toast surfaces the error to the user
    }
  });

  if (result) {
    return (
      <div className="space-y-6">
        <Alert role="status">
          <AlertDescription>
            {t('prices.success', { inserted: result.inserted, skipped: result.skipped })}
          </AlertDescription>
        </Alert>
        {result.dateRange.from && (
          <p className="text-sm text-[var(--qv-text-secondary)]">
            {t('prices.dateRange')}:{' '}
            <span className="qv-numeric">
              {result.dateRange.from} — {result.dateRange.to}
            </span>
          </p>
        )}
        <div className="flex justify-end">
          <Button
            onClick={() =>
              navigate(
                appendSearch(
                  `/p/${portfolioId}/investments/${state.securityId}`,
                  search,
                ),
              )
            }
          >
            {t('prices.wizard.confirm.doneButton')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="rounded-md">
        <CardHeader>
          <CardTitle>{t('prices.wizard.confirm.summary')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-[var(--qv-text-secondary)]">
              {t('prices.wizard.confirm.security')}
            </span>
            <span className="font-medium">{state.securityName ?? '—'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[var(--qv-text-secondary)]">
              {t('prices.wizard.confirm.rows')}
            </span>
            <span className="qv-numeric">{state.parseResult?.totalRows ?? 0}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[var(--qv-text-secondary)]">
              {t('prices.wizard.confirm.dateColumn')}
            </span>
            <span className="font-mono">{dateColumnLabel}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[var(--qv-text-secondary)]">
              {t('prices.wizard.confirm.closeColumn')}
            </span>
            <span className="font-mono">{closeColumnLabel}</span>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-between">
        <Button variant="outline" onClick={onBack} disabled={inFlight}>
          {t('nav.back')}
        </Button>
        <Button onClick={() => void run()} disabled={inFlight}>
          {inFlight
            ? t('prices.importing')
            : t('prices.wizard.confirm.importButton', {
                count: state.parseResult?.totalRows ?? 0,
              })}
        </Button>
      </div>
    </div>
  );
}
