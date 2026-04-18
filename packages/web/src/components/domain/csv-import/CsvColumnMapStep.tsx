// packages/web/src/components/domain/csv-import/CsvColumnMapStep.tsx
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAccounts } from '@/api/use-accounts';
import { usePortfolio } from '@/context/PortfolioContext';
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
  const portfolio = usePortfolio();

  const headers = state.parseResult?.headers ?? [];

  const depositName = useMemo(() => {
    if (!accounts) return null;
    const owner = accounts.find((a) => a.id === portfolio.id);
    if (!owner?.referenceAccountId) return null;
    const deposit = accounts.find((a) => a.id === owner.referenceAccountId);
    return deposit?.name ?? null;
  }, [portfolio.id, accounts]);

  const requiredSet = new Set<string>(requiredTradeColumns);

  const allRequiredMapped = requiredTradeColumns.every((f) => state.columnMapping[f] != null);

  return (
    <div className="space-y-6">
      {/* Column mapping */}
      <Card>
        <CardHeader>
          <CardTitle>{t('columns.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-4">{t('columns.description')}</p>
          {depositName && (
            <p className="text-xs text-muted-foreground mb-4">
              {t('columns.depositHint', { name: depositName })}
            </p>
          )}
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
