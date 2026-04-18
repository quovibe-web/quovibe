// packages/web/src/components/domain/csv-import/CsvSecurityMatchStep.tsx
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { usePreviewCsvTrades } from '@/api/use-csv-import';
import { useSecurities } from '@/api/use-securities';
import { usePortfolio } from '@/context/PortfolioContext';
import type { WizardState } from '@/pages/CsvImportPage';

interface Props {
  state: WizardState;
  onUpdate: (partial: Partial<WizardState>) => void;
  onBack: () => void;
  onNext: () => void;
}

export function CsvSecurityMatchStep({ state, onUpdate, onBack, onNext }: Props) {
  const { t } = useTranslation('csv-import');
  const previewMutation = usePreviewCsvTrades();
  const { data: allSecurities } = useSecurities();
  const portfolio = usePortfolio();
  const [localMapping, setLocalMapping] = useState<Record<string, string>>(state.securityMapping);

  // Call preview on mount
  useEffect(() => {
    if (!state.parseResult) return;
    previewMutation.mutate(
      {
        tempFileId: state.parseResult.tempFileId,
        columnMapping: state.columnMapping,
        dateFormat: state.dateFormat,
        decimalSeparator: state.decimalSeparator,
        thousandSeparator: state.thousandSeparator,
        targetPortfolioId: portfolio.id,
      },
      {
        onSuccess: (result) => {
          onUpdate({ previewResult: result });
          // Pre-fill mapping from auto-matches
          const mapping: Record<string, string> = {};
          for (const sec of result.unmatchedSecurities) {
            if (sec.suggestedMatch) {
              mapping[sec.csvName] = sec.suggestedMatch.id;
            }
          }
          setLocalMapping(mapping);
        },
      },
    );
  }, []);

  const unmatchedSecurities = state.previewResult?.unmatchedSecurities ?? [];

  const handleNext = () => {
    onUpdate({
      securityMapping: localMapping,
      newSecurities: unmatchedSecurities
        .filter((s) => !localMapping[s.csvName])
        .map((s) => ({
          name: s.csvName,
          isin: s.csvIsin,
          ticker: s.csvTicker,
          currency: 'EUR', // default currency
        })),
    });
    onNext();
  };

  if (previewMutation.isPending) {
    return <div className="text-center py-12 text-muted-foreground">{t('securities.loading')}</div>;
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t('securities.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-4">{t('securities.description')}</p>

          {unmatchedSecurities.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('securities.none')}</p>
          ) : (
            <div className="space-y-3">
              {unmatchedSecurities.map((sec) => {
                const isMatched = !!localMapping[sec.csvName];
                return (
                  <div key={sec.csvName} className="flex items-center gap-4 p-3 border rounded-md">
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
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-between">
        <Button variant="outline" onClick={onBack}>
          {t('nav.back')}
        </Button>
        <Button onClick={handleNext}>{t('nav.next')}</Button>
      </div>
    </div>
  );
}
