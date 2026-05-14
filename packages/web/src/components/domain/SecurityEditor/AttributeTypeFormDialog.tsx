import { useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import {
  friendlyAttributeTypeEnum,
  type UpdateAttributeTypeInput,
} from '@quovibe/shared';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { SubmitButton } from '@/components/shared/SubmitButton';
import { Input } from '@/components/ui/input';
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from '@/components/ui/form';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useGuardedSubmit } from '@/hooks/use-guarded-submit';
import { useUpdateAttributeType } from '@/api/use-attribute-types';
import type { AttributeTypeItem } from '@/api/types';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  type: AttributeTypeItem;
}

const FRIENDLY_TYPES = friendlyAttributeTypeEnum.options;

type Translator = (key: string, opts?: Record<string, unknown>) => string;

// Web-side schema mirrors updateAttributeTypeSchema in @quovibe/shared but
// injects translated error messages via t(). Wire schema stays i18n-free per
// shared/ rules; the server still validates the shape on the wire.
function buildUpdateFormSchema(t: Translator) {
  return z
    .object({
      name: z
        .string()
        .trim()
        .min(1, t('attributeType.validation.nameRequired'))
        .max(64, t('attributeType.validation.nameTooLong', { max: 64 })),
      columnLabel: z
        .string()
        .trim()
        .max(64, t('attributeType.validation.columnLabelTooLong', { max: 64 }))
        .optional(),
    })
    .strict();
}

export function AttributeTypeFormDialog({ open, onOpenChange, type }: Props) {
  const { t } = useTranslation('securities');
  const { t: tCommon } = useTranslation('common');
  const updateMut = useUpdateAttributeType();
  const defaultValues = useMemo<UpdateAttributeTypeInput>(
    () => ({ name: type.name, columnLabel: type.columnLabel ?? undefined }),
    [type],
  );
  const schema = useMemo(() => buildUpdateFormSchema(t), [t]);
  const form = useForm<UpdateAttributeTypeInput>({
    resolver: zodResolver(schema),
    mode: 'onBlur',
    reValidateMode: 'onChange',
    defaultValues,
  });

  useEffect(() => { form.reset(defaultValues); }, [defaultValues, form]);
  useEffect(() => {
    const sub = form.watch((_, info) => {
      if (info.type === 'change' && info.name && !form.formState.touchedFields[info.name]) {
        void form.trigger(info.name);
      }
    });
    return () => sub.unsubscribe();
  }, [form]);

  const { run, inFlight } = useGuardedSubmit(async (values: UpdateAttributeTypeInput) => {
    try {
      await updateMut.mutateAsync({ id: type.id, input: values });
      onOpenChange(false);
    } catch {
      // global MutationCache toast handles user-visible feedback
    }
  });

  const submitMutation = { isPending: updateMut.isPending || inFlight };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('attributeType.editTitle')}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(run)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('attributeType.fields.name')}</FormLabel>
                  <FormControl>
                    <Input {...field} autoFocus />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="columnLabel"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('attributeType.fields.columnLabel')}</FormLabel>
                  <FormControl>
                    <Input {...field} value={field.value ?? ''} placeholder={form.getValues('name')} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormItem>
              <FormLabel>{t('attributeType.fields.type')}</FormLabel>
              <Select value={type.friendlyType} disabled>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FRIENDLY_TYPES.map(ft => (
                    <SelectItem key={ft} value={ft}>
                      {t(`attributeType.types.${ft.toLowerCase()}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormItem>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {tCommon('cancel')}
              </Button>
              <SubmitButton type="submit" mutation={submitMutation} disabled={!form.formState.isValid}>
                {tCommon('save')}
              </SubmitButton>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
