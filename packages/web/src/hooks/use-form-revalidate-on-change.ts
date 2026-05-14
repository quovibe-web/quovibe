import { useEffect } from 'react';
import type { FieldValues, UseFormReturn } from 'react-hook-form';

// RHF v7's reValidateMode: 'onChange' is dormant until first submit, so an
// inline error set by mode 'onBlur' or by a schema-rebuild trigger() stays
// red while the user types the fix. info.type === 'change' filters out
// setValue() emissions (which already revalidate on shouldValidate: true);
// trigger() does not fire the watch at all (separate state subject).
export function useFormRevalidateOnChange<T extends FieldValues>(
  form: UseFormReturn<T>,
): void {
  useEffect(() => {
    const sub = form.watch((_, info) => {
      if (info.type === 'change' && info.name) {
        void form.trigger(info.name);
      }
    });
    return () => sub.unsubscribe();
  }, [form]);
}
