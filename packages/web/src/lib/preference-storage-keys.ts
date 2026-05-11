/**
 * Single sanctioned location for the localStorage keys + theme allowlist
 * used by the user-level preference layer (privacy / theme / language).
 *
 * Owners and writers (must match exactly):
 * - PRIVACY_STORAGE_KEY → `PrivacyProvider` in `context/privacy-context.tsx`
 * - THEME_STORAGE_KEY   → `ThemeProvider`   in `hooks/use-theme.ts`
 * - LANGUAGE_STORAGE_KEY → i18next's `lookupLocalStorage` in `i18n/index.ts`
 *
 * Cross-tab readers (must import from here):
 * - `useStorageEventBridge` (cross-tab `storage` event router)
 * - `SidecarSync` (boot-time hydration from `/api/settings`)
 *
 * Drift between writer and reader is the bug class this file closes.
 */

export const PRIVACY_STORAGE_KEY = 'quovibe_privacy_mode';
export const THEME_STORAGE_KEY = 'quovibe-theme';
export const LANGUAGE_STORAGE_KEY = 'quovibe-language';

export const VALID_THEMES = ['light', 'dark', 'system'] as const;
export type ThemeMode = (typeof VALID_THEMES)[number];
