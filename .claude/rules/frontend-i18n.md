globs: packages/web/src/i18n/**,packages/web/src/pages/**,packages/web/src/components/**
---
# Frontend i18n Rules

- **Never hardcode user-visible strings.** Every text (labels, titles, placeholders, tooltips, aria-labels, toasts, empty states) must use `t('key', { ns: 'namespace' })` from `react-i18next`.
- Config in `src/i18n/index.ts`, JSON in `src/i18n/locales/{lang}/{namespace}.json`.
- Namespaces: `common`, `navigation`, `dashboard`, `securities`, `investments`, `transactions`, `accounts`, `performance`, `reports`, `settings`, `errors`, `csv-import`, `watchlists`, `welcome`, `switcher`, `portfolioSettings`, `userSettings`, `portfolio-setup`. Source of truth is the `ns` array in `src/i18n/index.ts` — keep this list in sync when a namespace is added.
- When adding a new component/page or a new string:
  1. Add the key to the `en/` JSON of the correct namespace
  2. Add the same key to the other 7 language files (`it`, `de`, `fr`, `es`, `nl`, `pl`, `pt`)
  3. Use `const { t } = useTranslation('namespace')` in the component
  4. For financial terms: use standard financial terminology in the target language. Refer to established open-source portfolio tools for consistent terminology across languages.
- Fallback: if a key is missing in a language, i18next displays the `en` version.
- Transaction types: use `txTypeKey(type)` (from `src/lib/utils.ts`) to convert `INTEREST_CHARGE` → `interestCharge`, then `t('types.' + txTypeKey(type), { ns: 'transactions' })`.
- Number/date formatting: use the centralized formatters in `src/lib/formatters.ts` (they use `i18n.language`, not `navigator.language`). Never use `new Intl.NumberFormat(navigator.language, ...)` inline.
- Pluralization: use `t('key', { count: n })` with `_one`/`_other` suffixes (for Polish also `_few`/`_many`).
