// packages/web/src/components/domain/csv-import/CsvSecurityMatchStep.tsx
//
// BUG-54/55 Phase 6 — Task 6.1.
//
// Step 3 of the CSV trade-import wizard. Resolves the inner securities-account
// UUID before invoking preview:
//   N=0 → navigate to /p/:id/setup (defence in depth — PortfolioLayout's
//         Phase 5 redirect should already have caught this).
//   N=1 → auto-pick the sole row, fire preview.
//   N>1 → render a picker; gate Next + preview until the user selects.
//
// The wire field is `targetSecuritiesAccountId` (Phase 1 rename); the
// previously-conflated `portfolio.id` is the OUTER metadata UUID and is no
// longer sent.

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { usePreviewCsvTrades } from '@/api/use-csv-import';
import { useSecurities } from '@/api/use-securities';
import { useSecuritiesAccounts } from '@/api/use-securities-accounts';
import { useAccounts } from '@/api/use-accounts';
import { usePortfolio } from '@/context/PortfolioContext';
import { CURRENCIES } from '@/lib/currencies';
import type { WizardState } from '@/pages/CsvImportPage';
import type { TradePreviewResult } from '@quovibe/shared';
import { resolveNewSecurityCurrency } from './csv-security-match-step.utils';

interface Props {
  state: WizardState;
  onUpdate: (partial: Partial<WizardState>) => void;
  onBack: () => void;
  onNext: () => void;
}

// Maps server-side CsvImportError codes (thrown by apiFetch as Error.message)
// to i18n keys. Keep the code-list aligned with .claude/rules/csv-import.md.
function mapPreviewError(message: string): string {
  switch (message) {
    case 'INVALID_SECURITIES_ACCOUNT': return 'errors.invalidSecuritiesAccount';
    case 'NO_REFERENCE_ACCOUNT': return 'errors.noReferenceAccount';
    case 'TEMP_FILE_EXPIRED': return 'errors.tempExpired';
    case 'IMPORT_IN_PROGRESS': return 'errors.importInProgress';
    default: return 'errors.previewFailed';
  }
}

export function CsvSecurityMatchStep({ state, onUpdate, onBack, onNext }: Props) {
  const { t } = useTranslation('csv-import');
  const navigate = useNavigate();
  const portfolio = usePortfolio();
  const previewMutation = usePreviewCsvTrades();
  const { data: allSecurities } = useSecurities();
  const secAccounts = useSecuritiesAccounts(portfolio.id);
  const { data: allAccounts, isLoading: accountsLoading } = useAccounts();
  const [localMapping, setLocalMapping] = useState<Record<string, string>>(state.securityMapping);
  const [currencyOverrides, setCurrencyOverrides] = useState<Record<string, string>>({});

  // Picked securities account's resolved reference-deposit currency. The
  // render is gated on `accountsLoading` below, so by the time this runs
  // `allAccounts` is loaded and the picked account is normally present.
  const pickedAccount = allAccounts?.find((a) => a.id === state.targetSecuritiesAccountId);
  const portfolioCurrency = pickedAccount?.currency ?? 'EUR';
  // Replay-fn for the Retry button. Each preview path (initial entry, or the
  // finalizing re-fire triggered by Next) installs its own replay closure;
  // Retry runs whichever was most recent. Without this, Retry would fall back
  // to the initial-entry shape after a finalizing failure and wipe the
  // overlay-aware summary — the user would think Retry reverted their work.
  const lastPreviewFnRef = useRef<(() => void) | null>(null);

  type PreviewOverlay = {
    securityMapping?: Record<string, string>;
    newSecurityNames?: string[];
  };

  function firePreview(
    targetSecuritiesAccountId: string,
    overlay: PreviewOverlay,
    onSuccess: (result: TradePreviewResult) => void,
  ) {
    if (!state.parseResult) return;
    const fire = () => {
      if (!state.parseResult) return;
      previewMutation.mutate(
        {
          tempFileId: state.parseResult.tempFileId,
          delimiter: state.delimiter,
          columnMapping: state.columnMapping,
          dateFormat: state.dateFormat,
          decimalSeparator: state.decimalSeparator,
          thousandSeparator: state.thousandSeparator,
          targetSecuritiesAccountId,
          ...overlay,
        },
        { onSuccess },
      );
    };
    lastPreviewFnRef.current = fire;
    fire();
  }

  function runInitialPreview(targetSecuritiesAccountId: string) {
    firePreview(targetSecuritiesAccountId, {}, (result) => {
      onUpdate({ previewResult: result });
      const mapping: Record<string, string> = {};
      for (const sec of result.unmatchedSecurities) {
        if (sec.suggestedMatch) {
          mapping[sec.csvName] = sec.suggestedMatch.id;
        }
      }
      setLocalMapping(mapping);
    });
  }

  // N branching on first load. Auto-picks N=1; bounces N=0 to /setup as a
  // defence-in-depth guard against routing changes that might bypass
  // PortfolioLayout's Phase 5 redirect.
  useEffect(() => {
    if (secAccounts.isLoading || !secAccounts.data) return;
    const list = secAccounts.data;
    if (list.length === 0) {
      navigate(`/p/${portfolio.id}/setup`, { replace: true });
      return;
    }
    if (list.length === 1 && !state.targetSecuritiesAccountId) {
      onUpdate({ targetSecuritiesAccountId: list[0].id });
    }
  }, [secAccounts.isLoading, secAccounts.data, portfolio.id, navigate, onUpdate, state.targetSecuritiesAccountId]);

  // Fire preview once we have a target. Re-fires when the user changes the
  // picker selection (N>1 case).
  useEffect(() => {
    if (state.targetSecuritiesAccountId && state.parseResult) {
      runInitialPreview(state.targetSecuritiesAccountId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.targetSecuritiesAccountId]);

  const showPicker = (secAccounts.data?.length ?? 0) > 1;
  const unmatchedSecurities = state.previewResult?.unmatchedSecurities ?? [];
  const hasError = previewMutation.isError;
  const errorKey = hasError ? mapPreviewError(previewMutation.error?.message ?? '') : null;

  // BUG-100: re-fire preview with the user's finalized resolutions before
  // advancing to Step 4, so Step 4's summary matches what execute will do.
  // On error we stay on Step 3; Retry replays via lastPreviewFnRef, preserving
  // the overlay. Skips the re-fire round-trip entirely when the user hasn't
  // made any choices AND there are no unmatched-create-new rows.
  const handleNext = () => {
    if (!state.targetSecuritiesAccountId || !state.parseResult) return;

    const newSecs = unmatchedSecurities
      .filter((s) => !localMapping[s.csvName])
      .map((s) => ({
        name: s.csvName,
        isin: s.csvIsin,
        ticker: s.csvTicker,
        currency: resolveNewSecurityCurrency(
          s.csvCurrencies ?? [],
          portfolioCurrency,
          currencyOverrides[s.csvName],
        ),
      }));

    if (newSecs.length === 0 && Object.keys(localMapping).length === 0) {
      onUpdate({ securityMapping: {}, newSecurities: [] });
      onNext();
      return;
    }

    firePreview(
      state.targetSecuritiesAccountId,
      { securityMapping: localMapping, newSecurityNames: newSecs.map((s) => s.name) },
      (refined) => {
        onUpdate({
          previewResult: refined,
          securityMapping: localMapping,
          newSecurities: newSecs,
        });
        onNext();
      },
    );
  };

  if (secAccounts.isLoading || accountsLoading) {
    return <div className="text-center py-12 text-muted-foreground">{t('securities.pickerLoading')}</div>;
  }

  return (
    <div className="space-y-6">
      {showPicker && (
        <Card>
          <CardHeader><CardTitle>{t('securities.picker.label')}</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <p className="text-sm text-muted-foreground">{t('securities.picker.description')}</p>
            <Label htmlFor="securities-account-picker" className="sr-only">
              {t('securities.picker.label')}
            </Label>
            <Select
              value={state.targetSecuritiesAccountId ?? ''}
              onValueChange={(v) => onUpdate({ targetSecuritiesAccountId: v })}
            >
              <SelectTrigger id="securities-account-picker" className="w-80">
                <SelectValue placeholder={t('securities.picker.placeholder')} />
              </SelectTrigger>
              <SelectContent>
                {(secAccounts.data ?? []).map((acc) => (
                  <SelectItem key={acc.id} value={acc.id}>
                    {acc.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>
      )}

      {hasError && errorKey && (
        <Alert variant="destructive" role="alert">
          <AlertDescription className="flex items-start justify-between gap-4">
            <span>{t(errorKey)}</span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => lastPreviewFnRef.current?.()}
              disabled={!state.targetSecuritiesAccountId || !lastPreviewFnRef.current}
            >
              {t('nav.retry')}
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {previewMutation.isPending ? (
        <div className="text-center py-12 text-muted-foreground">{t('securities.loading')}</div>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>{t('securities.title')}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-4">{t('securities.description')}</p>

            {hasError ? null : !state.targetSecuritiesAccountId ? (
              <p className="text-sm text-muted-foreground">{t('securities.picker.placeholder')}</p>
            ) : unmatchedSecurities.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('securities.none')}</p>
            ) : (
              <div className="space-y-3">
                {unmatchedSecurities.map((sec) => {
                  const isMatched = !!localMapping[sec.csvName];
                  const csvCurrencies = sec.csvCurrencies ?? [];
                  const resolvedCurrency = resolveNewSecurityCurrency(
                    csvCurrencies,
                    portfolioCurrency,
                    currencyOverrides[sec.csvName],
                  );
                  const showConflictWarning =
                    !isMatched && csvCurrencies.length > 1 && !currencyOverrides[sec.csvName];
                  const showFallbackWarning =
                    !isMatched && csvCurrencies.length === 0 && !currencyOverrides[sec.csvName];
                  return (
                    <div key={sec.csvName} className="space-y-2 p-3 border rounded-md">
                      <div className="flex items-center gap-4">
                        <div className="flex-1">
                          <div className="font-medium text-sm">{sec.csvName}</div>
                          {sec.csvIsin && (
                            <div className="text-xs text-muted-foreground">ISIN: {sec.csvIsin}</div>
                          )}
                        </div>

                        <Badge
                          variant={isMatched ? 'default' : 'secondary'}
                          className={isMatched ? 'bg-green-600' : 'bg-amber-500'}
                        >
                          {isMatched ? t('securities.status.matched') : t('securities.status.new')}
                        </Badge>

                        <Select
                          value={localMapping[sec.csvName] ?? '__new'}
                          onValueChange={(v) => {
                            setLocalMapping((prev) => {
                              const next = { ...prev };
                              if (v === '__new') {
                                delete next[sec.csvName];
                              } else {
                                next[sec.csvName] = v;
                              }
                              return next;
                            });
                          }}
                        >
                          <SelectTrigger className="w-60">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__new">{t('securities.createNew')}</SelectItem>
                            {(allSecurities ?? []).map((s) => (
                              <SelectItem key={s.id} value={s.id}>
                                {s.name}
                                {s.isin ? ` (${s.isin})` : ''}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>

                        {!isMatched && (
                          <Select
                            value={resolvedCurrency}
                            onValueChange={(v) => {
                              setCurrencyOverrides((prev) => ({ ...prev, [sec.csvName]: v }));
                            }}
                          >
                            <SelectTrigger className="w-32" aria-label={t('securities.currency.label')}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {CURRENCIES.map((c) => (
                                <SelectItem key={c.code} value={c.code}>
                                  {c.code}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                      </div>

                      {showConflictWarning && (
                        <Alert variant="default" className="border-amber-500/50 text-amber-700 dark:text-amber-400">
                          <AlertDescription>
                            {t('securities.currency.conflict', {
                              currencies: csvCurrencies.join(', '),
                              name: sec.csvName,
                            })}
                          </AlertDescription>
                        </Alert>
                      )}

                      {showFallbackWarning && (
                        <Alert variant="default" className="border-amber-500/50 text-amber-700 dark:text-amber-400">
                          <AlertDescription>
                            {t('securities.currency.fallback', { currency: resolvedCurrency })}
                          </AlertDescription>
                        </Alert>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <div className="flex justify-between">
        <Button variant="outline" onClick={onBack}>
          {t('nav.back')}
        </Button>
        <Button
          onClick={handleNext}
          disabled={
            hasError
            || !state.previewResult
            || !state.targetSecuritiesAccountId
            || previewMutation.isPending
          }
        >
          {t('nav.next')}
        </Button>
      </div>
    </div>
  );
}
