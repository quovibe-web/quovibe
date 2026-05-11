import i18n from '@/i18n';

/**
 * Translate a seeded taxonomy template category name (e.g. "Cash" → "Liquidità").
 * User-renamed / freeform names fall through to the literal via `defaultValue`,
 * since the canonical English string is itself the i18n key.
 *
 * Reactivity: this is NOT a hook — callers must already subscribe to language
 * changes via `useTranslation(...)` (or otherwise re-render on `languageChanged`)
 * AND include `i18n.language` in any `useMemo` deps that wrap calls to this
 * helper. Without the dep, memoized translations freeze at mount-time language.
 */
export function translateTaxonomyName(name: string | null | undefined): string {
  if (!name) return '';
  return i18n.t(name, { ns: 'taxonomy-templates', defaultValue: name });
}
