import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import { Coins, Percent } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { CurrencyDisplay } from '@/components/shared/CurrencyDisplay';
import { formatDate } from '@/lib/formatters';
import { txTypeKey } from '@/lib/utils';
import type { Payment } from '@/api/types';

interface IncomePaymentRowProps {
  payment: Payment;
  amountMode: 'gross' | 'net';
}

const SHORT_DATE_FMT = new Intl.DateTimeFormat(undefined, {
  day: '2-digit',
  month: 'short',
});

function formatShortDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return SHORT_DATE_FMT.format(d);
}

export function IncomePaymentRow({ payment, amountMode }: IncomePaymentRowProps) {
  const { t } = useTranslation('transactions');
  const { portfolioId } = useParams<{ portfolioId: string }>();

  const amount = parseFloat(
    amountMode === 'gross' ? payment.grossAmount : payment.netAmount,
  );

  const securityCell = payment.securityId && payment.securityName ? (
    <Link
      to={`/p/${portfolioId}/securities/${payment.securityId}`}
      className="truncate hover:underline underline-offset-4"
      title={payment.securityName}
    >
      {payment.securityName}
    </Link>
  ) : (
    <span className="text-[var(--qv-text-faint)]">—</span>
  );

  const accountCell = payment.accountId && payment.accountName ? (
    <Link
      to={`/p/${portfolioId}/accounts/${payment.accountId}`}
      className="truncate text-[var(--qv-text-secondary)] hover:underline underline-offset-4"
      title={payment.accountName}
    >
      {payment.accountName}
    </Link>
  ) : (
    <span className="text-[var(--qv-text-faint)]">—</span>
  );

  return (
    <div
      className="grid grid-cols-[80px_120px_minmax(0,1fr)_140px_120px] gap-3 px-4 py-2 border-b border-[var(--qv-border-subtle)] last:border-0 hover:bg-[var(--qv-surface-3)] text-sm"
    >
      <div
        className="qv-numeric text-[var(--qv-text-secondary)]"
        title={formatDate(payment.date)}
      >
        {formatShortDate(payment.date)}
      </div>
      <div>
        <Badge variant="outline" className="rounded-sm gap-1">
          {payment.type === 'DIVIDEND' ? (
            <Coins className="h-3 w-3" />
          ) : (
            <Percent className="h-3 w-3" />
          )}
          {t(`types.${txTypeKey(payment.type)}`)}
        </Badge>
      </div>
      <div className="min-w-0">{securityCell}</div>
      <div className="min-w-0">{accountCell}</div>
      <div className="text-right">
        <CurrencyDisplay
          value={amount}
          currency={payment.currencyCode ?? undefined}
          className="qv-numeric font-medium"
          animated={false}
        />
      </div>
    </div>
  );
}
