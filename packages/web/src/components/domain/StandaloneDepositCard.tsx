import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Landmark, MoreHorizontal } from 'lucide-react';
import { toast } from 'sonner';
import { useNavigate, useLocation } from 'react-router-dom';

import type { AccountListItem } from '@/api/types';
import {
  useDeleteAccount,
  useDeactivateAccount,
  useReactivateAccount,
  useUpdateAccount,
  useUpdateAccountLogo,
} from '@/api/use-accounts';
import { useResolveLogo } from '@/api/use-logo';
import { resizeToPng } from '@/lib/image-utils';
import { CurrencyDisplay } from '@/components/shared/CurrencyDisplay';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface StandaloneDepositCardProps {
  account: AccountListItem;
}

export function StandaloneDepositCard({ account }: StandaloneDepositCardProps) {
  const { t } = useTranslation('accounts');
  const { t: tCommon } = useTranslation('common');
  const navigate = useNavigate();
  const location = useLocation();
  const [renameOpen, setRenameOpen] = useState(false);
  const [showDomainPrompt, setShowDomainPrompt] = useState(false);
  const [domainInput, setDomainInput] = useState('');
  const [isFetchingLogo, setIsFetchingLogo] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const menuActionRef = useRef(false);

  const deleteMutation = useDeleteAccount();
  const deactivateMutation = useDeactivateAccount();
  const reactivateMutation = useReactivateAccount();
  const updateMutation = useUpdateAccount();
  const logoMutation = useUpdateAccountLogo();
  const resolveLogoMutation = useResolveLogo();

  const balance = parseFloat(account.balance);
  const currency = account.currency ?? 'EUR';

  function handleDelete(e: Event) {
    e.stopPropagation();
    if (account.transactionCount > 0) { // native-ok
      toast.error(t('actions.cannotDelete', { count: account.transactionCount }));
      return;
    }
    if (!confirm(t('actions.deleteConfirm', { name: account.name }))) return;
    deleteMutation.mutate(account.id);
  }

  async function handleFetchLogo() {
    const domain = domainInput.trim().replace(/^https?:\/\//, '').replace(/\/$/, '');
    if (!domain) return;
    setIsFetchingLogo(true);
    try {
      const { logoUrl } = await resolveLogoMutation.mutateAsync({ domain });
      logoMutation.mutate({ id: account.id, logoUrl });
      setShowDomainPrompt(false);
      setDomainInput('');
    } catch {
      toast.error(t('logo.fetchFailed'));
    } finally {
      setIsFetchingLogo(false);
    }
  }

  function handleRetire(e: Event) {
    e.stopPropagation();
    if (account.isRetired) {
      reactivateMutation.mutate(account.id);
    } else {
      deactivateMutation.mutate(account.id);
    }
  }

  return (
    <>
      <div
        className={cn(
          'max-w-[720px] bg-card border rounded-lg overflow-hidden cursor-pointer qv-card-interactive',
          account.isRetired && 'border-l-[3px] border-l-[var(--qv-warning)]',
        )}
        onClick={() => {
          if (menuActionRef.current) { menuActionRef.current = false; return; }
          navigate(`/accounts/${account.id}${location.search}`);
        }}
      >
        <div className="flex items-center justify-between px-4 py-4">
          {/* Left side: logo + name + meta */}
          <div className="flex items-center gap-3 min-w-0">
            {account.logoUrl ? (
              <img src={account.logoUrl} alt="" className="h-8 w-8 rounded-md object-contain" />
            ) : (
              <div className="h-8 w-8 rounded-md border border-muted-foreground/60 bg-muted flex items-center justify-center">
                <Landmark className="h-4 w-4 text-muted-foreground" />
              </div>
            )}
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <p className={cn('font-semibold text-sm truncate', account.isRetired && 'text-muted-foreground')}>{account.name}</p>
                {account.isRetired && (
                  <span className="shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-[var(--qv-warning)]/15 text-[var(--qv-warning)]">
                    {tCommon('retired')}
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground truncate">
                {currency}
                {account.transactionCount > 0 && ( // native-ok
                  <> &middot; {account.transactionCount} {t('expanded.transactions')}</>
                )}
              </p>
            </div>
          </div>

          {/* Right side: balance + kebab */}
          <div className="flex items-center gap-2 shrink-0">
            <div className="text-right">
              <CurrencyDisplay
                value={balance}
                currency={currency}
                colorize
                className="text-lg font-semibold tabular-nums text-[var(--qv-positive)]"
              />
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0"
                  onClick={(e) => e.stopPropagation()}
                >
                  <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => { menuActionRef.current = true; setRenameOpen(true); }}>
                  {t('actions.rename')}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => { menuActionRef.current = true; fileInputRef.current?.click(); }}>
                  {t('actions.changeLogo')}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => { menuActionRef.current = true; setShowDomainPrompt(prev => !prev); }}>
                  {t('actions.fetchLogo')}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={(e) => { menuActionRef.current = true; handleRetire(e); }}>
                  {account.isRetired ? t('actions.reactivateAccount') : t('actions.retire')}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={(e) => { menuActionRef.current = true; handleDelete(e); }}>
                  {t('actions.delete')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {showDomainPrompt && (
          <div className="px-4 pb-3 flex items-center gap-2" onClick={e => e.stopPropagation()}>
            <Input
              autoFocus
              value={domainInput}
              placeholder={t('logo.brokerWebsitePlaceholder')}
              className="h-7 text-xs"
              onChange={e => setDomainInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') void handleFetchLogo();
                if (e.key === 'Escape') { setShowDomainPrompt(false); setDomainInput(''); }
              }}
            />
            <Button size="sm" variant="outline" className="h-7 text-xs shrink-0" disabled={isFetchingLogo} onClick={handleFetchLogo}>
              {isFetchingLogo ? t('logo.fetching') : t('logo.fetch')}
            </Button>
          </div>
        )}
      </div>

      {/* Hidden file input for logo upload — outside card to avoid navigation */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          e.target.value = '';
          try {
            const dataUrl = await resizeToPng(file);
            logoMutation.mutate({ id: account.id, logoUrl: dataUrl });
          } catch {
            toast.error(tCommon('toasts.imageTooLarge'));
          }
        }}
      />

      {/* Rename dialog — outside card to avoid navigation */}
      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>{t('rename.titleSingle')}</DialogTitle>
            <DialogDescription className="sr-only">
              {t('rename.description')}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={(e) => {
            e.preventDefault();
            const newName = (new FormData(e.currentTarget).get('name') as string)?.trim();
            if (newName && newName !== account.name) {
              updateMutation.mutate({ id: account.id, data: { name: newName } });
            }
            setRenameOpen(false);
          }}>
            <div className="py-4">
              <Label htmlFor="deposit-rename">{t('dialog.name')}</Label>
              <Input id="deposit-rename" name="name" autoFocus defaultValue={account.name} className="mt-1.5" />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setRenameOpen(false)}>
                {tCommon('cancel')}
              </Button>
              <Button type="submit">{tCommon('ok')}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
