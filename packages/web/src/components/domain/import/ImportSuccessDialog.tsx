import { useTranslation } from 'react-i18next';
import { ArrowRight } from 'lucide-react';
import type { ImportSummary } from '@quovibe/shared';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

interface Props {
  open: boolean;
  portfolioName: string;
  summary: ImportSummary;
  onConfirm: () => void;
}

export function ImportSuccessDialog({
  open,
  portfolioName,
  summary,
  onConfirm,
}: Props) {
  const { t } = useTranslation('welcome');
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Esc + outside click both collapse to confirm. There is no cancel
        // path — the import already succeeded; modal is acknowledge-only.
        if (!next) onConfirm();
      }}
    >
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('hub.importSuccess.title')}</DialogTitle>
          <DialogDescription className="sr-only">
            {t('hub.importSuccess.statSecurities', { count: summary.securities })}
            {', '}
            {t('hub.importSuccess.statAccounts', { count: summary.accounts })}
            {', '}
            {t('hub.importSuccess.statTransactions', { count: summary.transactions })}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4 py-2">
          <p className="text-base font-medium">{portfolioName}</p>
          <hr className="border-border" />
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 tabular-nums">
            <dt className="text-right font-medium">{summary.securities}</dt>
            <dd className="text-muted-foreground">
              {t('hub.importSuccess.statSecurities', { count: summary.securities })}
            </dd>
            <dt className="text-right font-medium">{summary.accounts}</dt>
            <dd className="text-muted-foreground">
              {t('hub.importSuccess.statAccounts', { count: summary.accounts })}
            </dd>
            <dt className="text-right font-medium">{summary.transactions}</dt>
            <dd className="text-muted-foreground">
              {t('hub.importSuccess.statTransactions', { count: summary.transactions })}
            </dd>
          </dl>
        </div>
        <DialogFooter>
          <Button autoFocus onClick={onConfirm} className="gap-2">
            {t('hub.importSuccess.openButton')}
            <ArrowRight className="h-4 w-4" aria-hidden />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
