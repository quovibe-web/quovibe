// packages/web/src/components/domain/csv-import/CsvColumnMapStep.tsx
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAccounts } from '@/api/use-accounts';
import { useSecuritiesAccounts } from '@/api/use-securities-accounts';
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
  // BUG-98: Step 2's deposit hint used to look up `accounts.find(a => a.id ===
  // portfolio.id)` — comparing an inner account.uuid to the outer metadata
  // UUID, which never matches. Use the same securities-accounts hook Step 3
  // uses for its N=1/N>1 logic so the hint stays consistent with what the
  // import actually targets, then follow referenceAccountId to the deposit.
  const secAccounts = useSecuritiesAccounts(portfolio.id);

  const headers = state.parseResult?.headers ?? [];

  const depositName = useMemo(() => {
    if (!accounts || !secAccounts.data) return null;
    // Prefer the user's explicit pick; fall back to N=1 auto-pick if the pick
    // is stale (not found in current list) or absent.
    const pick = state.targetSecuritiesAccountId
      ? secAccounts.data.find((a) => a.id === state.targetSecuritiesAccountId)
      : undefined;
    const selectedSec = pick ?? (secAccounts.data.length === 1 ? secAccounts.data[0] : null);
    if (!selectedSec?.referenceAccountId) return null;
    return accounts.find((a) => a.id === selectedSec.referenceAccountId)?.name ?? null;
  }, [accounts, secAccounts.data, state.targetSecuritiesAccountId]);

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
