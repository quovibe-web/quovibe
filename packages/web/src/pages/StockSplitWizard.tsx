import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useNavTitle } from '@/hooks/useNavTitle';
import { PageHeader } from '@/components/shared/PageHeader';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useGuardedSubmit } from '@/hooks/use-guarded-submit';
import { usePortfolio } from '@/context/PortfolioContext';
import { resolveErrorMessage } from '@/api/query-client';
import {
  useApplyStockSplit,
  useStockSplitPreview,
  type SplitPreviewResponse,
} from '@/api/use-stock-split';
import { SplitSelectStep } from '@/components/domain/stock-split/SplitSelectStep';
import { SplitTransactionsStep } from '@/components/domain/stock-split/SplitTransactionsStep';
import { SplitQuotesStep } from '@/components/domain/stock-split/SplitQuotesStep';
import {
  toSplitRequest,
  type SplitFormValues,
} from '@/components/domain/stock-split/stock-split-form.schema';

type WizardStep = 'select' | 'transactions' | 'quotes';

const STEPS: WizardStep[] = ['select', 'transactions', 'quotes'];

export default function StockSplitWizard() {
  const { t } = useTranslation('securities');
  useNavTitle('investments');
  const navigate = useNavigate();
  const portfolio = usePortfolio();
  const [searchParams] = useSearchParams();

  const preselectedSecurityId = searchParams.get('securityId') ?? '';

  // The events-section undo action links here with the inverted ratio already
  // in the query string, so an undo still walks the normal preview + confirm.
  const [initialValues] = useState<SplitFormValues>(() => ({
    securityId: preselectedSecurityId,
    exDate: searchParams.get('exDate') ?? new Date().toISOString().slice(0, 10),
    oldShares: searchParams.get('oldShares') ?? '',
    newShares: searchParams.get('newShares') ?? '',
  }));

  const [step, setStep] = useState<WizardStep>('select');
  const [values, setValues] = useState<SplitFormValues | null>(null);
  const [preview, setPreview] = useState<SplitPreviewResponse | null>(null);
  const [changeTransactions, setChangeTransactions] = useState(true);
  const [changeHistoricalQuotes, setChangeHistoricalQuotes] = useState(true);

  const previewMutation = useStockSplitPreview();
  const applyMutation = useApplyStockSplit();

  const stepIndex = STEPS.indexOf(step); // native-ok

  const { run: handleSelectNext, inFlight: previewInFlight } = useGuardedSubmit(
    async (next: SplitFormValues) => {
      try {
        const result = await previewMutation.mutateAsync(
          toSplitRequest(next, { changeTransactions: true, changeHistoricalQuotes: true }),
        );
        setValues(next);
        setPreview(result);
        setStep('transactions');
      } catch {
        // Rendered inline under the ratio fields via previewMutation.error.
      }
    },
  );

  const { run: handleApply, inFlight: applyInFlight } = useGuardedSubmit(async () => {
    if (!values) return;
    try {
      const result = await applyMutation.mutateAsync(
        toSplitRequest(values, { changeTransactions, changeHistoricalQuotes }),
      );
      toast.success(
        t('split.applied', {
          transactions: result.applied.transactions,
          quotes: result.applied.quotes,
        }),
      );
      navigate(`/p/${portfolio.id}/investments/${values.securityId}`);
    } catch {
      // The global MutationCache toast surfaces the failure.
    }
  });

  return (
    <div className="mx-auto max-w-5xl p-6">
      <div className="mb-6">
        <PageHeader title={t('split.title')} subtitle={t('split.subtitle')} />
      </div>

      <div className="flex gap-2 mb-8">
        {STEPS.map((s, i) => {
          const isActive = i === stepIndex;
          const isDone = i < stepIndex;
          return (
            <div
              key={s}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium ${
                isActive
                  ? 'bg-primary text-primary-foreground'
                  : isDone
                    ? 'bg-[var(--qv-surface-elevated)] text-[var(--color-primary)]'
                    : 'bg-[var(--qv-surface-elevated)] text-[var(--qv-text-secondary)]'
              }`}
            >
              <span
                className={`w-5 h-5 rounded-full flex items-center justify-center qv-numeric text-xs ${
                  isActive
                    ? 'bg-[var(--color-primary-fg)]/20'
                    : isDone
                      ? 'bg-[var(--color-primary)]/15'
                      : 'bg-[var(--qv-surface-3)]'
                }`}
              >
                {i + 1}
              </span>
              {t(`split.steps.${s}`)}
            </div>
          );
        })}
      </div>

      {step === 'select' && (
        <SplitSelectStep
          // Stepping back remounts this component, so seed it from what the
          // user last submitted rather than the pristine URL-derived values —
          // otherwise Back silently wipes the ratio they just typed.
          defaultValues={values ?? initialValues}
          lockSecurity={preselectedSecurityId !== ''}
          isPreviewing={previewInFlight || previewMutation.isPending}
          previewError={
            previewMutation.error ? resolveErrorMessage(previewMutation.error) : null
          }
          onNext={(next) => void handleSelectNext(next)}
        />
      )}

      {/* Preview warnings live at wizard level so they stay visible across
          both preview steps rather than scrolling away with one table. */}
      {step !== 'select' && preview && preview.warnings.length > 0 && (
        <Alert className="mb-4">
          <AlertDescription>
            <ul className="list-disc pl-4 space-y-1">
              {preview.warnings.map((w) => (
                <li key={w}>{t(`split.warnings.${w}`)}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {step === 'transactions' && preview && (
        <SplitTransactionsStep
          transactions={preview.transactions}
          changeTransactions={changeTransactions}
          onToggle={setChangeTransactions}
          onBack={() => setStep('select')}
          onNext={() => setStep('quotes')}
        />
      )}

      {step === 'quotes' && preview && (
        <SplitQuotesStep
          quotes={preview.quotes}
          transactionCount={changeTransactions ? preview.counts.transactions : 0}
          changeHistoricalQuotes={changeHistoricalQuotes}
          onToggle={setChangeHistoricalQuotes}
          onBack={() => setStep('transactions')}
          onApply={() => void handleApply()}
          isApplying={applyInFlight || applyMutation.isPending}
        />
      )}
    </div>
  );
}
