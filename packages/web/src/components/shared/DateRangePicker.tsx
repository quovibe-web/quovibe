import { useState, useRef } from 'react';
import { format, parse, isValid } from 'date-fns';
import { CalendarIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { getDateLocale } from '@/lib/formatters';

export interface DateRange {
  from: Date | undefined;
  to: Date | undefined;
}

interface DateRangePickerProps {
  value?: DateRange;
  onChange?: (range: DateRange) => void;
}

function formatDateText(date: Date | undefined): string {
  return date ? format(date, 'P', { locale: getDateLocale() }) : '';
}

export function DateRangePicker({ value, onChange }: DateRangePickerProps) {
  const { t } = useTranslation('common');
  const [open, setOpen] = useState(false);
  const [range, setRange] = useState<DateRange>(value ?? { from: undefined, to: undefined });
  const [fromText, setFromText] = useState(() => formatDateText(value?.from));
  const [toText, setToText] = useState(() => formatDateText(value?.to));
  const fromRef = useRef<HTMLInputElement>(null);
  const toRef = useRef<HTMLInputElement>(null);

  function handleSelect(date: Date | undefined, which: 'from' | 'to') {
    const next = { ...range, [which]: date };
    setRange(next);
    if (which === 'from') setFromText(formatDateText(date));
    else setToText(formatDateText(date));
    if (next.from && next.to) {
      onChange?.(next);
      setOpen(false);
    }
  }

  function handleTextChange(text: string, which: 'from' | 'to') {
    if (which === 'from') setFromText(text);
    else setToText(text);
    const locale = getDateLocale();
    const parsed = parse(text, 'P', new Date(), { locale });
    if (isValid(parsed) && parsed.getFullYear() >= 1900 && parsed.getFullYear() <= 2100) {
      const next = { ...range, [which]: parsed };
      setRange(next);
      if (next.from && next.to) {
        onChange?.(next);
      }
    }
  }

  function handleBlur(which: 'from' | 'to') {
    if (which === 'from') setFromText(formatDateText(range.from));
    else setToText(formatDateText(range.to));
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div className="flex items-center gap-1">
        <Input
          ref={fromRef}
          value={fromText}
          onChange={(e) => handleTextChange(e.target.value, 'from')}
          onBlur={() => handleBlur('from')}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleBlur('from'); fromRef.current?.blur(); } }}
          placeholder={t('from')}
          className="w-28 h-8 text-sm"
        />
        <span className="text-muted-foreground text-sm">—</span>
        <Input
          ref={toRef}
          value={toText}
          onChange={(e) => handleTextChange(e.target.value, 'to')}
          onBlur={() => handleBlur('to')}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleBlur('to'); toRef.current?.blur(); } }}
          placeholder={t('to')}
          className="w-28 h-8 text-sm"
        />
        <PopoverTrigger asChild>
          <Button variant="outline" size="icon" className="h-8 w-8 shrink-0">
            <CalendarIcon className="h-4 w-4" />
          </Button>
        </PopoverTrigger>
      </div>
      <PopoverContent className="w-auto p-0" align="start">
        <div className="flex gap-2 p-3">
          <div>
            <p className="text-xs text-muted-foreground mb-1">{t('from')}</p>
            <Calendar mode="single" selected={range.from} onSelect={(d) => handleSelect(d, 'from')} initialFocus />
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1">{t('to')}</p>
            <Calendar mode="single" selected={range.to} onSelect={(d) => handleSelect(d, 'to')} />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
