import { useReducer } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useNavTitle } from '@/hooks/useNavTitle';
import { PageHeader } from '@/components/shared/PageHeader';
import { PriceSecurityPickStep } from '@/components/domain/csv-import/price-wizard/PriceSecurityPickStep';
import { PriceCsvUploadStep } from '@/components/domain/csv-import/price-wizard/PriceCsvUploadStep';
import { PriceColumnMapStep } from '@/components/domain/csv-import/price-wizard/PriceColumnMapStep';
import { PriceConfirmStep } from '@/components/domain/csv-import/price-wizard/PriceConfirmStep';
import {
  buildInitialPriceWizardState,
  priceWizardReducer,
  type PriceWizardStep,
} from './price-import-wizard.utils';

const STEPS: PriceWizardStep[] = ['security', 'upload', 'map', 'confirm'];

export default function PriceImportWizard() {
  const { t } = useTranslation('csv-import');
  useNavTitle('import');
  const [searchParams] = useSearchParams();

  const preselectId = searchParams.get('securityId');
  const preselectName = searchParams.get('securityName');
  const preselect =
    preselectId && preselectName
      ? { securityId: preselectId, securityName: preselectName }
      : undefined;

  const [state, dispatch] = useReducer(
    priceWizardReducer,
    undefined,
    () => buildInitialPriceWizardState(preselect),
  );
  const stepIndex = STEPS.indexOf(state.step); // native-ok

  return (
    <div className="mx-auto max-w-5xl p-6">
      <div className="mb-6">
        <PageHeader
          title={t('prices.wizard.title')}
          subtitle={t('prices.wizard.subtitle')}
        />
      </div>

      <div className="flex gap-2 mb-8">
        {STEPS.map((step, i) => {
          const isActive = i === stepIndex;
          const isDone = i < stepIndex;
          return (
            <div
              key={step}
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
              {t(`prices.wizard.steps.${step}`)}
            </div>
          );
        })}
      </div>

      {state.step === 'security' && (
        <PriceSecurityPickStep
          state={state}
          onPick={(securityId, securityName) =>
            dispatch({ type: 'pickSecurity', securityId, securityName })
          }
          onNext={() => dispatch({ type: 'next' })}
        />
      )}
      {state.step === 'upload' && (
        <PriceCsvUploadStep
          parseResult={state.parseResult}
          onParsed={(parseResult, columnMapping) =>
            dispatch({ type: 'setParseResult', parseResult, columnMapping })
          }
          onBack={() => dispatch({ type: 'back' })}
          onNext={() => dispatch({ type: 'next' })}
        />
      )}
      {state.step === 'map' && (
        <PriceColumnMapStep
          state={state}
          onColumnMappingChange={(columnMapping) =>
            dispatch({ type: 'setColumnMapping', columnMapping })
          }
          onFormatChange={(patch) => dispatch({ type: 'setFormat', ...patch })}
          onBack={() => dispatch({ type: 'back' })}
          onNext={() => dispatch({ type: 'next' })}
        />
      )}
      {state.step === 'confirm' && (
        <PriceConfirmStep state={state} onBack={() => dispatch({ type: 'back' })} />
      )}
    </div>
  );
}
