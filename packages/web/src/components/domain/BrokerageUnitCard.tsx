import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Landmark, MoreHorizontal } from 'lucide-react';
import type { CalculationBreakdownResponse } from '@quovibe/shared';
import { toast } from 'sonner';

import type { BrokerageUnit } from '@/api/types';
import { BrokerageUnitExpanded } from '@/components/domain/BrokerageUnitExpanded';
import {
  useDeleteAccount,
  useDeactivateAccount,
  useReactivateAccount,
  useUpdateAccountLogo,
  useUpdateAccount,
} from '@/api/use-accounts';
import { useResolveLogo } from '@/api/use-logo';
import { CurrencyDisplay } from '@/components/shared/CurrencyDisplay';
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
import { resizeToPng } from '@/lib/image-utils';
import { cn } from '@/lib/utils';
import { formatPercentage, formatCurrency } from '@/lib/formatters';
import { useBaseCurrency } from '@/hooks/use-base-currency';
import { usePrivacy } from '@/context/privacy-context';
import { ChangeReferenceAccountDialog } from '@/components/domain/ChangeReferenceAccountDialog';

interface BrokerageUnitCardProps {
  unit: BrokerageUnit;
  onExpand: () => void;
  isExpanded: boolean;
  perf?: CalculationBreakdownResponse;
}

export function BrokerageUnitCard({ unit, onExpand, isExpanded, perf }: BrokerageUnitCardProps) {
  const { t } = useTranslation('accounts');
  const { t: tCommon } = useTranslation('common');
  const { isPrivate } = usePrivacy();
  const baseCurrency = useBaseCurrency();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const [changeRefOpen, setChangeRefOpen] = useState(false);

  const [showDomainPrompt, setShowDomainPrompt] = useState(false);
  const [domainInput, setDomainInput] = useState('');
  const [isFetchingLogo, setIsFetchingLogo] = useState(false);

  const deleteMutation = useDeleteAccount();
  const deactivateMutation = useDeactivateAccount();
  const reactivateMutation = useReactivateAccount();
  const logoMutation = useUpdateAccountLogo();
  const updateMutation = useUpdateAccount();
  const resolveLogoMutation = useResolveLogo();

  const { portfolio, deposit, holdings } = unit;

  const secValue = parseFloat(portfolio.balance);
  const cashValue = parseFloat(deposit?.balance ?? '0');
  const totalValue = secValue + cashValue;
  const secPct = totalValue > 0 ? secValue / totalValue : 0.5;

  const holdingsCount = holdings?.holdings.length ?? 0;
  const currency = portfolio.currency ?? deposit?.currency ?? 'EUR';

  function handleDelete(e: Event) {
    e.stopPropagation();
    if (portfolio.transactionCount > 0) { // native-ok
      toast.error(t('actions.cannotDelete', { count: portfolio.transactionCount }));
      return;
    }
    if (!confirm(t('actions.deleteConfirm', { name: portfolio.name }))) return;
    deleteMutation.mutate(portfolio.id);
  }

  function handleRetire(e: Event) {
    e.stopPropagation();
    if (portfolio.isRetired) {
      reactivateMutation.mutate(portfolio.id);
    } else {
      deactivateMutation.mutate(portfolio.id);
    }
  }

  async function handleLogoUpload(file: File) {
    try {
      const dataUrl = await resizeToPng(file);
      logoMutation.mutate({ id: portfolio.id, logoUrl: dataUrl });
    } catch {
      toast.error(tCommon('toasts.imageTooLarge'));
    }
  }

  async function handleFetchLogo() {
    const domain = domainInput.trim().replace(/^https?:\/\//, '').replace(/\/$/, '');
    if (!domain) return;
    setIsFetchingLogo(true);
    try {
      const { logoUrl } = await resolveLogoMutation.mutateAsync({ domain });
      logoMutation.mutate({ id: unit.portfolio.id, logoUrl });
      setShowDomainPrompt(false);
      setDomainInput('');
    } catch {
      toast.error(t('logo.fetchFailed'));
    } finally {
      setIsFetchingLogo(false);
    }
  }

  const isRetired = portfolio.isRetired;

  return (
    <div
      className={cn(
        'max-w-[720px] bg-card border rounded-lg overflow-hidden cursor-pointer qv-card-interactive',
        isRetired && 'border-l-[3px] border-l-[var(--qv-warning)]',
      )}
      onClick={onExpand}
    >
      {/* Header row */}
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        {/* Left side: logo + name + meta */}
        <div className="flex items-center gap-3 min-w-0">
          {portfolio.logoUrl ? (
            <img src={portfolio.logoUrl} alt="" className="h-8 w-8 rounded-md object-contain" />
          ) : (
            <div className="h-8 w-8 rounded-md border border-muted-foreground/60 bg-muted flex items-center justify-center">
              <Landmark className="h-4 w-4 text-muted-foreground" />
            </div>
          )}
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className={cn('font-semibold text-sm truncate', isRetired && 'text-muted-foreground')}>{portfolio.name}</p>
              {isRetired && (
                <span className="shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-[var(--qv-warning)]/15 text-[var(--qv-warning)]">
                  {tCommon('retired')}
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground truncate">
              {currency}
              {holdingsCount > 0 && (
                <> &middot; {t('card.securitiesCount', { count: holdingsCount })}</>
              )}
              {deposit && (
                <> &middot; {deposit.name}</>
              )}
            </p>
          </div>
        </div>

        {/* Right side: total value + kebab */}
        <div className="flex items-center gap-2 shrink-0">
          <div className="text-right">
            <p className="text-xs text-muted-foreground">{t('card.totalValue')}</p>
            <CurrencyDisplay
              value={totalValue}
              currency={currency}
              className="text-lg font-semibold tabular-nums"
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
              <DropdownMenuItem onSelect={(e) => { e.stopPropagation(); setRenameOpen(true); }}>
                {t('actions.rename')}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}>
                {t('actions.changeLogo')}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setShowDomainPrompt(prev => !prev)}>
                {t('actions.fetchLogo')}
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={(e) => { e.stopPropagation(); setChangeRefOpen(true); }}
                disabled={portfolio.isRetired}
              >
                {t('actions.changeReferenceAccount')}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={handleRetire}>
                {portfolio.isRetired ? t('actions.reactivateAccount') : t('actions.retire')}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={handleDelete}>
                {t('actions.delete')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Split bar */}
      <div className="flex h-1.5 mx-4 mb-3 rounded-full overflow-hidden">
        <div className="bg-primary" style={{ flex: secPct }} />
        <div className="bg-muted" style={{ flex: 1 - secPct }} />
      </div>

      {isExpanded && (
        <div className="px-4 pb-3 border-t border-border/50 pt-3">
          <BrokerageUnitExpanded unit={unit} />
        </div>
      )}

      {/* Footer row: securities, cash, performance */}
      <div className="flex items-start justify-between px-4 pb-4">
        <div>
          <p className="text-xs text-muted-foreground font-medium">{t('card.securities')}</p>
          <CurrencyDisplay
            value={secValue}
            currency={currency}
            className="text-sm font-semibold tabular-nums"
          />
        </div>
        <div>
          <p className="text-xs text-muted-foreground font-medium">{t('card.cash')}</p>
          <CurrencyDisplay
            value={cashValue}
            currency={currency}
            className="text-sm font-semibold tabular-nums"
          />
        </div>
        {perf && !isPrivate && (() => {
          const perfPct = parseFloat(perf.openPositionPnL.percentage);
          const absPerf = parseFloat(perf.openPositionPnL.value);
          const isPositive = absPerf >= 0;
          return (
            <div className="text-right">
              <p className="text-xs text-muted-foreground font-medium">{t('card.performance')}</p>
              <p className={cn('text-sm font-semibold tabular-nums', isPositive ? 'text-[var(--qv-positive)]' : 'text-[var(--qv-negative)]')}>
                {formatPercentage(perfPct)}
              </p>
              <p className={cn('text-[10px] tabular-nums opacity-70', isPositive ? 'text-[var(--qv-positive)]' : 'text-[var(--qv-negative)]')}>
                {formatCurrency(absPerf, baseCurrency)}
              </p>
            </div>
          );
        })()}
      </div>

      {deposit && (
        <ChangeReferenceAccountDialog
          open={changeRefOpen}
          onOpenChange={setChangeRefOpen}
          securitiesAccountId={portfolio.id}
          currentReferenceAccountId={deposit.id}
          currency={currency}
        />
      )}

      {/* Rename dialog */}
      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent className="sm:max-w-[400px]" onClick={(e) => e.stopPropagation()}>
          <DialogHeader>
            <DialogTitle>{deposit ? t('rename.title') : t('rename.titleSingle')}</DialogTitle>
            <DialogDescription className="sr-only">
              {t('rename.description')}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            const newPortfolioName = (fd.get('portfolioName') as string)?.trim();
            const newDepositName = (fd.get('depositName') as string)?.trim();
            if (newPortfolioName && newPortfolioName !== portfolio.name) {
              updateMutation.mutate({ id: portfolio.id, data: { name: newPortfolioName } });
            }
            if (deposit && newDepositName && newDepositName !== deposit.name) {
              updateMutation.mutate({ id: deposit.id, data: { name: newDepositName } });
            }
            setRenameOpen(false);
          }}>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="portfolioName">{t('rename.portfolioName')}</Label>
                <Input id="portfolioName" name="portfolioName" autoFocus defaultValue={portfolio.name} />
              </div>
              {deposit && (
                <div className="space-y-2">
                  <Label htmlFor="depositName">{t('rename.depositName')}</Label>
                  <Input id="depositName" name="depositName" defaultValue={deposit.name} />
                </div>
              )}
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

      {/* Hidden file input for logo upload */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          e.target.value = '';
          await handleLogoUpload(file);
        }}
      />
    </div>
  );
}
