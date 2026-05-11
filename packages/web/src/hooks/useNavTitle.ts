import { useTranslation } from 'react-i18next';
import { useDocumentTitle } from './useDocumentTitle';

/**
 * Sets the document title from a `navigation:items.<itemKey>` translation key.
 * Re-runs on language change because `t()` returns a fresh string and
 * `useDocumentTitle`'s effect depends on the resolved page name.
 */
export function useNavTitle(itemKey: string): void {
  const { t } = useTranslation('navigation');
  useDocumentTitle(t(`items.${itemKey}`));
}
