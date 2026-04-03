import { useState } from 'react';
import { format } from 'date-fns';
import { CalendarIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { SecurityEventType } from '@/lib/enums';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useSecurities } from '@/api/use-securities';
import { useCreateSecurityEvent } from '@/api/use-security-events';
import { getDateLocale } from '@/lib/formatters';

interface CorporateEventDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  preselectedSecurityId?: string;
}

export function CorporateEventDialog({ open, onOpenChange, preselectedSecurityId }: CorporateEventDialogProps) {
  const { t } = useTranslation('securities');
  const { data: securities = [] } = useSecurities();
  const { mutate, isPending } = useCreateSecurityEvent();

  const [securityId, setSecurityId] = useState(preselectedSecurityId ?? '');
  const [date, setDate] = useState<Date>(new Date());
  const [calOpen, setCalOpen] = useState(false);
  const [note, setNote] = useState('');

  function handleSubmit() {
    if (!securityId) { toast.error(t('transactions:validation.securityRequired')); return; }
    if (!note.trim()) { toast.error(t('transactions:validation.noteRequired')); return; }

    mutate(
      {
        securityId,
        type: SecurityEventType.EVENT,
        date: format(date, 'yyyy-MM-dd'),
        details: JSON.stringify({ note }),
      },
      { onSuccess: () => onOpenChange(false) },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('corporateEvent.title')}</DialogTitle>
          <DialogDescription className="sr-only">
            {t('corporateEvent.description')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1">
            <Label>{t('transactions:form.security')}</Label>
            <Select value={securityId} onValueChange={setSecurityId} disabled={!!preselectedSecurityId}>
              <SelectTrigger autoFocus>
                <SelectValue placeholder={t('transactions:form.selectSecurity')} />
              </SelectTrigger>
              <SelectContent>
                {securities.map(s => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label>{t('common:date')}</Label>
            <Popover open={calOpen} onOpenChange={setCalOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" className="w-full justify-start">
                  <CalendarIcon className="h-4 w-4 mr-2" />
                  {format(date, 'P', { locale: getDateLocale() })}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0">
                <Calendar
                  mode="single"
                  selected={date}
                  onSelect={(d) => { if (d) { setDate(d); setCalOpen(false); } }}
                  initialFocus
                />
              </PopoverContent>
            </Popover>
          </div>

          <div className="space-y-1">
            <Label>{t('common:note')}</Label>
            <Input
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder={t('transactions:form.describeEvent')}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t('common:cancel')}</Button>
          <Button onClick={handleSubmit} disabled={isPending}>
            {isPending ? t('common:saving') : t('common:save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
