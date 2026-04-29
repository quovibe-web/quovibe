import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { TransactionType, AccountType, getAvailableTransactionTypes } from '@/lib/enums';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { TransactionForm, type TransactionFormValues } from '@/components/domain/TransactionForm';
import { useCreateTransaction } from '@/api/use-transactions';
import { useGuardedSubmit } from '@/hooks/use-guarded-submit';
import { usePortfolio } from '@/context/PortfolioContext';
import { preparePayload } from '@/lib/transaction-payload';
import { txTypeKey } from '@/lib/utils';

function mapDbTypeToAccountType(dbType: string | null): AccountType | null {
  if (dbType === 'portfolio') return AccountType.SECURITIES;
  if (dbType === 'account') return AccountType.DEPOSIT;
  return null;
}

export default function TransactionNew() {
  const navigate = useNavigate();
  const portfolio = usePortfolio();
  const { t } = useTranslation('transactions');
  const { t: tCommon } = useTranslation('common');
  const [searchParams] = useSearchParams();

  const preAccountId = searchParams.get('accountId') ?? undefined;
  const preAccountDbType = searchParams.get('accountType');
  const preType = searchParams.get('type') as TransactionType | null;

  const accountType = mapDbTypeToAccountType(preAccountDbType);
  const availableTypes = accountType
    ? getAvailableTransactionTypes(accountType)
    : Object.values(TransactionType);

  const initialType =
    preType && availableTypes.includes(preType) ? preType : availableTypes[0];

  const [type, setType] = useState<TransactionType>(initialType);
  const { mutateAsync, isPending, error } = useCreateTransaction();

  const { run: handleSubmit, inFlight } = useGuardedSubmit(
    async (values: TransactionFormValues) => {
      try {
        await mutateAsync(preparePayload(values));
        toast.success(tCommon('toasts.transactionCreated'));
        navigate(`/p/${portfolio.id}/transactions`);
      } catch {
        // Global MutationCache error toast handles the user-visible message
        // (see packages/web/src/api/query-client.ts). The catch swallows so
        // the run promise resolves cleanly; React's onClick fire-and-forget
        // therefore produces no unhandledrejection log.
      }
    },
  );

  return (
    <div className="qv-page space-y-6 max-w-lg mx-auto">
      <h1 className="text-lg font-semibold text-foreground tracking-tight">{t('newTransaction')}</h1>

      <div className="space-y-1">
        <Label htmlFor="tx-new-type">{t('transactionType')}</Label>
        <Select value={type} onValueChange={(v) => setType(v as TransactionType)}>
          <SelectTrigger id="tx-new-type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {availableTypes.map((tp) => (
              <SelectItem key={tp} value={tp}>{t('types.' + txTypeKey(tp))}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('types.' + txTypeKey(type))}</CardTitle>
        </CardHeader>
        <CardContent>
          <TransactionForm
            key={type}
            type={type}
            onSubmit={handleSubmit}
            isSubmitting={inFlight || isPending}
            preselectedAccountId={preAccountId}
            serverError={error}
          />
        </CardContent>
      </Card>
    </div>
  );
}
