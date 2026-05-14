import { useTranslation } from 'react-i18next';
import { CurrencyDisplay } from '@/components/shared/CurrencyDisplay';
import { SignedPercent } from '@/components/shared/SignedPercent';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { formatDate } from '@/lib/formatters';
import { extractHeroTiles, type HeroTile } from '@/lib/calculation-hero';
import { cn } from '@/lib/utils';
import type { CalculationBreakdownResponse } from '@quovibe/shared';

interface CalculationHeroStripProps {
  data: CalculationBreakdownResponse;
}

export function CalculationHeroStrip({ data }: CalculationHeroStripProps) {
  const tiles = extractHeroTiles(data);
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
      {tiles.map((tile) => (
        <HeroTileCard key={tile.id} tile={tile} />
      ))}
    </div>
  );
}

function HeroTileCard({ tile }: { tile: HeroTile }) {
  const { t } = useTranslation('performance');
  return (
    <div
      className={cn(
        'bg-[var(--qv-surface-elevated)] border border-[var(--qv-border-subtle)] rounded-md p-3',
        'flex flex-col gap-1',
      )}
    >
      <div className="qv-eyebrow text-[var(--qv-text-faint)]">
        {t(tile.labelKey)}
      </div>
      <HeroTileValue tile={tile} />
      <HeroTileSubLine tile={tile} />
    </div>
  );
}

function HeroTileValue({ tile }: { tile: HeroTile }) {
  if (tile.value === null) {
    return <span className="qv-numeric text-xl text-muted-foreground">—</span>;
  }
  if (tile.format === 'signedPercent') {
    return <SignedPercent value={tile.value} className="text-xl" />;
  }
  if (tile.format === 'signedCurrency') {
    return (
      <CurrencyDisplay
        value={tile.value}
        colorize
        className="qv-numeric text-xl font-medium"
      />
    );
  }
  // neutralNumber (Sharpe / non-signed magnitudes)
  return (
    <span className="qv-numeric text-xl font-medium text-[var(--qv-text-display)]">
      {tile.value.toFixed(2)}
    </span>
  );
}

function HeroTileSubLine({ tile }: { tile: HeroTile }) {
  const { t } = useTranslation('performance');

  if (tile.id === 'ttwror') {
    return (
      <span className="text-xs text-muted-foreground qv-numeric">
        p.a.{' '}
        {tile.subValue == null ? '—' : (
          <SignedPercent value={tile.subValue} className="text-xs" />
        )}
      </span>
    );
  }
  if (tile.id === 'irr') {
    if (tile.subText) {
      return (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="text-xs text-muted-foreground cursor-help underline decoration-dotted">
              {t('calculation.heroStrip.newtonRaphson')}
            </span>
          </TooltipTrigger>
          <TooltipContent>{tile.subText}</TooltipContent>
        </Tooltip>
      );
    }
    return <span className="text-xs text-muted-foreground">{t('calculation.heroStrip.newtonRaphson')}</span>;
  }
  if (tile.id === 'deltaPercent') {
    return <span className="text-xs text-muted-foreground">{t('calculation.heroStrip.onMvb')}</span>;
  }
  if (tile.id === 'deltaAbsolute') {
    return <span className="text-xs text-muted-foreground">{t('calculation.heroStrip.netResult')}</span>;
  }
  if (tile.id === 'maxDrawdown') {
    if (!tile.peakDate || !tile.troughDate) {
      return <span className="text-xs text-muted-foreground">—</span>;
    }
    return (
      <span className="text-xs text-muted-foreground qv-numeric">
        {formatDate(tile.peakDate)} – {formatDate(tile.troughDate)},{' '}
        {t('calculation.rightRail.days', { count: tile.durationDays ?? 0 })}
      </span>
    );
  }
  if (tile.id === 'sharpe') {
    return <span className="text-xs text-muted-foreground">{t('calculation.heroStrip.riskAdjustedReturn')}</span>;
  }
  return null;
}
