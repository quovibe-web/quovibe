import { useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import {
  friendlyAttributeTypeEnum,
  type UpdateAttributeTypeInput,
  type CreateAttributeTypeInput,
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
import { useFormRevalidateOnChange } from '@/hooks/use-form-revalidate-on-change';
import { useCreateAttributeType, useUpdateAttributeType } from '@/api/use-attribute-types';
import type { AttributeTypeItem } from '@/api/types';

const FRIENDLY_TYPES = friendlyAttributeTypeEnum.options;

const CREATE_DEFAULTS = { name: '', columnLabel: undefined as string | undefined, friendlyType: 'TEXT' as const };

type Translator = (key: string, opts?: Record<string, unknown>) => string;

function buildBaseAttributeTypeSchema(t: Translator) {
  return z.object({
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
  });
}

function buildEditFormSchema(t: Translator) {
  return buildBaseAttributeTypeSchema(t).strict();
}

function buildCreateFormSchema(t: Translator) {
  return buildBaseAttributeTypeSchema(t).extend({ friendlyType: friendlyAttributeTypeEnum }).strict();
}

type EditFormValues = UpdateAttributeTypeInput;
type CreateFormValues = { name: string; columnLabel?: string; friendlyType: CreateAttributeTypeInput['friendlyType'] };

interface EditProps {
  mode: 'edit';
  open: boolean;
  onOpenChange: (open: boolean) => void;
  type: AttributeTypeItem;
  onCreated?: never;
}

interface CreateProps {
  mode: 'create';
  open: boolean;
  onOpenChange: (open: boolean) => void;
  type?: never;
  onCreated: (created: AttributeTypeItem) => void;
}

type Props = EditProps | CreateProps;

export function AttributeTypeFormDialog({ mode, open, onOpenChange, type, onCreated }: Props) {
  const { t } = useTranslation('securities');
  const { t: tCommon } = useTranslation('common');
  const createMut = useCreateAttributeType();
  const updateMut = useUpdateAttributeType();

  const editSchema = useMemo(() => buildEditFormSchema(t), [t]);
  const editDefaults = useMemo<EditFormValues>(
    () => ({ name: type?.name ?? '', columnLabel: type?.columnLabel ?? undefined }),
    [type],
  );
  const editForm = useForm<EditFormValues>({
    resolver: zodResolver(editSchema),
    mode: 'onBlur',
    reValidateMode: 'onChange',
    defaultValues: editDefaults,
  });

  useEffect(() => { if (mode === 'edit') editForm.reset(editDefaults); }, [mode, editDefaults, editForm]);
  useFormRevalidateOnChange(editForm);

  const { run: runEdit, inFlight: editInFlight } = useGuardedSubmit(async (values: EditFormValues) => {
    if (!type) return;
    try {
      await updateMut.mutateAsync({ id: type.id, input: values });
      onOpenChange(false);
    } catch {
      // global MutationCache toast
    }
  });

  const createSchema = useMemo(() => buildCreateFormSchema(t), [t]);
  const createForm = useForm<CreateFormValues>({
    resolver: zodResolver(createSchema),
    mode: 'onBlur',
    reValidateMode: 'onChange',
    defaultValues: CREATE_DEFAULTS,
  });

  useEffect(() => { if (mode === 'create' && open) createForm.reset(CREATE_DEFAULTS); }, [mode, open, createForm]);
  useFormRevalidateOnChange(createForm);

  const { run: runCreate, inFlight: createInFlight } = useGuardedSubmit(async (values: CreateFormValues) => {
    try {
      const payload: CreateAttributeTypeInput = {
        name: values.name,
        columnLabel: values.columnLabel || undefined,
        friendlyType: values.friendlyType,
        target: 'Security',
      };
      const created = await createMut.mutateAsync(payload);
      onCreated?.(created);
      onOpenChange(false);
    } catch {
      // global MutationCache toast
    }
  });

  if (mode === 'edit') {
    const submitMutation = { isPending: updateMut.isPending || editInFlight };
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('attributeType.editTitle')}</DialogTitle>
          </DialogHeader>
          <Form {...editForm}>
            <form onSubmit={editForm.handleSubmit(runEdit)} className="space-y-4">
              <FormField
                control={editForm.control}
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
                control={editForm.control}
                name="columnLabel"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('attributeType.fields.columnLabel')}</FormLabel>
                    <FormControl>
                      <Input {...field} value={field.value ?? ''} placeholder={editForm.getValues('name')} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormItem>
                <FormLabel>{t('attributeType.fields.type')}</FormLabel>
                <Select value={type?.friendlyType} disabled>
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
                <SubmitButton type="submit" mutation={submitMutation} disabled={!editForm.formState.isValid}>
                  {tCommon('save')}
                </SubmitButton>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    );
  }

  // create mode
  const submitMutation = { isPending: createMut.isPending || createInFlight };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('attributeType.createTitle')}</DialogTitle>
        </DialogHeader>
        <Form {...createForm}>
          <form onSubmit={createForm.handleSubmit(runCreate)} className="space-y-4">
            <FormField
              control={createForm.control}
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
              control={createForm.control}
              name="columnLabel"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('attributeType.fields.columnLabel')}</FormLabel>
                  <FormControl>
                    <Input {...field} value={field.value ?? ''} placeholder={createForm.getValues('name')} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={createForm.control}
              name="friendlyType"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('attributeType.fields.type')}</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {FRIENDLY_TYPES.map(ft => (
                        <SelectItem key={ft} value={ft}>
                          {t(`attributeType.types.${ft.toLowerCase()}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {tCommon('cancel')}
              </Button>
              <SubmitButton type="submit" mutation={submitMutation} disabled={!createForm.formState.isValid}>
                {tCommon('save')}
              </SubmitButton>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
