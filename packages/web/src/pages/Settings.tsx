import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Eye, EyeOff, Check, Info, Plus, Minus, Trash2, ChevronUp, ChevronDown } from 'lucide-react';
import { CostMethod } from '@/lib/enums';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { apiFetch } from '@/api/fetch';
import { usePortfolio, useUpdateSettings } from '@/api/use-portfolio';
import { usePortfolio as usePortfolioContext } from '@/context/PortfolioContext';
import {
  useReportingPeriods,
  useDeleteReportingPeriod,
  useReorderReportingPeriods,
} from '@/api/use-reporting-periods';
import ImportPage from '@/pages/ImportPage';
import { SectionSkeleton } from '@/components/shared/SectionSkeleton';
import { cn } from '@/lib/utils';
import { getAllCalendarInfos, resolveReportingPeriod } from '@quovibe/shared';
import { HolidayTable } from '@/components/domain/HolidayTable';
import { NewPeriodDialog } from '@/components/domain/NewPeriodDialog';
import { formatPeriodLabel, DEFAULT_PERIODS } from '@/lib/period-utils';
import { formatDate } from '@/lib/formatters';
import { useQueryClient } from '@tanstack/react-query';

type TabId = 'portfolio' | 'presentation' | 'dataSources' | 'advanced';
const VALID_TABS: TabId[] = ['portfolio', 'presentation', 'dataSources', 'advanced'];

// ---------------------------------------------------------------------------
// SettingRow — reusable row layout for a single setting
// ---------------------------------------------------------------------------

function SettingRow({
  label,
  description,
  children,
  warning,
  savedField,
  currentSavedField,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
  warning?: string;
  savedField?: string;
  currentSavedField?: string | null;
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 py-3.5 border-b border-border last:border-b-0">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{label}</span>
          {savedField && currentSavedField === savedField && (
            <span className="text-xs text-[var(--qv-success)] flex items-center gap-0.5 animate-in fade-in duration-300">
              <Check className="h-3 w-3" />
            </span>
          )}
        </div>
        {description && (
          <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
        )}
        {warning && (
          <p className="text-xs text-[var(--qv-warning)] mt-1 flex items-center gap-1">
            <Info className="h-3 w-3 shrink-0" />
            {warning}
          </p>
        )}
      </div>
      <div className="sm:ml-4 shrink-0">{children}</div>
    </div>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mt-8 first:mt-0 mb-1">
      {children}
    </h3>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function Settings() {
  const { t } = useTranslation('settings');
  const { t: tRaw } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const currentPortfolio = usePortfolioContext();
  const { data: portfolio, isLoading } = usePortfolio();
  const { mutate: updateSettings } = useUpdateSettings();
  const qc = useQueryClient();

  // Tab state from URL
  const tabParam = searchParams.get('tab') as TabId | null;
  const activeTab: TabId = tabParam && VALID_TABS.includes(tabParam) ? tabParam : 'portfolio';

  function setTab(tab: string) {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('tab', tab);
      return next;
    }, { replace: true });
  }

  // Auto-save debounce
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);
  const [savedField, setSavedField] = useState<string | null>(null);
  const savedTimeoutRef = useRef<ReturnType<typeof setTimeout>>(null);

  const autoSave = useCallback((field: string, data: Parameters<typeof updateSettings>[0]) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      updateSettings(data, {
        onSuccess: () => {
          setSavedField(field);
          if (savedTimeoutRef.current) clearTimeout(savedTimeoutRef.current);
          savedTimeoutRef.current = setTimeout(() => setSavedField(null), 2000);

          // Invalidate performance caches for fields that affect calculations
          if ('costMethod' in data || 'currency' in data) {
            qc.invalidateQueries({ queryKey: ['performance'] });
            qc.invalidateQueries({ queryKey: ['reports'] });
            qc.invalidateQueries({ queryKey: ['securities'] });
          }
        },
      });
    }, 600);
  }, [updateSettings, qc]);

  // Local state synced from portfolio
  const [costMethod, setCostMethod] = useState('');
  const [baseCurrency, setBaseCurrency] = useState('');
  const [calendarId, setCalendarId] = useState('default');
  const [calendarYear, setCalendarYear] = useState(new Date().getFullYear());
  const [avApiKey, setAvApiKey] = useState('');
  const [avRateLimit, setAvRateLimit] = useState('25/day');
  const [showApiKey, setShowApiKey] = useState(false);
  const [hasAvApiKey, setHasAvApiKey] = useState(false);
  const [showReimport, setShowReimport] = useState(false);
  const [fxFetching, setFxFetching] = useState(false);
  const [fxResult, setFxResult] = useState<{ count: number; duration: number } | null>(null);

  // Presentation settings from sidecar
  const [sharesPrecision, setSharesPrecision] = useState(1);
  const [quotesPrecision, setQuotesPrecision] = useState(2);
  const [showCurrencyCode, setShowCurrencyCode] = useState(false);
  const [showPaSuffix, setShowPaSuffix] = useState(true);

  // Period dialog
  const [periodDialogOpen, setPeriodDialogOpen] = useState(false);

  // Reporting periods
  const { data: periodsData } = useReportingPeriods();
  const { mutate: deletePeriod } = useDeleteReportingPeriod();
  const { mutate: reorderPeriods } = useReorderReportingPeriods();

  const initializedRef = useRef(false);

  useEffect(() => {
    if (portfolio && !initializedRef.current) {
      initializedRef.current = true;
      setCostMethod(portfolio.config['portfolio.costMethod'] ?? '');
      setBaseCurrency(portfolio.config['portfolio.currency'] ?? portfolio.config['baseCurrency'] ?? '');
      setCalendarId(portfolio.config['portfolio.calendar'] ?? 'default');
      setHasAvApiKey(portfolio.config['hasAlphaVantageApiKey'] === 'true');
      setAvRateLimit(portfolio.config['provider.alphavantage.rateLimit'] ?? '25/day');
      // Sidecar preferences
      setSharesPrecision(parseInt(portfolio.config['sharesPrecision'] ?? '1', 10));
      setQuotesPrecision(parseInt(portfolio.config['quotesPrecision'] ?? '2', 10));
      setShowCurrencyCode(portfolio.config['showCurrencyCode'] === 'true');
      setShowPaSuffix(portfolio.config['showPaSuffix'] !== 'false');
    }
  }, [portfolio]);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (savedTimeoutRef.current) clearTimeout(savedTimeoutRef.current);
    };
  }, []);

  const handleFetchExchangeRates = async () => {
    setFxFetching(true);
    setFxResult(null);
    try {
      const data = await apiFetch<{ totalFetched: number; duration: number }>(
        '/api/prices/fetch-exchange-rates',
        { method: 'POST' },
      );
      setFxResult({ count: data.totalFetched, duration: data.duration });
    } catch {
      setFxResult(null);
    } finally {
      setFxFetching(false);
    }
  };

  // Period management helpers
  const customPeriods = periodsData?.periods ?? [];
  const today = new Date().toISOString().slice(0, 10);

  function handleMovePeriod(index: number, direction: 'up' | 'down') {
    const defs = customPeriods.map((p) => p.definition);
    const newIndex = direction === 'up' ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= defs.length) return;
    const copy = [...defs];
    [copy[index], copy[newIndex]] = [copy[newIndex], copy[index]];
    reorderPeriods(copy);
  }

  return (
    <div className="qv-page max-w-4xl">
      <div className="mb-6">
        <h1 className="text-lg font-semibold text-foreground tracking-tight">{t('title')}</h1>
        <p className="text-sm text-muted-foreground mt-0.5">{t('subtitle')}</p>
      </div>

      {isLoading ? (
        <div className="space-y-6">
          {Array.from({ length: 4 }).map((_, i) => (
            <SectionSkeleton key={i} rows={3} />
          ))}
        </div>
      ) : (
        <>

        <Tabs value={activeTab} onValueChange={setTab}>
          <TabsList className="w-full overflow-x-auto" variant="line">
            <TabsTrigger value="portfolio" className="flex-shrink-0">{t('tabs.portfolio')}</TabsTrigger>
            <TabsTrigger value="presentation" className="flex-shrink-0">{t('tabs.presentation')}</TabsTrigger>
            <TabsTrigger value="dataSources" className="flex-shrink-0">{t('tabs.dataSources')}</TabsTrigger>
            <TabsTrigger value="advanced" className="flex-shrink-0">{t('tabs.advanced')}</TabsTrigger>
          </TabsList>

          {/* ── PORTFOLIO TAB ── */}
          <TabsContent value="portfolio" className="mt-6">
            <SectionHeader>{t('sections.general')}</SectionHeader>

            {costMethod && (
              <SettingRow
                label={t('costMethod.title')}
                description={t('costMethod.description')}
                savedField="costMethod"
                currentSavedField={savedField}
              >
                <div className="flex rounded-lg border border-border overflow-hidden">
                  <button
                    className={cn(
                      'px-3 py-1.5 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none',
                      costMethod === CostMethod.FIFO
                        ? 'bg-background text-foreground shadow-sm'
                        : 'bg-background hover:bg-muted'
                    )}
                    onClick={() => {
                      setCostMethod(CostMethod.FIFO);
                      autoSave('costMethod', { costMethod: CostMethod.FIFO });
                    }}
                  >
                    {t('costMethod.fifo')}
                  </button>
                  <button
                    className={cn(
                      'px-3 py-1.5 text-sm font-medium transition-colors border-l border-border focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none',
                      costMethod === CostMethod.MOVING_AVERAGE
                        ? 'bg-background text-foreground shadow-sm'
                        : 'bg-background hover:bg-muted'
                    )}
                    onClick={() => {
                      setCostMethod(CostMethod.MOVING_AVERAGE);
                      autoSave('costMethod', { costMethod: CostMethod.MOVING_AVERAGE });
                    }}
                  >
                    {t('costMethod.movingAverage')}
                  </button>
                </div>
              </SettingRow>
            )}

            <SectionHeader>{t('sections.currencies')}</SectionHeader>

            <SettingRow
              label={t('baseCurrency.title')}
              description={t('baseCurrency.description')}
              savedField="currency"
              currentSavedField={savedField}
            >
              <Input
                value={baseCurrency}
                onChange={(e) => {
                  const val = e.target.value.toUpperCase().slice(0, 3);
                  setBaseCurrency(val);
                  if (val.length === 3) autoSave('currency', { currency: val });
                }}
                placeholder={t('baseCurrency.placeholder')}
                maxLength={3}
                className="w-24 text-center font-mono"
              />
            </SettingRow>

            <SettingRow
              label={t('calendar.title')}
              description={t('calendar.description')}
              savedField="calendar"
              currentSavedField={savedField}
            >
              <Select
                value={calendarId}
                onValueChange={(val) => {
                  setCalendarId(val);
                  autoSave('calendar', { calendar: val });
                }}
              >
                <SelectTrigger className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {getAllCalendarInfos().map((cal) => (
                    <SelectItem key={cal.id} value={cal.id}>{cal.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </SettingRow>

            {/* Holiday table collapsible */}
            <div className="mt-2 mb-4">
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => setCalendarYear((y) => y - 1)}>
                  &lt;
                </Button>
                <span className="text-sm font-medium w-12 text-center tabular-nums">{calendarYear}</span>
                <Button variant="outline" size="sm" onClick={() => setCalendarYear((y) => y + 1)}>
                  &gt;
                </Button>
              </div>
              <div className="mt-2">
                <HolidayTable calendarId={calendarId} year={calendarYear} />
              </div>
            </div>

            <SectionHeader>{t('sections.reportingPeriods')}</SectionHeader>

            {/* Default periods */}
            {DEFAULT_PERIODS.map((period, i) => {
              const resolved = resolveReportingPeriod(period, today);
              return (
                <div key={`default-${i}`} className="flex items-center justify-between py-2.5 border-b border-border">
                  <div>
                    <span className="text-sm font-medium">{formatPeriodLabel(period, tRaw)}</span>
                    <Badge variant="secondary" className="ml-2 text-[10px]">{t('periods.defaultBadge')}</Badge>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {formatDate(resolved.periodStart)} — {formatDate(resolved.periodEnd)}
                    </p>
                  </div>
                </div>
              );
            })}

            {/* Custom periods */}
            {customPeriods.map((period, index) => (
              <div key={index} className="flex items-center justify-between py-2.5 border-b border-border">
                <div>
                  <span className="text-sm font-medium">{formatPeriodLabel(period.definition, tRaw)}</span>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {formatDate(period.resolved.periodStart)} — {formatDate(period.resolved.periodEnd)}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    disabled={index === 0}
                    onClick={() => handleMovePeriod(index, 'up')}
                    title={t('periods.moveUp')}
                  >
                    <ChevronUp className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    disabled={index === customPeriods.length - 1}
                    onClick={() => handleMovePeriod(index, 'down')}
                    title={t('periods.moveDown')}
                  >
                    <ChevronDown className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-destructive hover:text-destructive"
                    onClick={() => deletePeriod(index)}
                    title={t('periods.deletePeriod')}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}

            {customPeriods.length === 0 && (
              <p className="text-xs text-muted-foreground py-3">{t('periods.noPeriods')}</p>
            )}

            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => setPeriodDialogOpen(true)}
            >
              <Plus className="h-3.5 w-3.5 mr-1.5" />
              {t('periods.addPeriod')}
            </Button>
          </TabsContent>

          {/* ── PRESENTATION TAB ── */}
          <TabsContent value="presentation" className="mt-6">
            <SectionHeader>{t('sections.display')}</SectionHeader>

            <SettingRow
              label={t('presentation.showCurrencyCode')}
              description={t('presentation.showCurrencyCodeDescription')}
              savedField="showCurrencyCode"
              currentSavedField={savedField}
            >
              <Switch
                checked={showCurrencyCode}
                onCheckedChange={(val) => {
                  setShowCurrencyCode(val);
                  autoSave('showCurrencyCode', { showCurrencyCode: val });
                }}
              />
            </SettingRow>

            <SettingRow
              label={t('presentation.showPaSuffix')}
              description={t('presentation.showPaSuffixDescription')}
              savedField="showPaSuffix"
              currentSavedField={savedField}
            >
              <Switch
                checked={showPaSuffix}
                onCheckedChange={(val) => {
                  setShowPaSuffix(val);
                  autoSave('showPaSuffix', { showPaSuffix: val });
                }}
              />
            </SettingRow>

            <SectionHeader>{t('sections.precision')}</SectionHeader>

            <SettingRow
              label={t('presentation.sharesPrecision')}
              description={t('presentation.sharesPrecisionDescription')}
              savedField="sharesPrecision"
              currentSavedField={savedField}
            >
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  disabled={sharesPrecision <= 1}
                  onClick={() => {
                    const val = sharesPrecision - 1;
                    setSharesPrecision(val);
                    autoSave('sharesPrecision', { sharesPrecision: val });
                  }}
                >
                  <Minus className="h-3.5 w-3.5" />
                </Button>
                <span className="w-8 text-center text-sm tabular-nums">{sharesPrecision}</span>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  disabled={sharesPrecision >= 8}
                  onClick={() => {
                    const val = sharesPrecision + 1;
                    setSharesPrecision(val);
                    autoSave('sharesPrecision', { sharesPrecision: val });
                  }}
                >
                  <Plus className="h-3.5 w-3.5" />
                </Button>
              </div>
            </SettingRow>

            <SettingRow
              label={t('presentation.quotesPrecision')}
              description={t('presentation.quotesPrecisionDescription')}
              savedField="quotesPrecision"
              currentSavedField={savedField}
            >
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  disabled={quotesPrecision <= 1}
                  onClick={() => {
                    const val = quotesPrecision - 1;
                    setQuotesPrecision(val);
                    autoSave('quotesPrecision', { quotesPrecision: val });
                  }}
                >
                  <Minus className="h-3.5 w-3.5" />
                </Button>
                <span className="w-8 text-center text-sm tabular-nums">{quotesPrecision}</span>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  disabled={quotesPrecision >= 8}
                  onClick={() => {
                    const val = quotesPrecision + 1;
                    setQuotesPrecision(val);
                    autoSave('quotesPrecision', { quotesPrecision: val });
                  }}
                >
                  <Plus className="h-3.5 w-3.5" />
                </Button>
              </div>
            </SettingRow>
          </TabsContent>

          {/* ── DATA SOURCES TAB ── */}
          <TabsContent value="dataSources" className="mt-6">
            <SectionHeader>{t('sections.quoteProviders')}</SectionHeader>

            <SettingRow
              label={t('quoteProviders.alphaVantage') + ' — ' + t('quoteProviders.apiKey')}
              description={
                hasAvApiKey && !avApiKey
                  ? t('quoteProviders.apiKeyConfigured')
                  : !hasAvApiKey && !avApiKey
                  ? t('quoteProviders.apiKeyNotConfigured')
                  : undefined
              }
              savedField="alphaVantageApiKey"
              currentSavedField={savedField}
            >
              <div className="flex gap-1.5">
                <Input
                  type={showApiKey ? 'text' : 'password'}
                  value={avApiKey}
                  onChange={(e) => setAvApiKey(e.target.value)}
                  onBlur={() => {
                    if (avApiKey) autoSave('alphaVantageApiKey', { alphaVantageApiKey: avApiKey });
                  }}
                  placeholder={t('quoteProviders.apiKeyPlaceholder')}
                  className="font-mono text-xs w-56"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9"
                  onClick={() => setShowApiKey(!showApiKey)}
                >
                  {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
            </SettingRow>

            <SettingRow
              label={t('quoteProviders.rateLimit')}
              savedField="alphaVantageRateLimit"
              currentSavedField={savedField}
            >
              <Select
                value={avRateLimit}
                onValueChange={(val) => {
                  setAvRateLimit(val);
                  autoSave('alphaVantageRateLimit', { alphaVantageRateLimit: val });
                }}
              >
                <SelectTrigger className="w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="25/day">{t('quoteProviders.rateLimit25day')}</SelectItem>
                  <SelectItem value="75/min">{t('quoteProviders.rateLimit75min')}</SelectItem>
                </SelectContent>
              </Select>
            </SettingRow>

            <p className="text-xs text-muted-foreground mt-2">
              {t('quoteProviders.getApiKey')}{' '}
              <a
                href="https://www.alphavantage.co/support/#api-key"
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
              >
                alphavantage.co
              </a>
            </p>

            <SectionHeader>{t('exchangeRates.title')}</SectionHeader>

            <div className="py-3.5">
              <Button onClick={handleFetchExchangeRates} disabled={fxFetching} size="sm">
                {fxFetching ? t('exchangeRates.fetching') : t('exchangeRates.fetchButton')}
              </Button>
              {fxResult && (
                <p className="text-xs text-muted-foreground mt-2">
                  {t('exchangeRates.fetchSuccess', { count: fxResult.count, duration: fxResult.duration })}
                </p>
              )}
            </div>
          </TabsContent>

          {/* ── ADVANCED TAB ── */}
          <TabsContent value="advanced" className="mt-6">
            <SectionHeader>{t('sections.actions')}</SectionHeader>

            <div className="py-3.5 border-b border-border">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-sm font-medium">{t('export.exportPortfolio')}</span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => { window.location.href = '/api/portfolio/export'; }}
                >
                  {t('export.exportPortfolio')}
                </Button>
              </div>
            </div>

            <div className="py-3.5 border-b border-border">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-sm font-medium">{t('csvImport.title')}</span>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {t('csvImport.description')}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigate(`/p/${currentPortfolio.id}/import/csv`)}
                >
                  {t('csvImport.button')}
                </Button>
              </div>
            </div>

            <div className="py-3.5">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-sm font-medium">{t('dataManagement.title')}</span>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {t('dataManagement.uploadHelp')}
                  </p>
                </div>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => setShowReimport(true)}
                >
                  {t('dataManagement.replacePortfolio')}
                </Button>
              </div>
            </div>
          </TabsContent>
        </Tabs>

        {/* Dialogs */}
        <Dialog open={showReimport} onOpenChange={setShowReimport}>
          <DialogContent className="p-0 max-w-lg">
            <DialogTitle className="sr-only">{t('dataManagement.replacePortfolio')}</DialogTitle>
            <DialogDescription className="sr-only">{t('dataManagement.replacePortfolio')}</DialogDescription>
            <ImportPage isReimport onClose={() => setShowReimport(false)} />
          </DialogContent>
        </Dialog>

        <NewPeriodDialog
          open={periodDialogOpen}
          onOpenChange={setPeriodDialogOpen}
        />
        </>
      )}
    </div>
  );
}
