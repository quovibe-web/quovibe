import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle } from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardContent } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { DataTable } from '@/components/shared/DataTable';
import { formatDate, formatNumber } from '@/lib/formatters';
import type { SplitPreviewQuote } from '@/api/use-stock-split';

interface SplitQuotesStepProps {
  quotes: SplitPreviewQuote[];
  transactionCount: number;
  changeHistoricalQuotes: boolean;
  onToggle: (value: boolean) => void;
  onBack: () => void;
  onApply: () => void;
  isApplying: boolean;
}

function formatQuote(scaled: number): string {
  return formatNumber(scaled / 1e8, { minimumFractionDigits: 2, maximumFractionDigits: 8 });
}

export function SplitQuotesStep({
  quotes,
  transactionCount,
  changeHistoricalQuotes,
  onToggle,
  onBack,
  onApply,
  isApplying,
}: SplitQuotesStepProps) {
  const { t } = useTranslation('securities');

  const columns = useMemo<ColumnDef<SplitPreviewQuote>[]>(
    () => [
      {
        accessorKey: 'date',
        header: () => t('split.columns.date'),
        size: 140,
        cell: ({ row }) => formatDate(row.original.date),
      },
      {
        accessorKey: 'valueOld',
        header: () => t('split.columns.quoteBefore'),
        size: 160,
        cell: ({ row }) => (
          <span className="qv-numeric block truncate">{formatQuote(row.original.valueOld)}</span>
        ),
      },
      {
        accessorKey: 'valueNew',
        header: () => t('split.columns.quoteAfter'),
        size: 160,
        cell: ({ row }) => (
          <span className="qv-numeric font-medium block truncate">
            {formatQuote(row.original.valueNew)}
          </span>
        ),
      },
    ],
    [t],
  );

  const affectedTransactions = transactionCount;
  const affectedQuotes = changeHistoricalQuotes ? quotes.length : 0;

  return (
    <Card>
      <CardContent className="pt-6 space-y-6">
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={changeHistoricalQuotes}
            onCheckedChange={(v) => onToggle(v === true)}
            aria-label={t('split.convertQuotes')}
          />
          {t('split.convertQuotes')}
        </label>

        {quotes.length === 0 ? (
          <p className="text-sm text-[var(--qv-text-secondary)]">{t('split.noQuotes')}</p>
        ) : (
          <DataTable columns={columns} data={quotes} pagination pageSize={25} />
        )}

        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            {t('split.destructiveWarning', {
              transactions: affectedTransactions,
              quotes: affectedQuotes,
            })}
          </AlertDescription>
        </Alert>

        <div className="flex justify-between">
          <Button variant="outline" onClick={onBack} disabled={isApplying}>
            {t('common:back')}
          </Button>
          <Button onClick={onApply} disabled={isApplying}>
            {isApplying ? t('split.applying') : t('split.apply')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
