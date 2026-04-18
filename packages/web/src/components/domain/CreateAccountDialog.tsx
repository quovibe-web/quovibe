import { useState } from 'react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAccounts, useCreateAccount, useUpdateAccountLogo } from '@/api/use-accounts';
import { useResolveLogo } from '@/api/use-logo';
import { CURRENCIES } from '@/lib/currencies';
import { useUnsavedChangesGuard } from '@/hooks/use-unsaved-changes-guard';
import { UnsavedChangesAlert } from '@/components/shared/UnsavedChangesAlert';

const NEW_DEPOSIT_SENTINEL = '__new__';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateAccountDialog({ open, onOpenChange }: Props) {
  const { t } = useTranslation('accounts');
  const { t: tCommon } = useTranslation('common');
  const { data: accounts = [] } = useAccounts();
  const createMutation = useCreateAccount();
  const resolveLogoMutation = useResolveLogo();
  const logoMutation = useUpdateAccountLogo();

  const [name, setName] = useState('');
  const [website, setWebsite] = useState('');
  const [type, setType] = useState<'DEPOSIT' | 'SECURITIES'>('DEPOSIT');
  const [currency, setCurrency] = useState('EUR');
  const [refAccountId, setRefAccountId] = useState('');
  const [isDirty, setIsDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fields for inline "new deposit account" creation
  const [newDepositName, setNewDepositName] = useState('');
  const [newDepositCurrency, setNewDepositCurrency] = useState('EUR');

  const depositAccounts = accounts.filter((a) => a.type === 'account');
  const isNewDeposit = refAccountId === NEW_DEPOSIT_SENTINEL;

  const { guardedOpenChange, showDialog, setShowDialog, discard } =
    useUnsavedChangesGuard(isDirty, (nextOpen) => {
      if (!nextOpen) reset();
      onOpenChange(nextOpen);
    });

  function reset() {
    setName('');
    setType('DEPOSIT');
    setCurrency('EUR');
    setRefAccountId('');
    setNewDepositName('');
    setNewDepositCurrency('EUR');
    setWebsite('');
    setIsDirty(false);
    setError(null);
  }

  function normalizeDomain(raw: string): string {
    return raw.trim().replace(/^https?:\/\//, '').replace(/\/$/, '').split('/')[0];
  }

  async function handleSave() {
    if (!name.trim()) {
      setError(t('transactions:validation.nameRequired'));
      return;
    }
    if (type === 'SECURITIES') {
      if (!refAccountId) {
        setError(t('transactions:validation.selectAccount'));
        return;
      }
      if (isNewDeposit && !newDepositName.trim()) {
        setError(t('transactions:validation.nameRequired'));
        return;
      }
    }

    setError(null);

    try {
      if (type === 'DEPOSIT') {
        const depositAccount = await createMutation.mutateAsync({ name: name.trim(), type: 'DEPOSIT', currency });
        toast.success(t('toasts.depositCreated'));
        const domain = normalizeDomain(website);
        if (domain) {
          void resolveLogoMutation.mutateAsync({ domain })
            .then(({ logoUrl }) => logoMutation.mutate({ id: (depositAccount as { id: string }).id, logoUrl }))
            .catch(() => {/* silent — user can upload manually */});
        }
      } else {
        let resolvedRefId = refAccountId;

        if (isNewDeposit) {
          const deposit = await createMutation.mutateAsync({
            name: newDepositName.trim(),
            type: 'DEPOSIT',
            currency: newDepositCurrency,
          });
          resolvedRefId = (deposit as { id: string }).id;
          const domain = normalizeDomain(website);
          if (domain) {
            void resolveLogoMutation.mutateAsync({ domain })
              .then(({ logoUrl }) => logoMutation.mutate({ id: resolvedRefId, logoUrl }))
              .catch(() => {/* silent */});
          }
        }

        await createMutation.mutateAsync({
          name: name.trim(),
          type: 'SECURITIES',
          // No currency for portfolios — inherited from referenceAccount
          referenceAccountId: resolvedRefId,
        });
        toast.success(t('toasts.securitiesCreated'));
      }
      setIsDirty(false);
      onOpenChange(false);
    } catch (err) {
      setError(
        (err as Error)?.message === 'DUPLICATE_NAME'
          ? t('toasts.duplicateName')
          : t('toasts.errorCreating'),
      );
    }
  }

  return (
    <>
      <Sheet open={open} onOpenChange={guardedOpenChange}>
        <SheetContent
          side="right"
          className="w-full sm:max-w-xl p-0 flex flex-col"
          showCloseButton={true}
        >
          <SheetHeader className="px-6 pt-6 pb-2 shrink-0">
            <SheetTitle>{t('dialog.title')}</SheetTitle>
            <SheetDescription className="sr-only">
              {t('dialog.description')}
            </SheetDescription>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto px-6 min-h-0">
            <div className="space-y-4 py-2">
              {/* Name */}
              <div className="space-y-1">
                <Label>{t('dialog.name')}</Label>
                <Input
                  value={name}
                  onChange={(e) => { setName(e.target.value); setIsDirty(true); }}
                  placeholder={t('dialog.namePlaceholder')}
                />
              </div>

              {/* Type */}
              <div className="space-y-1">
                <Label>{t('dialog.type')}</Label>
                <Select value={type} onValueChange={(v) => { setType(v as 'DEPOSIT' | 'SECURITIES'); setRefAccountId(''); setIsDirty(true); }}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="DEPOSIT">{t('dialog.typeDeposit')}</SelectItem>
                    <SelectItem value="SECURITIES">{t('dialog.typeSecurities')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Currency — only for DEPOSIT accounts; SECURITIES inherit from referenceAccount */}
              {type === 'DEPOSIT' && (
                <div className="space-y-1">
                  <Label>{t('dialog.currency')}</Label>
                  <Select value={currency} onValueChange={(v) => { setCurrency(v); setIsDirty(true); }}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CURRENCIES.map((c) => (
                        <SelectItem key={c.code} value={c.code}>
                          {c.code} — {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Broker website — only for DEPOSIT accounts */}
              {type === 'DEPOSIT' && (
                <div className="grid gap-1.5">
                  <Label htmlFor="website">
                    {t('logo.brokerWebsite')} <span className="text-muted-foreground text-xs">{tCommon('optional')}</span>
                  </Label>
                  <Input
                    id="website"
                    value={website}
                    placeholder={t('logo.brokerWebsitePlaceholder')}
                    onChange={e => { setWebsite(e.target.value); setIsDirty(true); }}
                  />
                </div>
              )}

              {/* Reference Account (Securities only) */}
              {type === 'SECURITIES' && (
                <div className="space-y-1">
                  <Label>{t('dialog.referenceAccount')}</Label>
                  <Select value={refAccountId} onValueChange={(v) => { setRefAccountId(v); setIsDirty(true); }}>
                    <SelectTrigger>
                      <SelectValue placeholder={t('dialog.selectDeposit')} />
                    </SelectTrigger>
                    <SelectContent>
                      {depositAccounts.map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.name} {a.currency ? `(${a.currency})` : ''}
                        </SelectItem>
                      ))}
                      <SelectItem value={NEW_DEPOSIT_SENTINEL}>
                        {t('dialog.createNewDeposit')}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Inline new deposit account fields */}
              {type === 'SECURITIES' && isNewDeposit && (
                <div className="border rounded-md p-3 space-y-3 bg-muted/40">
                  <p className="text-xs text-muted-foreground font-medium">{t('dialog.newDepositAccount')}</p>
                  <div className="space-y-1">
                    <Label>{t('dialog.depositAccountName')}</Label>
                    <Input
                      value={newDepositName}
                      onChange={(e) => { setNewDepositName(e.target.value); setIsDirty(true); }}
                      placeholder={t('dialog.depositNamePlaceholder')}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>{t('dialog.depositCurrency')}</Label>
                    <Select value={newDepositCurrency} onValueChange={(v) => { setNewDepositCurrency(v); setIsDirty(true); }}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {CURRENCIES.map((c) => (
                          <SelectItem key={c.code} value={c.code}>
                            {c.code} — {c.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="website-inline">
                      {t('logo.brokerWebsite')} <span className="text-muted-foreground text-xs">{tCommon('optional')}</span>
                    </Label>
                    <Input
                      id="website-inline"
                      value={website}
                      placeholder={t('logo.brokerWebsitePlaceholder')}
                      onChange={e => { setWebsite(e.target.value); setIsDirty(true); }}
                    />
                  </div>
                </div>
              )}
            </div>
            <div className="h-4" />
          </div>

          {error && (
            <p className="text-sm text-destructive px-6 py-1 shrink-0">{error}</p>
          )}

          <SheetFooter className="border-t px-6 py-3 shrink-0 flex flex-row gap-2">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={() => guardedOpenChange(false)}
            >
              {t('common:cancel')}
            </Button>
            <Button
              type="button"
              className="flex-1"
              onClick={handleSave}
              disabled={createMutation.isPending}
            >
              {createMutation.isPending ? t('common:creating') : t('common:create')}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <UnsavedChangesAlert
        open={showDialog}
        onOpenChange={setShowDialog}
        onDiscard={discard}
      />
    </>
  );
}
