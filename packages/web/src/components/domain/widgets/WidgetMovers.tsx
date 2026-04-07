import { useTranslation } from 'react-i18next';
import { useMovers } from '@/api/use-movers';
import { usePrivacy } from '@/context/privacy-context';
import { useWidgetKpiMeta } from '@/hooks/use-widget-kpi-meta';
import { formatPercentage } from '@/lib/formatters';
import { getColor } from '@/lib/colors';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { FadeIn } from '@/components/shared/FadeIn';
import { Sparkline } from '@/components/shared/Sparkline';
import type { MoverEntry } from '@/api/types';

function MoverRow({
  entry,
  color,
  isPrivate,
}: {
  entry: MoverEntry;
  color: string;
  isPrivate: boolean;
}) {
  const ttwror = parseFloat(entry.ttwror);

  return (
    <div className="flex items-center gap-2 h-[38px]">
      <div className="flex-1 min-w-0 text-sm text-foreground truncate" title={entry.name}>
        {entry.name}
      </div>
      <div
        className="w-[72px] shrink-0"
        style={{
          filter: isPrivate ? 'blur(8px) saturate(0)' : 'none',
          transition: 'filter 0.2s ease',
        }}
      >
        <Sparkline
          data={entry.sparkline.map((d) => parseFloat(d.cumR))}
          width={72}
          height={32}
          color={color}
          fillOpacity={0.15}
        />
      </div>
      <div
        className="w-[70px] shrink-0 text-right text-sm font-semibold tabular-nums"
        style={{ color }}
      >
        {isPrivate ? '••••' : formatPercentage(ttwror)}
      </div>
    </div>
  );
}

export default function WidgetMovers() {
  const { t } = useTranslation('dashboard');
  const { data, isLoading, isError, error, isFetching } = useMovers();
  const { isPrivate } = usePrivacy();
  const { periodLabel } = useWidgetKpiMeta(null);

  const positiveColor = getColor('profit');
  const negativeColor = getColor('loss');

  if (isLoading) {
    return (
      <div className="flex flex-col gap-2 p-2">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-[38px] w-full" />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{error?.message ?? 'Error'}</AlertDescription>
      </Alert>
    );
  }

  if (!data || (data.top.length === 0 && data.bottom.length === 0)) {
    return (
      <div className="flex items-center justify-center h-full min-h-[200px] text-sm text-muted-foreground">
        {t('widget.movers.noSecurities')}
      </div>
    );
  }

  return (
    <FadeIn>
      <div
        className={cn(
          'flex flex-col px-1',
          isFetching && !isLoading && 'opacity-60 transition-opacity duration-200',
        )}
      >
        {data.top.length > 0 && (
          <>
            <div className="text-[10px] uppercase tracking-wider font-semibold mb-1" style={{ color: positiveColor }}>
              {t('widget.movers.topPerformers')}
            </div>
            <div className="flex flex-col">
              {data.top.map((entry) => (
                <MoverRow key={entry.securityId} entry={entry} color={positiveColor} isPrivate={isPrivate} />
              ))}
            </div>
          </>
        )}

        {data.top.length > 0 && data.bottom.length > 0 && (
          <div className="border-t border-border my-2" />
        )}

        {data.bottom.length > 0 && (
          <>
            <div className="text-[10px] uppercase tracking-wider font-semibold mb-1" style={{ color: negativeColor }}>
              {t('widget.movers.bottomPerformers')}
            </div>
            <div className="flex flex-col">
              {data.bottom.map((entry) => (
                <MoverRow key={entry.securityId} entry={entry} color={negativeColor} isPrivate={isPrivate} />
              ))}
            </div>
          </>
        )}

        <span className="text-[10px] text-muted-foreground mt-2 text-center">{periodLabel}</span>
      </div>
    </FadeIn>
  );
}
