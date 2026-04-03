import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useWatchlists } from '@/api/use-watchlists';
import { usePrivacy } from '@/context/privacy-context';
import { useWidgetConfig } from '@/context/widget-config-context';
import { CurrencyDisplay } from '@/components/shared/CurrencyDisplay';
import { cn } from '@/lib/utils';

export default function WidgetWatchlist() {
  const { t } = useTranslation('watchlists');
  const { isPrivate } = usePrivacy();
  const navigate = useNavigate();
  const { options } = useWidgetConfig();
  const { data: watchlists } = useWatchlists();

  const watchlistId = options.watchlistId as number | undefined;
  const watchlist = watchlists?.find((wl) => wl.id === watchlistId);

  if (!watchlistId) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
        {t('widget.selectWatchlist')}
      </div>
    );
  }

  if (!watchlist) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
        {t('widget.notFound')}
      </div>
    );
  }

  if (watchlist.securities.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
        {t('empty.noSecurities')}
      </div>
    );
  }

  return (
    <div className="overflow-auto max-h-[300px]" style={{ filter: isPrivate ? 'blur(8px) saturate(0)' : 'none' }}>
      <div className="space-y-0">
        {watchlist.securities.map((sec) => {
          const price = sec.latestPrice ?? sec.previousClose;
          const change = sec.latestPrice != null && sec.previousClose != null && sec.previousClose !== 0
            ? ((sec.latestPrice - sec.previousClose) / sec.previousClose) * 100 // native-ok
            : null;
          return (
            <div
              key={sec.id}
              className="flex items-center justify-between p-2 border-b last:border-b-0 cursor-pointer hover:bg-muted/50"
              onClick={() => navigate(`/investments/${sec.id}`)}
            >
              <div className="min-w-0">
                <div className="text-xs font-medium truncate">{sec.name}</div>
                <div className="text-[10px] text-muted-foreground">{sec.ticker}</div>
              </div>
              <div className="text-right shrink-0 ml-2">
                <div className="text-xs tabular-nums">
                  {price != null ? (
                    <CurrencyDisplay value={price} currency={sec.currency} />
                  ) : '\u2014'}
                </div>
                <div className={cn('text-[10px] tabular-nums', change != null && change >= 0 ? 'text-[var(--qv-positive)]' : 'text-[var(--qv-negative)]')}>
                  {change != null ? `${change >= 0 ? '+' : ''}${change.toFixed(2)}%` : '\u2014'}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
