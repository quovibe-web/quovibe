import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Search } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useSecurities } from '@/api/use-securities';
import { filterSecurities, type PickerSecurity } from './security-picker.utils';
import type { PriceWizardState } from '@/pages/price-import-wizard.utils';

interface Props {
  state: PriceWizardState;
  onPick: (securityId: string, securityName: string) => void;
  onNext: () => void;
}

export function PriceSecurityPickStep({ state, onPick, onNext }: Props) {
  const { t } = useTranslation('csv-import');
  const { portfolioId } = useParams<{ portfolioId: string }>();
  const { data: securities = [], isLoading } = useSecurities(true);
  const [query, setQuery] = useState('');

  const pickerSecurities: PickerSecurity[] = useMemo(
    () =>
      securities.map((s) => ({
        id: s.id,
        name: s.name,
        ticker: s.ticker,
        isin: s.isin,
        isRetired: s.isRetired,
      })),
    [securities],
  );

  const filtered = useMemo(
    () => filterSecurities(pickerSecurities, query),
    [pickerSecurities, query],
  );

  const isEmpty = !isLoading && pickerSecurities.length === 0;
  const canProceed = state.securityId !== null;

  return (
    <div className="space-y-6">
      <Card className="rounded-md">
        <CardContent className="pt-6 space-y-4">
          <div>
            <h2 className="text-lg font-medium text-foreground">
              {t('prices.wizard.securityPick.title')}
            </h2>
            <p className="mt-1 text-sm text-[var(--qv-text-secondary)]">
              {t('prices.wizard.securityPick.description')}
            </p>
          </div>

          {isEmpty ? (
            <Alert role="status">
              <AlertDescription>
                {t('prices.wizard.securityPick.emptyState')}{' '}
                <Link
                  to={`/p/${portfolioId}/investments`}
                  className="underline text-[var(--color-primary)]"
                >
                  {t('prices.wizard.securityPick.emptyStateCta')}
                </Link>
              </AlertDescription>
            </Alert>
          ) : (
            <>
              <div className="relative">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t('prices.wizard.securityPick.search')}
                  className="pl-9"
                />
              </div>

              <div className="max-h-[420px] overflow-y-auto rounded-md border border-[var(--qv-border)]">
                {filtered.length === 0 ? (
                  <p className="p-4 text-sm text-[var(--qv-text-secondary)]">
                    {t('prices.wizard.securityPick.noMatches')}
                  </p>
                ) : (
                  <ul className="divide-y divide-[var(--qv-border-subtle)]">
                    {filtered.map((s) => {
                      const selected = state.securityId === s.id;
                      return (
                        <li key={s.id}>
                          <button
                            type="button"
                            onClick={() => onPick(s.id, s.name)}
                            className={`flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-[var(--qv-surface-elevated)] ${
                              selected ? 'bg-[var(--color-primary)]/10' : ''
                            }`}
                          >
                            <div className="min-w-0 flex-1">
                              <p className="font-medium text-foreground truncate">{s.name}</p>
                              <p className="text-xs text-[var(--qv-text-faint)] font-mono">
                                {[s.ticker, s.isin].filter(Boolean).join(' · ') || '—'}
                              </p>
                            </div>
                            {s.isRetired && (
                              <Badge variant="outline" className="text-[10px]">
                                {t('prices.wizard.securityPick.retiredBadge')}
                              </Badge>
                            )}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={onNext} disabled={!canProceed}>
          {t('nav.next')}
        </Button>
      </div>
    </div>
  );
}
