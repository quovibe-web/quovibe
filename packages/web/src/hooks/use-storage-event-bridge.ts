import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/hooks/use-theme';
import { usePrivacy } from '@/context/privacy-context';
import {
  PRIVACY_STORAGE_KEY,
  THEME_STORAGE_KEY,
  LANGUAGE_STORAGE_KEY,
  VALID_THEMES,
  type ThemeMode,
} from '@/lib/preference-storage-keys';

// When the user toggles a preference in tab A, the browser fires a `storage`
// event in OTHER mounted tabs (B, C, …). The active tab's setter has already
// run locally so no same-tab handling is needed — only cross-tab propagation.
// Re-exports keep the bridge's existing test surface stable while the values
// come from the single canonical location in `lib/preference-storage-keys`.
export const PRIVACY_KEY = PRIVACY_STORAGE_KEY;
export const THEME_KEY = THEME_STORAGE_KEY;
export const LANGUAGE_KEY = LANGUAGE_STORAGE_KEY;

export const DEFAULT_THEME: ThemeMode = 'system';
export const DEFAULT_LANGUAGE = 'en';

export interface StorageEventHandlers {
  setPrivacy: (value: boolean) => void;
  syncTheme: (mode: ThemeMode) => void;
  changeLanguage: (lng: string) => void;
}

/**
 * Pure event router — given a storage event's `key` and `newValue`, dispatch
 * to the appropriate handler. Keeps the I/O-bound `useEffect` in the hook
 * trivially correct and lets us unit-test the routing matrix in node-env
 * without `JSDOM` or `dispatchEvent` plumbing.
 *
 * Contract:
 * - `newValue === null` (key removed in originating tab) → fall back to the
 *   per-key default. The user explicitly cleared the value, so siblings
 *   should mirror, not retain a stale override.
 * - Invalid values (e.g. theme="neon") are silently ignored: no-op is safer
 *   than guessing.
 * - Unknown keys are ignored — protects against accidental coupling to other
 *   localStorage writers.
 */
export function routeStorageEvent(
  key: string | null,
  newValue: string | null,
  handlers: StorageEventHandlers,
): void {
  if (key === null) return;

  if (key === PRIVACY_KEY) {
    if (newValue === null) {
      handlers.setPrivacy(false);
      return;
    }
    handlers.setPrivacy(newValue === 'true');
    return;
  }

  if (key === THEME_KEY) {
    if (newValue === null) {
      handlers.syncTheme(DEFAULT_THEME);
      return;
    }
    if (VALID_THEMES.includes(newValue as ThemeMode)) {
      handlers.syncTheme(newValue as ThemeMode);
    }
    return;
  }

  if (key === LANGUAGE_KEY) {
    if (newValue === null) {
      handlers.changeLanguage(DEFAULT_LANGUAGE);
      return;
    }
    if (newValue.length > 0) {
      handlers.changeLanguage(newValue);
    }
    return;
  }
}

/**
 * Single sanctioned hook that listens for cross-tab `storage` events on the
 * three preference keys and routes them through the live setters from
 * `PrivacyContext`, `ThemeProvider`, and i18next. Mount once at the top of
 * the provider tree (see `main.tsx`); resist per-Provider listeners — one
 * sanctioned location, three keys, no per-Provider Buffer round-trips.
 *
 * Same-tab toggles are handled by the local setters; the `storage` event
 * fires only in OTHER tabs, so we never double-fire on the originating tab.
 */
export function useStorageEventBridge(): void {
  const { setPrivacy } = usePrivacy();
  const { syncThemeFromServer } = useTheme();
  const { i18n } = useTranslation();

  useEffect(() => {
    const handlers: StorageEventHandlers = {
      setPrivacy,
      syncTheme: syncThemeFromServer,
      changeLanguage: (lng) => {
        if (lng !== i18n.language) {
          void i18n.changeLanguage(lng);
        }
      },
    };

    function onStorage(event: StorageEvent): void {
      routeStorageEvent(event.key, event.newValue, handlers);
    }

    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [setPrivacy, syncThemeFromServer, i18n]);
}
