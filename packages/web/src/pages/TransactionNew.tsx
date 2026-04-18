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
  const { mutate, isPending } = useCreateTransaction();

  function handleSubmit(values: TransactionFormValues) {
    mutate(preparePayload(values), {
      onSuccess: () => {
        toast.success(tCommon('toasts.transactionCreated'));
        navigate(`/p/${portfolio.id}/transactions`);
      },
      onError: () => {
        toast.error(tCommon('toasts.errorSaving'));
      },
    });
  }

  return (
    <div className="qv-page space-y-6 max-w-lg mx-auto">
      <h1 className="text-lg font-semibold text-foreground tracking-tight">{t('newTransaction')}</h1>

      <div className="space-y-1">
        <Label>{t('transactionType')}</Label>
        <Select value={type} onValueChange={(v) => setType(v as TransactionType)}>
          <SelectTrigger>
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
            isSubmitting={isPending}
            preselectedAccountId={preAccountId}
          />
        </CardContent>
      </Card>
    </div>
  );
}
