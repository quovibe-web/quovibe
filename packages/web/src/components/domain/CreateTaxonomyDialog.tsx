import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { useCreateTaxonomy } from '@/api/use-taxonomy-mutations';
import { usePortfolio } from '@/context/PortfolioContext';

const TEMPLATES = [
  { key: '', labelKey: 'templateEmpty' },
  { key: 'asset-classes', labelKey: 'templateAssetClasses' },
  { key: 'industries-gics-sectors', labelKey: 'templateIndustriesGics' },
  { key: 'industry', labelKey: 'templateIndustry' },
  { key: 'asset-allocation', labelKey: 'templateAssetAllocation' },
  { key: 'regions', labelKey: 'templateRegions' },
  { key: 'regions-msci', labelKey: 'templateRegionsMsci' },
  { key: 'type-of-security', labelKey: 'templateTypeSecurity' },
] as const;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateTaxonomyDialog({ open, onOpenChange }: Props) {
  const { t } = useTranslation('reports');
  const navigate = useNavigate();
  const portfolio = usePortfolio();
  const createMutation = useCreateTaxonomy();

  const [name, setName] = useState('');
  const [template, setTemplate] = useState('');

  function reset() {
    setName('');
    setTemplate('');
  }

  function handleClose(v: boolean) {
    if (!v) reset();
    onOpenChange(v);
  }

  async function handleSave() {
    if (!name.trim()) {
      toast.error(t('taxonomyManagement.nameLabel'));
      return;
    }
    try {
      const result = await createMutation.mutateAsync({
        name: name.trim(),
        ...(template ? { template } : {}),
      });
      handleClose(false);
      navigate(`/p/${portfolio.id}/allocation?taxonomy=${result.id}`);
    } catch {
      toast.error(t('common:toasts.errorSaving'));
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('taxonomyManagement.createTaxonomy')}</DialogTitle>
          <DialogDescription className="sr-only">
            {t('taxonomyManagement.createDescription')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1">
            <Label>{t('taxonomyManagement.nameLabel')}</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('taxonomyManagement.namePlaceholder')}
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <Label>{t('taxonomyManagement.templateLabel')}</Label>
            <RadioGroup value={template} onValueChange={setTemplate} className="space-y-1.5">
              {TEMPLATES.map((tmpl) => (
                <div key={tmpl.key} className="flex items-center gap-2">
                  <RadioGroupItem value={tmpl.key} id={`tmpl-${tmpl.key || 'empty'}`} />
                  <Label htmlFor={`tmpl-${tmpl.key || 'empty'}`} className="font-normal cursor-pointer">
                    {t(`taxonomyManagement.${tmpl.labelKey}`)}
                  </Label>
                </div>
              ))}
            </RadioGroup>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleClose(false)}>
            {t('common:cancel')}
          </Button>
          <Button onClick={handleSave} disabled={createMutation.isPending}>
            {t('taxonomyManagement.createTaxonomy')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
