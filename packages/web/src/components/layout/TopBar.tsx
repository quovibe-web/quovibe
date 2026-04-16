import { useState, useMemo, useEffect } from 'react';
import { format } from 'date-fns';
import { CalendarIcon, Eye, EyeOff, Sun, Moon, Monitor, Plus, MoreHorizontal, Settings, Menu } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Separator } from '@/components/ui/separator';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetTrigger,
} from '@/components/ui/sheet';
import { useReportingPeriod } from '@/api/use-performance';
import { useFirstTransactionDate } from '@/api/use-transactions';
import { useReportingPeriods } from '@/api/use-reporting-periods';
import { usePortfolio, useUpdateSettings } from '@/api/use-portfolio';
import { usePortfolio as usePortfolioContext } from '@/context/PortfolioContext';
import { usePrivacy } from '@/context/privacy-context';
import { useTheme } from '@/hooks/use-theme';
import { LanguageSwitcher } from '@/components/shared/LanguageSwitcher';
import { NewPeriodDialog } from '@/components/domain/NewPeriodDialog';
import { DEFAULT_PERIODS, formatPeriodShortLabel, formatPeriodLabel, getPeriodId, ALL_PERIOD_ID } from '@/lib/period-utils';
import { resolveReportingPeriod } from '@quovibe/shared';
import type { ReportingPeriodDef } from '@quovibe/shared';
import { formatDate } from '@/lib/formatters';
import { cn } from '@/lib/utils';

const today = () => new Date();
const fmt = (d: Date) => format(d, 'yyyy-MM-dd');

// Max custom periods to show as pills in the TopBar
const MAX_PILL_CUSTOM = 2;

/** Privacy + Light/System/Dark toggle group */
function ToggleGroup() {
  const { t } = useTranslation('navigation');
  const { isPrivate, togglePrivacy } = usePrivacy();
  const { theme, setTheme } = useTheme();
  const { mutate: updateSettings } = useUpdateSettings();

  function handleTheme(next: 'light' | 'dark' | 'system') {
    setTheme(next);
    updateSettings({ theme: next });
  }

  function handlePrivacy() {
    togglePrivacy();
    updateSettings({ privacyMode: !isPrivate });
  }

  return (
    <div className="flex items-center gap-0.5 rounded-full bg-muted p-0.5">
      <button
        onClick={handlePrivacy}
        className={cn(
          'p-1.5 rounded-full transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none',
          isPrivate
            ? 'bg-card text-foreground'
            : 'text-muted-foreground hover:text-foreground'
        )}
        title={isPrivate ? t('privacy.disable') : t('privacy.enable')}
        aria-label={isPrivate ? t('privacy.disable') : t('privacy.enable')}
      >
        {isPrivate ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
      <button
        onClick={() => handleTheme('light')}
        className={cn(
          'hidden md:inline-flex p-1.5 rounded-full transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none',
          theme === 'light'
            ? 'bg-card text-primary'
            : 'text-muted-foreground hover:text-foreground'
        )}
        title={t('theme.light')}
        aria-label={t('theme.light')}
      >
        <Sun className="h-4 w-4" />
      </button>
      <button
        onClick={() => handleTheme('system')}
        className={cn(
          'hidden md:inline-flex p-1.5 rounded-full transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none',
          theme === 'system'
            ? 'bg-card text-primary'
            : 'text-muted-foreground hover:text-foreground'
        )}
        title={t('theme.system')}
        aria-label={t('theme.system')}
      >
        <Monitor className="h-4 w-4" />
      </button>
      <button
        onClick={() => handleTheme('dark')}
        className={cn(
          'hidden md:inline-flex p-1.5 rounded-full transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none',
          theme === 'dark'
            ? 'bg-card text-primary'
            : 'text-muted-foreground hover:text-foreground'
        )}
        title={t('theme.dark')}
        aria-label={t('theme.dark')}
      >
        <Moon className="h-4 w-4" />
      </button>
    </div>
  );
}

// Period pill styling: override ghost variant's dark:hover:bg-accent/50 which
// has higher specificity than hover:bg-primary/90 in dark mode, masking the
// active button highlight. Swap transition-all → transition-colors to avoid
// cursor/layout flicker.
const PERIOD_PILL = 'transition-colors';
const PERIOD_PILL_ACTIVE =
  'bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground dark:hover:bg-primary/90 dark:hover:text-primary-foreground';

function PeriodSelector() {
  const { t } = useTranslation('navigation');
  const { t: tRaw } = useTranslation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { periodStart, periodEnd, setPeriod } = useReportingPeriod();
  const { data: firstDateData } = useFirstTransactionDate();
  const { data: periodsData } = useReportingPeriods();
  const { data: portfolioData } = usePortfolio();
  const currentPortfolio = usePortfolioContext();
  const { mutate: updateSettings } = useUpdateSettings();


  const [overflowOpen, setOverflowOpen] = useState(false);
  const [periodDialogOpen, setPeriodDialogOpen] = useState(false);

  const todayStr = fmt(today());

  // Resolve all default periods
  const resolvedDefaults = useMemo(
    () => DEFAULT_PERIODS.map((def) => ({
      definition: def,
      resolved: resolveReportingPeriod(def, todayStr),
      label: formatPeriodShortLabel(def, tRaw),
      id: getPeriodId(def),
    })),
    [todayStr, tRaw],
  );

  // Custom periods from sidecar (stabilize reference to avoid useEffect churn)
  const customPeriods = useMemo(() => periodsData?.periods ?? [], [periodsData?.periods]);

  // Pills: first MAX_PILL_CUSTOM custom periods
  const pillCustom = customPeriods.slice(0, MAX_PILL_CUSTOM);

  // Step 5: Initialize period from sidecar when URL params are absent
  // Re-runs after page navigation (which clears search params from the URL)
  useEffect(() => {
    if (!portfolioData) return; // wait for portfolio settings to load

    const hasUrlParams = searchParams.has('periodStart') && searchParams.has('periodEnd');
    if (hasUrlParams) return;

    const storedId = portfolioData.config.activeReportingPeriodId ?? null;
    let resolved: { periodStart: string; periodEnd: string } | null = null;

    if (storedId) {
      // Try to match stored ID against default periods
      for (const def of DEFAULT_PERIODS) {
        if (getPeriodId(def) === storedId) {
          resolved = resolveReportingPeriod(def, todayStr);
          break;
        }
      }
      // Try custom periods
      if (!resolved) {
        for (const cp of customPeriods) {
          if (getPeriodId(cp.definition) === storedId) {
            resolved = resolveReportingPeriod(cp.definition, todayStr);
            break;
          }
        }
      }
      // Try "ALL"
      if (!resolved && storedId === ALL_PERIOD_ID && firstDateData?.date) {
        resolved = { periodStart: firstDateData.date, periodEnd: todayStr };
      }
    }

    // Fallback to first default period (1Y)
    if (!resolved) {
      resolved = resolveReportingPeriod(DEFAULT_PERIODS[0], todayStr);
    }

    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('periodStart', resolved.periodStart);
      next.set('periodEnd', resolved.periodEnd);
      return next;
    }, { replace: true });
  }, [portfolioData, searchParams, setSearchParams, todayStr, customPeriods, firstDateData]);

  // Check if a period matches current URL params
  function isPeriodActive(resolved: { periodStart: string; periodEnd: string }): boolean {
    return periodStart === resolved.periodStart && periodEnd === resolved.periodEnd;
  }

  const isAllActive = firstDateData?.date
    ? periodStart === firstDateData.date && periodEnd === todayStr
    : false;

  // Step 7: Persist selection to sidecar on click
  function selectPeriod(def: ReportingPeriodDef) {
    const resolved = resolveReportingPeriod(def, todayStr);
    setPeriod(resolved.periodStart, resolved.periodEnd);
    updateSettings({ activeReportingPeriodId: getPeriodId(def) });
  }

  function selectAll() {
    if (!firstDateData?.date) return;
    setPeriod(firstDateData.date, todayStr);
    updateSettings({ activeReportingPeriodId: ALL_PERIOD_ID });
  }

  return (
    <>
      {/* Desktop period bar */}
      <div className="hidden md:flex items-center gap-1 min-w-0 overflow-x-auto scrollbar-hide">
        <span className="text-xs font-medium text-muted-foreground mr-1">{t('period')}</span>

        {/* Default period pills */}
        {resolvedDefaults.map((d, i) => (
          <Button
            key={`default-${i}`}
            variant="ghost"
            size="sm"
            className={cn(
              'h-7 px-2.5 text-xs font-medium rounded-full',
              PERIOD_PILL,
              isPeriodActive(d.resolved) && PERIOD_PILL_ACTIVE,
            )}
            onClick={() => selectPeriod(d.definition)}
          >
            {d.label}
          </Button>
        ))}

        {/* ALL button */}
        {firstDateData?.date && (
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              'h-7 px-2.5 text-xs font-medium rounded-full',
              PERIOD_PILL,
              isAllActive && PERIOD_PILL_ACTIVE,
            )}
            onClick={selectAll}
          >
            {t('presets.ALL')}
          </Button>
        )}

        {/* Custom period pills — separated from built-in presets */}
        {pillCustom.length > 0 && (
          <span className="w-px h-4 bg-border mx-0.5" />
        )}
        {pillCustom.map((p, i) => (
          <Button
            key={`custom-${i}`}
            variant="ghost"
            size="sm"
            className={cn(
              'h-7 px-2.5 text-xs font-medium rounded-full max-w-[160px] truncate',
              PERIOD_PILL,
              isPeriodActive(p.resolved) && PERIOD_PILL_ACTIVE,
            )}
            onClick={() => selectPeriod(p.definition)}
            title={formatPeriodShortLabel(p.definition, tRaw)}
          >
            {formatPeriodShortLabel(p.definition, tRaw)}
          </Button>
        ))}

        {/* "+" button */}
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0 text-xs"
          onClick={() => setPeriodDialogOpen(true)}
          title={t('newPeriod')}
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>

        {/* "..." overflow menu */}
        <Popover open={overflowOpen} onOpenChange={setOverflowOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 text-xs"
              title={t('morePeriods')}
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-72 p-2" align="start">
            <div className="space-y-0.5">
              {/* All default periods */}
              {resolvedDefaults.map((d, i) => (
                <button
                  key={`overflow-default-${i}`}
                  className={cn(
                    'w-full text-left px-2.5 py-1.5 rounded-md text-sm transition-colors',
                    isPeriodActive(d.resolved)
                      ? 'bg-primary/10 text-primary font-medium'
                      : 'hover:bg-muted',
                  )}
                  onClick={() => { selectPeriod(d.definition); setOverflowOpen(false); }}
                >
                  <span>{formatPeriodLabel(d.definition, tRaw)}</span>
                  <span className="block text-[10px] text-muted-foreground font-mono tabular-nums">
                    {formatDate(d.resolved.periodStart)} — {formatDate(d.resolved.periodEnd)}
                  </span>
                </button>
              ))}

              {/* ALL */}
              {firstDateData?.date && (
                <button
                  className={cn(
                    'w-full text-left px-2.5 py-1.5 rounded-md text-sm transition-colors',
                    isAllActive ? 'bg-primary/10 text-primary font-medium' : 'hover:bg-muted',
                  )}
                  onClick={() => { selectAll(); setOverflowOpen(false); }}
                >
                  <span>{t('presets.ALL')}</span>
                  <span className="block text-[10px] text-muted-foreground font-mono tabular-nums">
                    {formatDate(firstDateData.date)} — {formatDate(todayStr)}
                  </span>
                </button>
              )}

              {/* Custom periods */}
              {customPeriods.length > 0 && (
                <Separator className="my-1" />
              )}
              {customPeriods.map((p, i) => (
                <button
                  key={`overflow-custom-${i}`}
                  className={cn(
                    'w-full text-left px-2.5 py-1.5 rounded-md text-sm transition-colors',
                    isPeriodActive(p.resolved)
                      ? 'bg-primary/10 text-primary font-medium'
                      : 'hover:bg-muted',
                  )}
                  onClick={() => { selectPeriod(p.definition); setOverflowOpen(false); }}
                >
                  <span>{formatPeriodLabel(p.definition, tRaw)}</span>
                  <span className="block text-[10px] text-muted-foreground font-mono tabular-nums">
                    {formatDate(p.resolved.periodStart)} — {formatDate(p.resolved.periodEnd)}
                  </span>
                </button>
              ))}

              <Separator className="my-1" />

              {/* New period */}
              <button
                className="w-full text-left px-2.5 py-1.5 rounded-md text-sm hover:bg-muted flex items-center gap-1.5"
                onClick={() => { setPeriodDialogOpen(true); setOverflowOpen(false); }}
              >
                <Plus className="h-3.5 w-3.5" />
                {t('newPeriod')}
              </button>

              {/* Manage periods */}
              <button
                className="w-full text-left px-2.5 py-1.5 rounded-md text-sm hover:bg-muted flex items-center gap-1.5"
                onClick={() => { navigate(`/p/${currentPortfolio.id}/settings/data?tab=periods`); setOverflowOpen(false); }}
              >
                <Settings className="h-3.5 w-3.5" />
                {t('managePeriods')}
              </button>
            </div>
          </PopoverContent>
        </Popover>

        <Separator orientation="vertical" className="h-5 mx-1.5 hidden lg:block" />
        <span className="hidden lg:inline text-xs font-mono text-muted-foreground tabular-nums whitespace-nowrap">
          {formatDate(periodStart)} — {formatDate(periodEnd)}
        </span>
      </div>

      {/* Mobile period — compact tappable display */}
      <Sheet>
        <SheetTrigger asChild>
          <button className="md:hidden flex items-center gap-1.5 text-xs text-muted-foreground font-mono tabular-nums px-2 py-1 rounded-md hover:bg-muted/50 transition-colors">
            <CalendarIcon className="h-3.5 w-3.5" />
            {formatDate(periodStart ?? '')} — {formatDate(periodEnd ?? '')}
          </button>
        </SheetTrigger>
        <SheetContent side="bottom" className="h-auto rounded-t-2xl">
          <SheetHeader>
            <SheetTitle>{t('reportingPeriod')}</SheetTitle>
            <SheetDescription className="sr-only">{t('reportingPeriod')}</SheetDescription>
          </SheetHeader>
          <div className="py-4 space-y-4">
            <div className="flex flex-wrap gap-2">
              {/* Default periods */}
              {resolvedDefaults.map((d, i) => (
                <Button
                  key={`mobile-default-${i}`}
                  variant="ghost"
                  size="sm"
                  className={cn(
                    'h-9 px-4 text-sm font-medium rounded-lg',
                    PERIOD_PILL,
                    isPeriodActive(d.resolved) && PERIOD_PILL_ACTIVE,
                  )}
                  onClick={() => selectPeriod(d.definition)}
                >
                  {d.label}
                </Button>
              ))}

              {/* ALL */}
              {firstDateData?.date && (
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn(
                    'h-9 px-4 text-sm font-medium rounded-lg',
                    PERIOD_PILL,
                    isAllActive && PERIOD_PILL_ACTIVE,
                  )}
                  onClick={selectAll}
                >
                  {t('presets.ALL')}
                </Button>
              )}

              {/* Custom periods */}
              {customPeriods.map((p, i) => (
                <Button
                  key={`mobile-custom-${i}`}
                  variant="ghost"
                  size="sm"
                  className={cn(
                    'h-9 px-4 text-sm font-medium rounded-lg',
                    PERIOD_PILL,
                    isPeriodActive(p.resolved) && PERIOD_PILL_ACTIVE,
                  )}
                  onClick={() => selectPeriod(p.definition)}
                >
                  {formatPeriodShortLabel(p.definition, tRaw)}
                </Button>
              ))}

              {/* Add new */}
              <Button
                variant="ghost"
                size="sm"
                className="h-9 px-4 text-sm font-medium rounded-lg"
                onClick={() => setPeriodDialogOpen(true)}
              >
                <Plus className="h-3.5 w-3.5 mr-1" />
                {t('newPeriod')}
              </Button>
            </div>
            <p className="text-sm text-muted-foreground text-center font-mono tabular-nums">
              {formatDate(periodStart)} — {formatDate(periodEnd)}
            </p>
          </div>
        </SheetContent>
      </Sheet>

      <NewPeriodDialog open={periodDialogOpen} onOpenChange={setPeriodDialogOpen} />
    </>
  );
}

interface TopBarProps {
  onMenuClick?: () => void;
  isScrolled?: boolean;
}

export function TopBar({ onMenuClick, isScrolled = false }: TopBarProps) {
  return (
    <header className={cn(
      "h-14 flex items-center gap-3 px-4 lg:px-6 shrink-0 transition-all duration-300 ease-out border-b",
      isScrolled
        ? "bg-[var(--qv-bg)]/80 backdrop-blur-xl border-border shadow-sm supports-not-[backdrop-filter]:bg-[var(--qv-bg)]"
        : "bg-background border-transparent"
    )}>
      {/* Hamburger for small screens (<md) */}
      {onMenuClick && (
        <Button
          variant="ghost"
          size="icon"
          className="md:hidden h-8 w-8 shrink-0 -ml-1"
          onClick={onMenuClick}
          aria-label="Open navigation"
        >
          <Menu className="h-5 w-5" />
        </Button>
      )}
      {/* Mobile logo (no sidebar visible on small screens) */}
      <div className="md:hidden flex items-center mr-1">
        <svg viewBox="0 0 120 120" fill="none" className="h-[18px] w-[18px]">
          <path d="M60 22 Q82 22, 82 44" stroke="var(--qv-text-primary)" strokeWidth="8" fill="none" strokeLinecap="round" />
          <path d="M98 60 Q98 82, 76 82" stroke="var(--qv-text-primary)" strokeWidth="8" fill="none" strokeLinecap="round" />
          <path d="M60 98 Q38 98, 38 76" stroke="var(--qv-text-primary)" strokeWidth="8" fill="none" strokeLinecap="round" />
          <path d="M22 60 Q22 38, 44 38" stroke="var(--qv-text-primary)" strokeWidth="8" fill="none" strokeLinecap="round" />
          <circle cx="60" cy="60" r="8" fill="var(--qv-warning)" />
        </svg>
      </div>

      <PeriodSelector />

      <div className="ml-auto flex items-center gap-1">
        <div className="hidden md:block">
          <LanguageSwitcher />
        </div>
        <ToggleGroup />
      </div>
    </header>
  );
}
