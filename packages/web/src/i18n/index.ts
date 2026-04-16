import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

// EN
import enCommon from './locales/en/common.json';
import enNavigation from './locales/en/navigation.json';
import enSecurities from './locales/en/securities.json';
import enTransactions from './locales/en/transactions.json';
import enAccounts from './locales/en/accounts.json';
import enPerformance from './locales/en/performance.json';
import enReports from './locales/en/reports.json';
import enSettings from './locales/en/settings.json';
import enErrors from './locales/en/errors.json';
import enDashboard from './locales/en/dashboard.json';
import enInvestments from './locales/en/investments.json';
import enCsvImport from './locales/en/csv-import.json';
import enWatchlists from './locales/en/watchlists.json';
import enWelcome from './locales/en/welcome.json';
import enSwitcher from './locales/en/switcher.json';
import enPortfolioSettings from './locales/en/portfolioSettings.json';
import enUserSettings from './locales/en/userSettings.json';
// IT
import itCommon from './locales/it/common.json';
import itNavigation from './locales/it/navigation.json';
import itSecurities from './locales/it/securities.json';
import itTransactions from './locales/it/transactions.json';
import itAccounts from './locales/it/accounts.json';
import itPerformance from './locales/it/performance.json';
import itReports from './locales/it/reports.json';
import itSettings from './locales/it/settings.json';
import itErrors from './locales/it/errors.json';
import itDashboard from './locales/it/dashboard.json';
import itInvestments from './locales/it/investments.json';
import itCsvImport from './locales/it/csv-import.json';
import itWatchlists from './locales/it/watchlists.json';
// DE
import deCommon from './locales/de/common.json';
import deNavigation from './locales/de/navigation.json';
import deSecurities from './locales/de/securities.json';
import deTransactions from './locales/de/transactions.json';
import deAccounts from './locales/de/accounts.json';
import dePerformance from './locales/de/performance.json';
import deReports from './locales/de/reports.json';
import deSettings from './locales/de/settings.json';
import deErrors from './locales/de/errors.json';
import deDashboard from './locales/de/dashboard.json';
import deInvestments from './locales/de/investments.json';
import deCsvImport from './locales/de/csv-import.json';
import deWatchlists from './locales/de/watchlists.json';
// FR
import frCommon from './locales/fr/common.json';
import frNavigation from './locales/fr/navigation.json';
import frSecurities from './locales/fr/securities.json';
import frTransactions from './locales/fr/transactions.json';
import frAccounts from './locales/fr/accounts.json';
import frPerformance from './locales/fr/performance.json';
import frReports from './locales/fr/reports.json';
import frSettings from './locales/fr/settings.json';
import frErrors from './locales/fr/errors.json';
import frDashboard from './locales/fr/dashboard.json';
import frInvestments from './locales/fr/investments.json';
import frCsvImport from './locales/fr/csv-import.json';
import frWatchlists from './locales/fr/watchlists.json';
// ES
import esCommon from './locales/es/common.json';
import esNavigation from './locales/es/navigation.json';
import esSecurities from './locales/es/securities.json';
import esTransactions from './locales/es/transactions.json';
import esAccounts from './locales/es/accounts.json';
import esPerformance from './locales/es/performance.json';
import esReports from './locales/es/reports.json';
import esSettings from './locales/es/settings.json';
import esErrors from './locales/es/errors.json';
import esDashboard from './locales/es/dashboard.json';
import esInvestments from './locales/es/investments.json';
import esCsvImport from './locales/es/csv-import.json';
import esWatchlists from './locales/es/watchlists.json';
// NL
import nlCommon from './locales/nl/common.json';
import nlNavigation from './locales/nl/navigation.json';
import nlSecurities from './locales/nl/securities.json';
import nlTransactions from './locales/nl/transactions.json';
import nlAccounts from './locales/nl/accounts.json';
import nlPerformance from './locales/nl/performance.json';
import nlReports from './locales/nl/reports.json';
import nlSettings from './locales/nl/settings.json';
import nlErrors from './locales/nl/errors.json';
import nlDashboard from './locales/nl/dashboard.json';
import nlInvestments from './locales/nl/investments.json';
import nlCsvImport from './locales/nl/csv-import.json';
import nlWatchlists from './locales/nl/watchlists.json';
// PL
import plCommon from './locales/pl/common.json';
import plNavigation from './locales/pl/navigation.json';
import plSecurities from './locales/pl/securities.json';
import plTransactions from './locales/pl/transactions.json';
import plAccounts from './locales/pl/accounts.json';
import plPerformance from './locales/pl/performance.json';
import plReports from './locales/pl/reports.json';
import plSettings from './locales/pl/settings.json';
import plErrors from './locales/pl/errors.json';
import plDashboard from './locales/pl/dashboard.json';
import plInvestments from './locales/pl/investments.json';
import plCsvImport from './locales/pl/csv-import.json';
import plWatchlists from './locales/pl/watchlists.json';
// PT
import ptCommon from './locales/pt/common.json';
import ptNavigation from './locales/pt/navigation.json';
import ptSecurities from './locales/pt/securities.json';
import ptTransactions from './locales/pt/transactions.json';
import ptAccounts from './locales/pt/accounts.json';
import ptPerformance from './locales/pt/performance.json';
import ptReports from './locales/pt/reports.json';
import ptSettings from './locales/pt/settings.json';
import ptErrors from './locales/pt/errors.json';
import ptDashboard from './locales/pt/dashboard.json';
import ptInvestments from './locales/pt/investments.json';
import ptCsvImport from './locales/pt/csv-import.json';
import ptWatchlists from './locales/pt/watchlists.json';

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { common: enCommon, navigation: enNavigation, securities: enSecurities, transactions: enTransactions, accounts: enAccounts, performance: enPerformance, reports: enReports, settings: enSettings, errors: enErrors, dashboard: enDashboard, investments: enInvestments, 'csv-import': enCsvImport, watchlists: enWatchlists, welcome: enWelcome, switcher: enSwitcher, portfolioSettings: enPortfolioSettings, userSettings: enUserSettings },
      it: { common: itCommon, navigation: itNavigation, securities: itSecurities, transactions: itTransactions, accounts: itAccounts, performance: itPerformance, reports: itReports, settings: itSettings, errors: itErrors, dashboard: itDashboard, investments: itInvestments, 'csv-import': itCsvImport, watchlists: itWatchlists },
      de: { common: deCommon, navigation: deNavigation, securities: deSecurities, transactions: deTransactions, accounts: deAccounts, performance: dePerformance, reports: deReports, settings: deSettings, errors: deErrors, dashboard: deDashboard, investments: deInvestments, 'csv-import': deCsvImport, watchlists: deWatchlists },
      fr: { common: frCommon, navigation: frNavigation, securities: frSecurities, transactions: frTransactions, accounts: frAccounts, performance: frPerformance, reports: frReports, settings: frSettings, errors: frErrors, dashboard: frDashboard, investments: frInvestments, 'csv-import': frCsvImport, watchlists: frWatchlists },
      es: { common: esCommon, navigation: esNavigation, securities: esSecurities, transactions: esTransactions, accounts: esAccounts, performance: esPerformance, reports: esReports, settings: esSettings, errors: esErrors, dashboard: esDashboard, investments: esInvestments, 'csv-import': esCsvImport, watchlists: esWatchlists },
      nl: { common: nlCommon, navigation: nlNavigation, securities: nlSecurities, transactions: nlTransactions, accounts: nlAccounts, performance: nlPerformance, reports: nlReports, settings: nlSettings, errors: nlErrors, dashboard: nlDashboard, investments: nlInvestments, 'csv-import': nlCsvImport, watchlists: nlWatchlists },
      pl: { common: plCommon, navigation: plNavigation, securities: plSecurities, transactions: plTransactions, accounts: plAccounts, performance: plPerformance, reports: plReports, settings: plSettings, errors: plErrors, dashboard: plDashboard, investments: plInvestments, 'csv-import': plCsvImport, watchlists: plWatchlists },
      pt: { common: ptCommon, navigation: ptNavigation, securities: ptSecurities, transactions: ptTransactions, accounts: ptAccounts, performance: ptPerformance, reports: ptReports, settings: ptSettings, errors: ptErrors, dashboard: ptDashboard, investments: ptInvestments, 'csv-import': ptCsvImport, watchlists: ptWatchlists },
    },
    fallbackLng: 'en',
    defaultNS: 'common',
    ns: ['common', 'navigation', 'securities', 'transactions', 'accounts', 'performance', 'reports', 'settings', 'errors', 'dashboard', 'investments', 'csv-import', 'watchlists', 'welcome', 'switcher', 'portfolioSettings', 'userSettings'],
    detection: {
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: 'quovibe-language',
      caches: ['localStorage'],
    },
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
  });

export default i18n;
