import { useTranslation } from 'react-i18next';

const availableLanguages = [
  { code: 'en', label: 'English', flag: '🇺🇸' },
  { code: 'it', label: 'Italiano', flag: '🇮🇹' },
  { code: 'de', label: 'Deutsch', flag: '🇩🇪' },
  { code: 'fr', label: 'Français', flag: '🇫🇷' },
  { code: 'es', label: 'Español', flag: '🇪🇸' },
  { code: 'nl', label: 'Nederlands', flag: '🇳🇱' },
  { code: 'pl', label: 'Polski', flag: '🇵🇱' },
  { code: 'pt', label: 'Português', flag: '🇵🇹' },
] as const;

export type LanguageCode = (typeof availableLanguages)[number]['code'];

export function useLanguage() {
  const { i18n } = useTranslation();
  return {
    language: i18n.language as LanguageCode,
    setLanguage: (code: LanguageCode) => i18n.changeLanguage(code),
    availableLanguages,
  };
}
