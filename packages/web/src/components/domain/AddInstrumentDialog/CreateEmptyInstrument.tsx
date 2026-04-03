import { useTranslation } from 'react-i18next';

interface CreateEmptyInstrumentProps {
  query?: string;
  onCreateEmpty: () => void;
}

/**
 * Inline link/button that triggers SecurityEditor in create mode.
 * Per design spec, manual creation redirects to SecurityEditor (no inline form).
 */
export function CreateEmptyInstrument({ query, onCreateEmpty }: CreateEmptyInstrumentProps) {
  const { t } = useTranslation('securities');

  return (
    <button
      type="button"
      onClick={onCreateEmpty}
      className="text-sm text-primary hover:underline focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none rounded-sm"
    >
      {query
        ? t('addInstrument.noResultsCreate', { query })
        : t('addInstrument.emptyCreateManual')}
    </button>
  );
}
