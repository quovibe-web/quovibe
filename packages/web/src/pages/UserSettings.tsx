// packages/web/src/pages/UserSettings.tsx
//
// User-level preferences page (no portfolio scope).
// Reads/writes the sidecar via `GET /api/settings` and `PUT /api/settings/preferences`
// (plus the existing `PUT /api/settings/auto-fetch` for the app-level toggle).
// Uses raw `apiFetch` — not React Query — per the Phase 5b blocker constraints.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Plus, Minus, Palette, SlidersHorizontal, RefreshCw, CalendarRange, type LucideIcon } from 'lucide-react';
import { format } from 'date-fns';
import { type QuovibeSettings, type QuovibePreferences, type FiscalYearConfig, fiscalActive } from '@quovibe/shared';
import { apiFetch } from '@/api/fetch';
import { formatPeriodRange, buildFiscalPreview } from '@/lib/period-utils';
import { getDateLocale } from '@/lib/formatters';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { PageHeader } from '@/components/shared/PageHeader';
import { SegmentedControl } from '@/components/shared/SegmentedControl';
import { useTheme, type ThemeMode } from '@/hooks/use-theme';
import { usePrivacy } from '@/context/privacy-context';
import { useLanguage, type LanguageCode } from '@/hooks/use-language';

type AppFlagKey = 'autoFetchPricesOnFirstOpen';

const APP_FLAG_ROUTE: Record<AppFlagKey, string> = {
  autoFetchPricesOnFirstOpen: '/api/settings/auto-fetch',
};

type SettingsResponse = Pick<QuovibeSettings, 'preferences' | 'app'>;

const DEFAULT_FISCAL_YEAR: FiscalYearConfig = {
  enabled: false,
  startMonth: 1,
  startDay: 1,
  numbering: 'endYear',
};

function SettingRow({
  label,
  description,
  children,
  saved,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
  saved?: boolean;
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 py-3.5 border-b border-[var(--qv-border-subtle)] last:border-b-0">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{label}</span>
          {saved && (
            <span className="text-xs text-[var(--qv-success)] flex items-center gap-0.5 animate-in fade-in duration-300">
              <Check className="h-3 w-3" />
            </span>
          )}
        </div>
        {description && (
          <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
        )}
      </div>
      <div className="sm:ml-4 shrink-0">{children}</div>
    </div>
  );
}

function SectionHeader({
  icon: Icon,
  children,
}: {
  icon: LucideIcon;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 mt-10 first:mt-0 mb-3">
      <Icon
        className="h-3.5 w-3.5 text-muted-foreground"
        strokeWidth={1.75}
        aria-hidden="true"
      />
      <h3 className="qv-eyebrow">{children}</h3>
    </div>
  );
}

export default function UserSettings() {
  const { t, i18n } = useTranslation('settings');
  const { t: tUser } = useTranslation('userSettings');
  useEffect(() => { document.title = `${tUser('preferences.title')} · quovibe`; }, [tUser]);

  const { theme, setTheme } = useTheme();
  const { isPrivate, setPrivacy } = usePrivacy();
  const { language, setLanguage, availableLanguages } = useLanguage();

  // Local mirror of the sidecar payload. Seeded on mount; each control writes
  // back via `apiFetch` and optimistically updates local state.
  const [sharesPrecision, setSharesPrecision] = useState(1);
  const [quotesPrecision, setQuotesPrecision] = useState(2);
  const [showCurrencyCode, setShowCurrencyCode] = useState(false);
  const [showPaSuffix, setShowPaSuffix] = useState(true);
  const [fiscalYear, setFiscalYear] = useState<FiscalYearConfig>(DEFAULT_FISCAL_YEAR);
  const [appFlags, setAppFlags] = useState<Record<AppFlagKey, boolean>>({
    autoFetchPricesOnFirstOpen: false,
  });

  const [savedField, setSavedField] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<SettingsResponse>('/api/settings')
      .then((s) => {
        setSharesPrecision(s.preferences.sharesPrecision ?? 1);
        setQuotesPrecision(s.preferences.quotesPrecision ?? 2);
        setShowCurrencyCode(s.preferences.showCurrencyCode ?? false);
        setShowPaSuffix(s.preferences.showPaSuffix ?? true);
        setFiscalYear(s.preferences.fiscalYear ?? DEFAULT_FISCAL_YEAR);
        setAppFlags({
          autoFetchPricesOnFirstOpen: s.app.autoFetchPricesOnFirstOpen ?? false,
        });
      })
      .catch(() => { /* keep defaults */ });
  }, []);

  function flashSaved(field: string): void {
    setSavedField(field);
    setTimeout(() => {
      setSavedField((prev) => (prev === field ? null : prev));
    }, 2000);
  }

  async function savePreference(
    field: keyof QuovibePreferences,
    value: string | number | boolean,
  ): Promise<void> {
    await apiFetch('/api/settings/preferences', {
      method: 'PUT',
      body: JSON.stringify({ [field]: value }),
    });
    flashSaved(field);
  }

  async function saveFiscalYear(next: FiscalYearConfig): Promise<void> {
    setFiscalYear(next);
    await apiFetch('/api/settings/preferences', {
      method: 'PUT',
      body: JSON.stringify({ fiscalYear: next }),
    });
    flashSaved('fiscalYear');
  }

  async function saveAppFlag(key: AppFlagKey, next: boolean): Promise<void> {
    setAppFlags(prev => ({ ...prev, [key]: next }));
    await apiFetch(APP_FLAG_ROUTE[key], {
      method: 'PUT',
      body: JSON.stringify({ [key]: next }),
    });
    flashSaved(key);
  }

  const onLanguageChange = (code: LanguageCode): void => {
    setLanguage(code);
    void savePreference('language', code);
  };

  const onThemeChange = (next: ThemeMode): void => {
    setTheme(next);
    void savePreference('theme', next);
  };

  const onPrivacyChange = (next: boolean): void => {
    setPrivacy(next);
    void savePreference('privacyMode', next);
  };

  const fyPreview = fiscalActive(fiscalYear)
    ? buildFiscalPreview(fiscalYear, format(new Date(), 'yyyy-MM-dd'))
    : null;


  return (
    <main className="qv-page mx-auto max-w-3xl p-6">
      <div className="mb-8">
        <PageHeader title={tUser('preferences.title')} subtitle={tUser('preferences.subtitle')} />
      </div>

      {/* ── LANGUAGE & APPEARANCE ── */}
      <section>
        <SectionHeader icon={Palette}>{t('sections.display')}</SectionHeader>

        <SettingRow
          label={t('presentation.language')}
          description={t('presentation.languageDescription')}
          saved={savedField === 'language'}
        >
          <Select value={language} onValueChange={(v) => onLanguageChange(v as LanguageCode)}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {availableLanguages.map((l) => (
                <SelectItem key={l.code} value={l.code}>
                  {l.flag} {l.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingRow>

        <SettingRow
          label={t('presentation.theme')}
          description={t('presentation.themeDescription')}
          saved={savedField === 'theme'}
        >
          <SegmentedControl<ThemeMode>
            segments={[
              { value: 'light', label: t('presentation.themeLight') },
              { value: 'system', label: t('presentation.themeSystem') },
              { value: 'dark', label: t('presentation.themeDark') },
            ]}
            value={theme}
            onChange={onThemeChange}
            size="md"
          />
        </SettingRow>

        <SettingRow
          label={t('presentation.privacyMode')}
          description={t('presentation.privacyModeDescription')}
          saved={savedField === 'privacyMode'}
        >
          <Switch checked={isPrivate} onCheckedChange={onPrivacyChange} />
        </SettingRow>
      </section>

      {/* ── DISPLAY FORMAT ── */}
      <section>
        <SectionHeader icon={SlidersHorizontal}>{t('sections.precision')}</SectionHeader>

        <SettingRow
          label={t('presentation.sharesPrecision')}
          description={t('presentation.sharesPrecisionDescription')}
          saved={savedField === 'sharesPrecision'}
        >
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              disabled={sharesPrecision <= 1}
              onClick={() => {
                const v = sharesPrecision - 1;
                setSharesPrecision(v);
                void savePreference('sharesPrecision', v);
              }}
            >
              <Minus className="h-3.5 w-3.5" />
            </Button>
            <span className="w-8 text-center qv-numeric text-sm">{sharesPrecision}</span>
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              disabled={sharesPrecision >= 8}
              onClick={() => {
                const v = sharesPrecision + 1;
                setSharesPrecision(v);
                void savePreference('sharesPrecision', v);
              }}
            >
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </div>
        </SettingRow>

        <SettingRow
          label={t('presentation.quotesPrecision')}
          description={t('presentation.quotesPrecisionDescription')}
          saved={savedField === 'quotesPrecision'}
        >
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              disabled={quotesPrecision <= 1}
              onClick={() => {
                const v = quotesPrecision - 1;
                setQuotesPrecision(v);
                void savePreference('quotesPrecision', v);
              }}
            >
              <Minus className="h-3.5 w-3.5" />
            </Button>
            <span className="w-8 text-center qv-numeric text-sm">{quotesPrecision}</span>
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              disabled={quotesPrecision >= 8}
              onClick={() => {
                const v = quotesPrecision + 1;
                setQuotesPrecision(v);
                void savePreference('quotesPrecision', v);
              }}
            >
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </div>
        </SettingRow>

        <SettingRow
          label={t('presentation.showCurrencyCode')}
          description={t('presentation.showCurrencyCodeDescription')}
          saved={savedField === 'showCurrencyCode'}
        >
          <Switch
            checked={showCurrencyCode}
            onCheckedChange={(v) => {
              setShowCurrencyCode(v);
              void savePreference('showCurrencyCode', v);
            }}
          />
        </SettingRow>

        <SettingRow
          label={t('presentation.showPaSuffix')}
          description={t('presentation.showPaSuffixDescription')}
          saved={savedField === 'showPaSuffix'}
        >
          <Switch
            checked={showPaSuffix}
            onCheckedChange={(v) => {
              setShowPaSuffix(v);
              void savePreference('showPaSuffix', v);
            }}
          />
        </SettingRow>
      </section>

      {/* ── FISCAL YEAR ── */}
      <section>
        <SectionHeader icon={CalendarRange}>{t('fiscalYear.title')}</SectionHeader>

        <SettingRow
          label={t('fiscalYear.enable')}
          description={t('fiscalYear.description')}
          saved={savedField === 'fiscalYear'}
        >
          <Switch
            checked={fiscalYear.enabled}
            onCheckedChange={(v) => void saveFiscalYear({ ...fiscalYear, enabled: v })}
          />
        </SettingRow>

        {fiscalYear.enabled && (
          <>
            <SettingRow label={t('fiscalYear.startMonth')}>
              <Select
                value={String(fiscalYear.startMonth)}
                onValueChange={(v) => void saveFiscalYear({ ...fiscalYear, startMonth: Number(v) })}
              >
                <SelectTrigger className="w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Array.from({ length: 12 }, (_, m) => (
                    <SelectItem key={m + 1} value={String(m + 1)}>
                      {format(new Date(2000, m, 1), 'LLLL', { locale: getDateLocale(i18n.language) })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </SettingRow>

            <SettingRow label={t('fiscalYear.startDay')}>
              <Select
                value={String(fiscalYear.startDay)}
                onValueChange={(v) => void saveFiscalYear({ ...fiscalYear, startDay: Number(v) })}
              >
                <SelectTrigger className="w-24">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Array.from({ length: 31 }, (_, d) => (
                    <SelectItem key={d + 1} value={String(d + 1)}>
                      {d + 1}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </SettingRow>

            <SettingRow label={t('fiscalYear.numbering')} description={t('fiscalYear.numberingHint')}>
              <SegmentedControl<'startYear' | 'endYear'>
                segments={[
                  { value: 'startYear', label: t('fiscalYear.numberingStartYear') },
                  { value: 'endYear', label: t('fiscalYear.numberingEndYear') },
                ]}
                value={fiscalYear.numbering}
                onChange={(v) => void saveFiscalYear({ ...fiscalYear, numbering: v })}
                size="md"
              />
            </SettingRow>

            {fyPreview && (
              <p className="px-1 py-2 text-xs text-muted-foreground">
                {t('fiscalYear.preview')}:{' '}
                {t('periods.labels.fiscalYear', { year: fyPreview.fyLabel })} ·{' '}
                {formatPeriodRange(fyPreview.periodStart, fyPreview.periodEnd, i18n.language)}
              </p>
            )}
          </>
        )}
      </section>

      {/* ── UPDATES ── */}
      <section>
        <SectionHeader icon={RefreshCw}>{tUser('updates.title')}</SectionHeader>

        <SettingRow
          label={tUser('updates.autoFetchLabel')}
          description={tUser('updates.autoFetchHint')}
          saved={savedField === 'autoFetchPricesOnFirstOpen'}
        >
          <Switch
            checked={appFlags.autoFetchPricesOnFirstOpen}
            onCheckedChange={(v) => void saveAppFlag('autoFetchPricesOnFirstOpen', v)}
          />
        </SettingRow>
      </section>
    </main>
  );
}
