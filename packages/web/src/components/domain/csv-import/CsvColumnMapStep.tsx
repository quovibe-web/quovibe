// packages/web/src/components/domain/csv-import/CsvColumnMapStep.tsx
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { useAccounts } from '@/api/use-accounts';
import { tradeColumnFields, requiredTradeColumns } from '@quovibe/shared';
import type { WizardState } from '@/pages/CsvImportPage';

interface Props {
  state: WizardState;
  onUpdate: (partial: Partial<WizardState>) => void;
  onBack: () => void;
  onNext: () => void;
}

export function CsvColumnMapStep({ state, onUpdate, onBack, onNext }: Props) {
  const { t } = useTranslation('csv-import');
  const { data: accounts } = useAccounts();

  const headers = state.parseResult?.headers ?? [];

  const portfolios = useMemo(
    () => (accounts ?? []).filter((a) => a.type === 'portfolio' && !a.isRetired),
    [accounts],
  );

  const depositName = useMemo(() => {
    if (!state.targetPortfolioId || !accounts) return null;
    const portfolio = accounts.find((a) => a.id === state.targetPortfolioId);
    if (!portfolio?.referenceAccountId) return null;
    const deposit = accounts.find((a) => a.id === portfolio.referenceAccountId);
    return deposit?.name ?? null;
  }, [state.targetPortfolioId, accounts]);

  const requiredSet = new Set<string>(requiredTradeColumns);

  const allRequiredMapped =
    requiredTradeColumns.every((f) => state.columnMapping[f] != null) &&
    state.targetPortfolioId !== '';

  return (
    <div className="space-y-6">
      {/* Portfolio selector */}
      <Card>
        <CardContent className="pt-6 space-y-2">
          <Label>{t('columns.portfolio')} *</Label>
          <Select
            value={state.targetPortfolioId}
            onValueChange={(v) => onUpdate({ targetPortfolioId: v })}
          >
            <SelectTrigger>
              <SelectValue placeholder={t('columns.selectPortfolio')} />
            </SelectTrigger>
            <SelectContent>
              {portfolios.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {depositName && (
            <p className="text-xs text-muted-foreground">
              {t('columns.depositHint', { name: depositName })}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Column mapping */}
      <Card>
        <CardHeader>
          <CardTitle>{t('columns.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-4">{t('columns.description')}</p>
          <div className="space-y-3">
            {headers.map((header, colIndex) => (
              <div key={colIndex} className="flex items-center gap-4">
                <span className="w-40 text-sm font-medium truncate">{header}</span>
                <span className="text-muted-foreground">→</span>
                <Select
                  value={
                    Object.entries(state.columnMapping).find(([, idx]) => idx === colIndex)?.[0] ??
                    '__unmapped'
                  }
                  onValueChange={(field) => {
                    const newMapping = { ...state.columnMapping };
                    // Remove any existing mapping for this column index
                    for (const [key, idx] of Object.entries(newMapping)) {
                      if (idx === colIndex) delete newMapping[key];
                    }
                    // Remove any existing mapping for this field (bidirectional)
                    if (field !== '__unmapped') {
                      delete newMapping[field];
                      newMapping[field] = colIndex;
                    }
                    onUpdate({ columnMapping: newMapping });
                  }}
                >
                  <SelectTrigger className="w-48">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__unmapped">{t('columns.unmapped')}</SelectItem>
                    {tradeColumnFields.map((field) => (
                      <SelectItem key={field} value={field}>
                        {t(`columns.field.${field}`)}
                        {requiredSet.has(field) ? ' *' : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Navigation */}
      <div className="flex justify-between">
        <Button variant="outline" onClick={onBack}>
          {t('nav.back')}
        </Button>
        <Button onClick={onNext} disabled={!allRequiredMapped}>
          {t('nav.next')}
        </Button>
      </div>
    </div>
  );
}
