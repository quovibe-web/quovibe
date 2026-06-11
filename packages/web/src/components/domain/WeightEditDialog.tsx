import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { normalizeDecimalInput } from '@/lib/decimal-input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultValue: number | null;
  onConfirm: (weight: number) => void;
}

export function WeightEditDialog({ open, onOpenChange, defaultValue, onConfirm }: Props) {
  const { t } = useTranslation('reports');
  const [val, setVal] = useState(defaultValue != null ? String(defaultValue / 100) : '');

  useEffect(() => {
    if (open) setVal(defaultValue != null ? String(defaultValue / 100) : '');
  }, [open, defaultValue]);

  function handleSubmit() {
    // Accept the locale comma decimal (es/it/de/…) the same way the price and
    // transaction forms do — a bare parseFloat("12,5") would drop the fraction.
    const v = parseFloat(normalizeDecimalInput(val));
    if (isNaN(v)) return;
    onConfirm(Math.round(v * 100));
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xs">
        <DialogHeader>
          <DialogTitle>{t('taxonomyManagement.editWeight')}</DialogTitle>
          <DialogDescription className="sr-only">
            {t('taxonomyManagement.editWeightDescription')}
          </DialogDescription>
        </DialogHeader>
        <div className="py-2">
          <Label>{t('assetAllocation.columns.weight')}</Label>
          <Input
            inputMode="decimal"
            value={val}
            onChange={(e) => setVal(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit(); }}
            autoFocus
            className="mt-1"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common:cancel')}
          </Button>
          <Button onClick={handleSubmit} disabled={val === '' || isNaN(parseFloat(normalizeDecimalInput(val)))}>
            {t('common:save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
