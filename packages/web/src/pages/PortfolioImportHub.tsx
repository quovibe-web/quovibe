import { useParams, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  FileSpreadsheet,
  LineChart,
  FileText,
  FileCode2,
  ChevronRight,
  type LucideIcon,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/shared/PageHeader';
import { useNavTitle } from '@/hooks/useNavTitle';
import { cn } from '@/lib/utils';

// Per-portfolio variant of /import (which handles portfolio CREATION).
// Two surfaces with the same noun; keep them distinct.

export type ImportTileId = 'tradesCsv' | 'pricesCsv' | 'pdf' | 'ibFlex';
export type ImportTileStatus = 'available' | 'viaSecurityDetail' | 'comingSoon';

type EnabledTile = {
  id: ImportTileId;
  icon: LucideIcon;
  status: 'available' | 'viaSecurityDetail';
  href: string;
  hasHint?: true;
};

type DisabledTile = {
  id: ImportTileId;
  icon: LucideIcon;
  status: 'comingSoon';
};

export type ImportTile = EnabledTile | DisabledTile;

const TONE_BY_STATUS: Record<ImportTileStatus, string> = {
  available: 'bg-[var(--qv-success)]/15 text-[var(--qv-success)] border-transparent',
  viaSecurityDetail: 'bg-[var(--qv-info)]/15 text-[var(--qv-info)] border-transparent',
  comingSoon: 'bg-muted text-muted-foreground border-transparent',
};

export function getImportTiles(portfolioId: string): ImportTile[] {
  return [
    {
      id: 'tradesCsv',
      icon: FileSpreadsheet,
      status: 'available',
      href: `/p/${portfolioId}/import/csv`,
    },
    {
      id: 'pricesCsv',
      icon: LineChart,
      status: 'available',
      href: `/p/${portfolioId}/import/prices`,
    },
    { id: 'pdf', icon: FileText, status: 'comingSoon' },
    { id: 'ibFlex', icon: FileCode2, status: 'comingSoon' },
  ];
}

function StatusBadge({ status }: { status: ImportTileStatus }) {
  const { t } = useTranslation('csv-import');
  return (
    <Badge
      variant="outline"
      className={cn('qv-eyebrow text-[10px] uppercase', TONE_BY_STATUS[status])}
    >
      {t(`hub.status.${status}`)}
    </Badge>
  );
}

function ImportTileCard({ tile }: { tile: ImportTile }) {
  const { t } = useTranslation('csv-import');
  const Icon = tile.icon;
  const title = t(`hub.tiles.${tile.id}.title`);
  const description = t(`hub.tiles.${tile.id}.description`);
  const isEnabled = tile.status !== 'comingSoon';
  const hint = isEnabled && tile.hasHint ? t(`hub.tiles.${tile.id}.hint`) : null;

  const body = (
    <div className="flex items-start gap-4">
      <div className="rounded-lg bg-[var(--qv-surface-elevated)] p-2.5 shrink-0">
        <Icon className="h-5 w-5 text-foreground" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="text-base font-medium text-foreground">{title}</h3>
          <StatusBadge status={tile.status} />
        </div>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        {hint && (
          <p className="mt-1.5 text-xs text-[var(--qv-text-faint)]">{hint}</p>
        )}
      </div>
      {isEnabled && (
        <ChevronRight
          className="h-5 w-5 text-muted-foreground shrink-0 self-center"
          aria-hidden
        />
      )}
    </div>
  );

  const baseClass = 'block w-full rounded-xl border bg-[var(--qv-surface)] p-5';

  if (!isEnabled) {
    return (
      <div
        aria-disabled="true"
        className={cn(baseClass, 'border-border opacity-60 cursor-not-allowed')}
      >
        {body}
      </div>
    );
  }

  return (
    <Link to={tile.href} className={cn(baseClass, 'qv-card-interactive')}>
      {body}
    </Link>
  );
}

export default function PortfolioImportHub() {
  const { t } = useTranslation('csv-import');
  useNavTitle('import');
  const { portfolioId } = useParams<{ portfolioId: string }>();
  const tiles = portfolioId ? getImportTiles(portfolioId) : [];

  return (
    <div className="qv-page space-y-6">
      <PageHeader title={t('hub.title')} subtitle={t('hub.subtitle')} />
      <div className="grid gap-3 sm:grid-cols-2">
        {tiles.map((tile) => (
          <ImportTileCard key={tile.id} tile={tile} />
        ))}
      </div>
    </div>
  );
}
