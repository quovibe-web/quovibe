import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useCreateReportingPeriod } from '@/api/use-reporting-periods';
import { useReportingPeriod } from '@/api/use-performance';
import { resolveReportingPeriod, getAllCalendarInfos } from '@quovibe/shared';
import type { ReportingPeriodDef } from '@quovibe/shared';
import { formatDate } from '@/lib/formatters';
import { cn } from '@/lib/utils';

type MainType = 'lastYearsMonths' | 'lastDays' | 'lastTradingDays' | 'fromTo' | 'since' | 'year';
type CurrentType = 'currentWeek' | 'currentMonth' | 'currentQuarter' | 'currentYTD';
type PreviousType = 'previousDay' | 'previousTradingDay' | 'previousWeek' | 'previousMonth' | 'previousQuarter' | 'previousYear';
type PeriodCategory = 'main' | 'current' | 'previous';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function NewPeriodDialog({ open, onOpenChange }: Props) {
  const { t } = useTranslation('settings');
  const { mutate: createPeriod, isPending } = useCreateReportingPeriod();
  const { setPeriod } = useReportingPeriod();

  // Selection state
  const [category, setCategory] = useState<PeriodCategory>('main');
  const [mainType, setMainType] = useState<MainType>('lastYearsMonths');
  const [currentType, setCurrentType] = useState<CurrentType>('currentYTD');
  const [previousType, setPreviousType] = useState<PreviousType>('previousMonth');

  // Input values for main types
  const [years, setYears] = useState(1);
  const [months, setMonths] = useState(0);
  const [days, setDays] = useState(30);
  const [tradingDays, setTradingDays] = useState(256);
  const [tradingCalendar, setTradingCalendar] = useState('default');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [sinceDate, setSinceDate] = useState('');
  const [yearValue, setYearValue] = useState(new Date().getFullYear());

  function resetForm() {
    setCategory('main');
    setMainType('lastYearsMonths');
    setCurrentType('currentYTD');
    setPreviousType('previousMonth');
    setYears(1);
    setMonths(0);
    setDays(30);
    setTradingDays(256);
    setTradingCalendar('default');
    setFromDate('');
    setToDate('');
    setSinceDate('');
    setYearValue(new Date().getFullYear());
  }

  // Build the period definition from current state
  const periodDef: ReportingPeriodDef | null = useMemo(() => {
    if (category === 'current') return { type: currentType };
    if (category === 'previous') return { type: previousType };

    switch (mainType) {
      case 'lastYearsMonths':
        return { type: 'lastYearsMonths', years, months };
      case 'lastDays':
        return { type: 'lastDays', days };
      case 'lastTradingDays':
        return { type: 'lastTradingDays', days: tradingDays, calendarId: tradingCalendar };
      case 'fromTo':
        if (!fromDate || !toDate) return null;
        return { type: 'fromTo', from: fromDate, to: toDate };
      case 'since':
        if (!sinceDate) return null;
        return { type: 'since', date: sinceDate };
      case 'year':
        return { type: 'year', year: yearValue };
    }
  }, [category, mainType, currentType, previousType, years, months, days, tradingDays, tradingCalendar, fromDate, toDate, sinceDate, yearValue]);

  // Resolve the period for live preview
  const resolved = useMemo(() => {
    if (!periodDef) return null;
    try {
      return resolveReportingPeriod(periodDef);
    } catch {
      return null;
    }
  }, [periodDef]);

  function handleCreate() {
    if (!periodDef || !resolved) return;
    createPeriod(periodDef, {
      onSuccess: () => {
        // Auto-select the new period
        setPeriod(resolved.periodStart, resolved.periodEnd);
        onOpenChange(false);
        resetForm();
      },
    });
  }

  function selectCategory(cat: PeriodCategory) {
    setCategory(cat);
  }

  const currentChips: { type: CurrentType; labelKey: string }[] = [
    { type: 'currentWeek', labelKey: 'periods.dialog.week' },
    { type: 'currentMonth', labelKey: 'periods.dialog.month' },
    { type: 'currentQuarter', labelKey: 'periods.dialog.quarter' },
    { type: 'currentYTD', labelKey: 'periods.dialog.yearToDate' },
  ];

  const previousChips: { type: PreviousType; labelKey: string }[] = [
    { type: 'previousDay', labelKey: 'periods.dialog.day' },
    { type: 'previousTradingDay', labelKey: 'periods.dialog.tradingDay' },
    { type: 'previousWeek', labelKey: 'periods.dialog.week' },
    { type: 'previousMonth', labelKey: 'periods.dialog.month' },
    { type: 'previousQuarter', labelKey: 'periods.dialog.quarter' },
    { type: 'previousYear', labelKey: 'periods.dialog.year' },
  ];

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) resetForm(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('periods.dialog.title')}</DialogTitle>
          <DialogDescription className="sr-only">
            {t('periods.dialog.description')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {/* Main period types — radio group */}
          <RadioGroup
            value={category === 'main' ? mainType : ''}
            onValueChange={(val) => {
              selectCategory('main');
              setMainType(val as MainType);
            }}
            className="space-y-3"
          >
            {/* Last X years Y months */}
            <div className="flex items-center gap-2">
              <RadioGroupItem value="lastYearsMonths" id="lastYearsMonths" />
              <Label htmlFor="lastYearsMonths" className="text-sm cursor-pointer">
                {t('periods.dialog.lastYearsMonths')}
              </Label>
            </div>
            {category === 'main' && mainType === 'lastYearsMonths' && (
              <div className="ml-6 flex items-center gap-2">
                <Input
                  type="number"
                  min={0}
                  max={99}
                  value={years}
                  onChange={(e) => setYears(Math.min(99, Math.max(0, parseInt(e.target.value, 10) || 0)))}
                  className="w-16 text-center"
                />
                <span className="text-xs text-muted-foreground">{t('periods.dialog.years')}</span>
                <Input
                  type="number"
                  min={0}
                  max={11}
                  value={months}
                  onChange={(e) => setMonths(Math.min(11, Math.max(0, parseInt(e.target.value, 10) || 0)))}
                  className="w-16 text-center"
                />
                <span className="text-xs text-muted-foreground">{t('periods.dialog.months')}</span>
              </div>
            )}

            {/* Last X days */}
            <div className="flex items-center gap-2">
              <RadioGroupItem value="lastDays" id="lastDays" />
              <Label htmlFor="lastDays" className="text-sm cursor-pointer">
                {t('periods.dialog.lastDays')}
              </Label>
            </div>
            {category === 'main' && mainType === 'lastDays' && (
              <div className="ml-6 flex items-center gap-2">
                <Input
                  type="number"
                  min={1}
                  max={9999}
                  value={days}
                  onChange={(e) => setDays(Math.min(9999, Math.max(1, parseInt(e.target.value, 10) || 1)))}
                  className="w-20 text-center"
                />
                <span className="text-xs text-muted-foreground">{t('periods.dialog.days')}</span>
              </div>
            )}

            {/* Last X trading days */}
            <div className="flex items-center gap-2">
              <RadioGroupItem value="lastTradingDays" id="lastTradingDays" />
              <Label htmlFor="lastTradingDays" className="text-sm cursor-pointer">
                {t('periods.dialog.lastTradingDays')}
              </Label>
            </div>
            {category === 'main' && mainType === 'lastTradingDays' && (
              <div className="ml-6 flex items-center gap-2">
                <Input
                  type="number"
                  min={1}
                  max={9999}
                  value={tradingDays}
                  onChange={(e) => setTradingDays(Math.min(9999, Math.max(1, parseInt(e.target.value, 10) || 1)))}
                  className="w-20 text-center"
                />
                <span className="text-xs text-muted-foreground">{t('periods.dialog.days')}</span>
                <Select value={tradingCalendar} onValueChange={setTradingCalendar}>
                  <SelectTrigger className="w-36">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {getAllCalendarInfos().map((cal) => (
                      <SelectItem key={cal.id} value={cal.id}>{cal.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* From (excl.) to */}
            <div className="flex items-center gap-2">
              <RadioGroupItem value="fromTo" id="fromTo" />
              <Label htmlFor="fromTo" className="text-sm cursor-pointer">
                {t('periods.dialog.fromTo')}
              </Label>
            </div>
            {category === 'main' && mainType === 'fromTo' && (
              <div className="ml-6 flex items-center gap-2">
                <Input
                  type="date"
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                  className="w-40"
                />
                <span className="text-xs text-muted-foreground">—</span>
                <Input
                  type="date"
                  value={toDate}
                  onChange={(e) => setToDate(e.target.value)}
                  className="w-40"
                />
              </div>
            )}

            {/* Since (excl.) */}
            <div className="flex items-center gap-2">
              <RadioGroupItem value="since" id="since" />
              <Label htmlFor="since" className="text-sm cursor-pointer">
                {t('periods.dialog.since')}
              </Label>
            </div>
            {category === 'main' && mainType === 'since' && (
              <div className="ml-6">
                <Input
                  type="date"
                  value={sinceDate}
                  onChange={(e) => setSinceDate(e.target.value)}
                  className="w-40"
                />
              </div>
            )}

            {/* Year */}
            <div className="flex items-center gap-2">
              <RadioGroupItem value="year" id="year" />
              <Label htmlFor="year" className="text-sm cursor-pointer">
                {t('periods.dialog.year')}
              </Label>
            </div>
            {category === 'main' && mainType === 'year' && (
              <div className="ml-6">
                <Input
                  type="number"
                  min={1900}
                  max={2100}
                  value={yearValue}
                  onChange={(e) => setYearValue(Math.min(2100, Math.max(1900, parseInt(e.target.value, 10) || 2025)))}
                  className="w-24 text-center"
                />
              </div>
            )}
          </RadioGroup>

          {/* Current section */}
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
              {t('periods.dialog.currentSection')}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {currentChips.map((chip) => (
                <button
                  key={chip.type}
                  className={cn(
                    'px-3 py-1.5 text-xs font-medium rounded-md border transition-colors',
                    category === 'current' && currentType === chip.type
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-background border-border hover:bg-muted'
                  )}
                  onClick={() => {
                    selectCategory('current');
                    setCurrentType(chip.type);
                  }}
                >
                  {t(chip.labelKey)}
                </button>
              ))}
            </div>
          </div>

          {/* Previous section */}
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
              {t('periods.dialog.previousSection')}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {previousChips.map((chip) => (
                <button
                  key={chip.type}
                  className={cn(
                    'px-3 py-1.5 text-xs font-medium rounded-md border transition-colors',
                    category === 'previous' && previousType === chip.type
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-background border-border hover:bg-muted'
                  )}
                  onClick={() => {
                    selectCategory('previous');
                    setPreviousType(chip.type);
                  }}
                >
                  {t(chip.labelKey)}
                </button>
              ))}
            </div>
          </div>

          {/* Live preview */}
          {resolved && (
            <div className="rounded-md bg-muted/50 px-3 py-2">
              <p className="text-xs text-muted-foreground mb-0.5">{t('periods.dialog.preview')}</p>
              <p className="text-sm font-mono tabular-nums">
                {formatDate(resolved.periodStart)} — {formatDate(resolved.periodEnd)}
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => { onOpenChange(false); resetForm(); }}>
            {t('periods.dialog.cancel')}
          </Button>
          <Button
            onClick={handleCreate}
            disabled={!periodDef || !resolved || isPending}
          >
            {t('periods.dialog.create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
