// packages/web/src/pages/CsvImportPage.tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
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
  useDocumentTitle('CSV Import');
  const { t } = useTranslation('csv-import');
  const [step, setStep] = useState(0);
  const [state, setState] = useState<WizardState>(initialState);

  function updateState(partial: Partial<WizardState>) {
    setState((prev) => ({ ...prev, ...partial }));
  }

  const stepNames = STEPS.map((s) => t(`steps.${s}`));

  return (
    <div className="mx-auto max-w-5xl p-6">
      <h1 className="text-2xl font-semibold mb-2">{t('title')}</h1>
      <p className="text-muted-foreground mb-6">{t('subtitle')}</p>

      {/* Step indicator */}
      <div className="flex gap-2 mb-8">
        {stepNames.map((name, i) => (
          <div
            key={name}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium ${
              i === step
                ? 'bg-primary text-primary-foreground'
                : i < step
                  ? 'bg-primary/10 text-primary'
                  : 'bg-muted text-muted-foreground'
            }`}
          >
            <span className="w-5 h-5 rounded-full bg-current/20 flex items-center justify-center text-xs">
              {i + 1}
            </span>
            {name}
          </div>
        ))}
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
