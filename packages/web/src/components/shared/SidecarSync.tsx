import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { usePortfolio } from '@/api/use-portfolio';
import { useTheme, type ThemeMode } from '@/hooks/use-theme';
import { usePrivacy } from '@/context/privacy-context';

const LANG_STORAGE_KEY = 'quovibe-language';
const VALID_THEMES: readonly ThemeMode[] = ['light', 'dark', 'system'];

export function SidecarSync() {
  const { data } = usePortfolio();
  const { syncThemeFromServer, theme } = useTheme();
  const { setPrivacy, isPrivate } = usePrivacy();
  const { i18n } = useTranslation();
  const synced = useRef(false);

  useEffect(() => {
    if (synced.current || !data) return;
    synced.current = true;

    const { config } = data;

    // Sync theme
    const serverTheme = config['theme'] as ThemeMode | undefined;
    if (serverTheme && VALID_THEMES.includes(serverTheme) && serverTheme !== theme) {
      syncThemeFromServer(serverTheme);
    }

    // Sync language
    const serverLang = config['language'];
    if (serverLang && serverLang !== i18n.language) {
      void i18n.changeLanguage(serverLang);
      localStorage.setItem(LANG_STORAGE_KEY, serverLang);
    }

    // Sync privacy mode
    const serverPrivacy = config['privacyMode'];
    if (serverPrivacy !== undefined && serverPrivacy !== null) {
      const serverPrivacyBool = serverPrivacy === 'true';
      if (serverPrivacyBool !== isPrivate) {
        setPrivacy(serverPrivacyBool);
      }
    }
  }, [data]);

  return null;
}
