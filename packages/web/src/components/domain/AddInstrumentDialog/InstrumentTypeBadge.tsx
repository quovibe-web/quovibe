import { useTranslation } from 'react-i18next';
import { InstrumentType } from '@quovibe/shared';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

const TYPE_STYLES: Record<InstrumentType, string> = {
  [InstrumentType.EQUITY]: 'bg-[hsl(220,28%,52%)]/15 text-[hsl(220,28%,42%)] border-[hsl(220,28%,52%)]/30 dark:text-[hsl(220,28%,72%)] dark:bg-[hsl(220,28%,52%)]/15 dark:border-[hsl(220,28%,52%)]/30',
  [InstrumentType.ETF]: 'bg-[hsl(175,25%,48%)]/15 text-[hsl(175,25%,38%)] border-[hsl(175,25%,48%)]/30 dark:text-[hsl(175,25%,68%)] dark:bg-[hsl(175,25%,48%)]/15 dark:border-[hsl(175,25%,48%)]/30',
  [InstrumentType.BOND]: 'bg-[hsl(35,30%,52%)]/15 text-[hsl(35,30%,42%)] border-[hsl(35,30%,52%)]/30 dark:text-[hsl(35,30%,72%)] dark:bg-[hsl(35,30%,52%)]/15 dark:border-[hsl(35,30%,52%)]/30',
  [InstrumentType.CRYPTO]: 'bg-[hsl(245,25%,56%)]/15 text-[hsl(245,25%,46%)] border-[hsl(245,25%,56%)]/30 dark:text-[hsl(245,25%,76%)] dark:bg-[hsl(245,25%,56%)]/15 dark:border-[hsl(245,25%,56%)]/30',
  [InstrumentType.COMMODITY]: 'bg-[hsl(25,30%,52%)]/15 text-[hsl(25,30%,42%)] border-[hsl(25,30%,52%)]/30 dark:text-[hsl(25,30%,72%)] dark:bg-[hsl(25,30%,52%)]/15 dark:border-[hsl(25,30%,52%)]/30',
  [InstrumentType.FUND]: 'bg-[hsl(155,22%,48%)]/15 text-[hsl(155,22%,38%)] border-[hsl(155,22%,48%)]/30 dark:text-[hsl(155,22%,68%)] dark:bg-[hsl(155,22%,48%)]/15 dark:border-[hsl(155,22%,48%)]/30',
  [InstrumentType.INDEX]: 'bg-[hsl(195,28%,48%)]/15 text-[hsl(195,28%,38%)] border-[hsl(195,28%,48%)]/30 dark:text-[hsl(195,28%,68%)] dark:bg-[hsl(195,28%,48%)]/15 dark:border-[hsl(195,28%,48%)]/30',
  [InstrumentType.CURRENCY]: 'bg-muted text-muted-foreground border-border',
  [InstrumentType.UNKNOWN]: 'bg-muted text-muted-foreground border-border',
};

const TYPE_I18N_KEYS: Record<InstrumentType, string> = {
  [InstrumentType.EQUITY]: 'addInstrument.filterEquity',
  [InstrumentType.ETF]: 'addInstrument.filterEtf',
  [InstrumentType.BOND]: 'addInstrument.filterBond',
  [InstrumentType.CRYPTO]: 'addInstrument.filterCrypto',
  [InstrumentType.COMMODITY]: 'addInstrument.filterCommodity',
  [InstrumentType.FUND]: 'addInstrument.filterFund',
  [InstrumentType.INDEX]: 'addInstrument.filterIndex',
  [InstrumentType.CURRENCY]: 'addInstrument.filterCurrency',
  [InstrumentType.UNKNOWN]: 'addInstrument.filterUnknown',
};

interface InstrumentTypeBadgeProps {
  type: InstrumentType;
  className?: string;
}

export function InstrumentTypeBadge({ type, className }: InstrumentTypeBadgeProps) {
  const { t } = useTranslation('securities');

  return (
    <Badge
      variant="outline"
      className={cn(
        'text-[10px] font-semibold px-1.5 py-0 h-5 border',
        TYPE_STYLES[type] ?? TYPE_STYLES[InstrumentType.UNKNOWN],
        className,
      )}
    >
      {t(TYPE_I18N_KEYS[type] ?? TYPE_I18N_KEYS[InstrumentType.UNKNOWN])}
    </Badge>
  );
}
