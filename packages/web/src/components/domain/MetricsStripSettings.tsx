import { Settings2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';

const ALL_METRIC_IDS = [
  'ttwror', 'ttwror-pa', 'irr', 'delta',
  'absolute-performance', 'absolute-change',
  'max-drawdown', 'current-drawdown',
  'volatility', 'sharpe-ratio', 'semivariance',
  'cash-drag', 'invested-capital', 'all-time-high', 'distance-from-ath',
] as const;

interface MetricsStripSettingsProps {
  selected: string[];
  onChange: (ids: string[]) => void;
}

export function MetricsStripSettings({ selected, onChange }: MetricsStripSettingsProps) {
  const { t } = useTranslation('dashboard');

  function toggle(id: string) {
    if (selected.includes(id)) {
      onChange(selected.filter((s) => s !== id));
    } else if (selected.length < 4) {
      onChange([...selected, id]);
    }
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 shrink-0 text-muted-foreground hover:text-foreground"
          aria-label={t('hero.configureMetrics')}
        >
          <Settings2 className="h-3.5 w-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56 p-2">
        <div className="text-xs font-medium text-muted-foreground mb-2 px-1">
          {t('hero.selectMetrics')} ({selected.length}/4)
        </div>
        <div className="space-y-1">
          {ALL_METRIC_IDS.map((id) => {
            const checked = selected.includes(id);
            const disabled = !checked && selected.length >= 4;
            return (
              <label
                key={id}
                className="flex items-center gap-2 px-1 py-1 rounded hover:bg-muted cursor-pointer text-sm"
              >
                <Checkbox
                  checked={checked}
                  disabled={disabled}
                  onCheckedChange={() => toggle(id)}
                />
                {t(`widgetTypes.${id}`)}
              </label>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
