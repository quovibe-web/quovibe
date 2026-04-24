import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAccounts, useCreateAccount, useUpdateAccount } from '@/api/use-accounts';

const NEW_DEPOSIT_SENTINEL = '__new__';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  securitiesAccountId: string;
  currentReferenceAccountId: string;
  currency: string;
}

export function ChangeReferenceAccountDialog({
  open,
  onOpenChange,
  securitiesAccountId,
  currentReferenceAccountId,
  currency,
}: Props) {
  const { t } = useTranslation('accounts');
  const { t: tCommon } = useTranslation('common');
  const { data: accounts = [] } = useAccounts();
  const updateMutation = useUpdateAccount();
  const createMutation = useCreateAccount();

  const [selected, setSelected] = useState(currentReferenceAccountId);
  const [newName, setNewName] = useState('');

  useEffect(() => {
    if (open) {
      setSelected(currentReferenceAccountId);
      setNewName('');
    }
  }, [open, currentReferenceAccountId]);

  // Currency-matched deposits only (safer UX — prevents accidental currency flip,
  // since the server resolves the securities-account currency from its reference).
  const eligibleDeposits = accounts.filter(
    (a) => a.type === 'account' && !a.isRetired && a.currency === currency,
  );
  const isNew = selected === NEW_DEPOSIT_SENTINEL;
  const isSaveDisabled =
    updateMutation.isPending ||
    createMutation.isPending ||
    !selected ||
    (!isNew && selected === currentReferenceAccountId) ||
    (isNew && !newName.trim());

  async function handleSave() {
    let targetId = selected;
    if (isNew) {
      const created = await createMutation.mutateAsync({
        name: newName.trim(),
        type: 'DEPOSIT',
        currency,
      });
      targetId = created.id;
    }
    await updateMutation.mutateAsync({
      id: securitiesAccountId,
      data: { referenceAccountId: targetId },
    });
    toast.success(t('toasts.referenceUpdated'));
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>{t('dialog.changeReferenceAccountTitle')}</DialogTitle>
          <DialogDescription>{t('dialog.changeReferenceAccountDescription', { currency })}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1">
            <Label>{t('dialog.referenceAccount')}</Label>
            <Select value={selected} onValueChange={setSelected}>
              <SelectTrigger>
                <SelectValue placeholder={t('dialog.selectDeposit')} />
              </SelectTrigger>
              <SelectContent>
                {eligibleDeposits.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name} ({a.currency})
                  </SelectItem>
                ))}
                <SelectItem value={NEW_DEPOSIT_SENTINEL}>
                  {t('dialog.createNewDeposit')}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {isNew && (
            <div className="space-y-1 border rounded-md p-3 bg-muted/40">
              <Label>{t('dialog.depositAccountName')}</Label>
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder={t('dialog.depositNamePlaceholder')}
                autoFocus
              />
              <p className="text-xs text-muted-foreground pt-1">
                {t('dialog.newDepositCurrencyNote', { currency })}
              </p>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {tCommon('cancel')}
          </Button>
          <Button onClick={handleSave} disabled={isSaveDisabled}>
            {updateMutation.isPending || createMutation.isPending
              ? tCommon('saving')
              : tCommon('save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
