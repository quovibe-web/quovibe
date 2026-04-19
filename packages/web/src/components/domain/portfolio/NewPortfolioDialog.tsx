// Welcome-page dialog for the "create fresh portfolio" path. Wraps
// PortfolioSetupForm with an additional name field (which the form deliberately
// excludes — see PortfolioSetupForm.tsx header) and posts the composed
// FreshPortfolioInput payload via useCreatePortfolio.
//
// BUG-54/55 Phase 4 — Task 4.1.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useCreatePortfolio } from '@/api/use-portfolios';
import { PortfolioSetupForm } from './PortfolioSetupForm';
import type { SetupPortfolioInput } from '@quovibe/shared';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

export function NewPortfolioDialog({ open, onOpenChange }: Props) {
  const { t } = useTranslation('portfolio-setup');
  const navigate = useNavigate();
  const create = useCreatePortfolio();
  const [name, setName] = useState('');

  function handleSubmit(input: SetupPortfolioInput) {
    create.mutate(
      { source: 'fresh', name: name.trim(), ...input },
      {
        onSuccess: (r) => {
          onOpenChange(false);
          setName('');
          navigate(`/p/${r.entry.id}/dashboard`);
        },
        onError: (err) => {
          const msg = (err as Error).message;
          // DUPLICATE_NAME on the portfolio name itself → 409 from the registry
          // guard. Surface its own copy; everything else falls through to the
          // generic createFailed.
          if (msg === 'DUPLICATE_NAME') {
            toast.error(t('errors.createFailed', { msg }));
            return;
          }
          toast.error(t('errors.createFailed', { msg }));
        },
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>{t('dialog.title')}</DialogTitle>
          <DialogDescription>{t('dialog.description')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="portfolio-setup-portfolio-name">{t('fields.name')}</Label>
          <Input
            id="portfolio-setup-portfolio-name"
            value={name}
            placeholder={t('fields.namePlaceholder')}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </div>
        <PortfolioSetupForm
          onSubmit={handleSubmit}
          isSubmitting={create.isPending}
          submitLabel={t('submit.create')}
          disabled={!name.trim()}
        />
      </DialogContent>
    </Dialog>
  );
}
