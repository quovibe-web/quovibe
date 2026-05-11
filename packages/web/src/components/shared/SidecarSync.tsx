import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '@/api/fetch';
import { useTheme } from '@/hooks/use-theme';
import { usePrivacy } from '@/context/privacy-context';
import { useStorageEventBridge } from '@/hooks/use-storage-event-bridge';
import {
  LANGUAGE_STORAGE_KEY,
  VALID_THEMES,
  type ThemeMode,
} from '@/lib/preference-storage-keys';

// Hydrates theme / language / privacy from the user-level sidecar on app boot.
// Runs above the router so it must NOT depend on any portfolio-scoped hook:
// `useScopedApi` (and therefore `usePortfolio`) throws when the URL has no
// `:portfolioId` — calling those here would blank the entire app on first paint.
// User preferences live under `GET /api/settings` (ADR-015 §3.11, Phase 5b).

interface UserSettingsResponse {
  preferences: {
    language?: string;
    theme?: ThemeMode;
    privacyMode?: boolean;
  };
}

export function SidecarSync() {
  const { syncThemeFromServer, theme } = useTheme();
  const { setPrivacy, isPrivate } = usePrivacy();
  const { i18n } = useTranslation();
  const synced = useRef(false);

  // Cross-tab preference sync. Mounted here because SidecarSync already sits
  // inside the three required providers (Theme, Privacy, i18n) and runs once
  // at the root of the app.
  useStorageEventBridge();

  useEffect(() => {
    if (synced.current) return;
    synced.current = true;

    apiFetch<UserSettingsResponse>('/api/settings')
      .then((s) => {
        const prefs = s.preferences ?? {};

        // Theme
        const serverTheme = prefs.theme;
        if (serverTheme && VALID_THEMES.includes(serverTheme) && serverTheme !== theme) {
          syncThemeFromServer(serverTheme);
        }

        // Language
        const serverLang = prefs.language;
        if (serverLang && serverLang !== i18n.language) {
          void i18n.changeLanguage(serverLang);
          localStorage.setItem(LANGUAGE_STORAGE_KEY, serverLang);
        }

        // Privacy
        const serverPrivacy = prefs.privacyMode;
        if (typeof serverPrivacy === 'boolean' && serverPrivacy !== isPrivate) {
          setPrivacy(serverPrivacy);
        }
      })
      .catch(() => {
        // Boot-time fetch failure is non-fatal — client defaults win.
      });
  }, []);

  return null;
}
