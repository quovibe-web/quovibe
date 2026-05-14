// packages/web/src/pages/CsvImportPage.tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavTitle } from '@/hooks/useNavTitle';
import { PageHeader } from '@/components/shared/PageHeader';
import { CsvUploadStep } from '@/components/domain/csv-import/CsvUploadStep';
import { CsvColumnMapStep } from '@/components/domain/csv-import/CsvColumnMapStep';
import { CsvSecurityMatchStep } from '@/components/domain/csv-import/CsvSecurityMatchStep';
import { CsvPreviewStep } from '@/components/domain/csv-import/CsvPreviewStep';
import type { CsvParseResult, TradePreviewResult, CsvDelimiter, CsvDateFormat } from '@quovibe/shared';

const STEPS = ['upload', 'columns', 'securities', 'preview'] as const;

export interface WizardState {
  // Step 1 output
  parseResult: CsvParseResult | null;
  delimiter: CsvDelimiter;
  encoding: string;
  dateFormat: CsvDateFormat;
  decimalSeparator: '.' | ',';
  thousandSeparator: '' | '.' | ',' | ' ';

  // Step 2 output
  columnMapping: Record<string, number>;

  // Step 3 output
  previewResult: TradePreviewResult | null;
  securityMapping: Record<string, string>;
  newSecurities: Array<{ name: string; isin?: string; ticker?: string; currency: string }>;

  // BUG-54/55 Phase 6 — picked inner securities-account UUID. Resolved by
  // CsvSecurityMatchStep on mount (auto-pick when N=1, picker when N>1).
  // Phase 5 redirect handles N=0 before the user can reach this wizard.
  targetSecuritiesAccountId: string | null;
}

const initialState: WizardState = {
  parseResult: null,
  delimiter: ',',
  encoding: 'utf-8',
  dateFormat: 'yyyy-MM-dd',
  decimalSeparator: '.',
  thousandSeparator: '',
  columnMapping: {},
  previewResult: null,
  securityMapping: {},
  newSecurities: [],
  targetSecuritiesAccountId: null,
};

export default function CsvImportPage() {
  const { t } = useTranslation('csv-import');
  useNavTitle('csvImport');
  const [step, setStep] = useState(0);
  const [state, setState] = useState<WizardState>(initialState);

  function updateState(partial: Partial<WizardState>) {
    setState((prev) => ({ ...prev, ...partial }));
  }

  const stepNames = STEPS.map((s) => t(`steps.${s}`));

  return (
    <div className="mx-auto max-w-5xl p-6">
      <div className="mb-6">
        <PageHeader title={t('title')} subtitle={t('subtitle')} />
      </div>

      {/* Step indicator */}
      <div className="flex gap-2 mb-8">
        {stepNames.map((name, i) => {
          const isActive = i === step;
          const isDone = i < step;
          return (
            <div
              key={name}
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
              {name}
            </div>
          );
        })}
      </div>

      {/* Step content */}
      {step === 0 && (
        <CsvUploadStep
          state={state}
          onUpdate={updateState}
          onNext={() => setStep(1)}
        />
      )}
      {step === 1 && (
        <CsvColumnMapStep
          state={state}
          onUpdate={updateState}
          onBack={() => setStep(0)}
          onNext={() => setStep(2)}
        />
      )}
      {step === 2 && (
        <CsvSecurityMatchStep
          state={state}
          onUpdate={updateState}
          onBack={() => setStep(1)}
          onNext={() => setStep(3)}
        />
      )}
      {step === 3 && (
        <CsvPreviewStep
          state={state}
          onBack={() => setStep(2)}
        />
      )}
    </div>
  );
}
