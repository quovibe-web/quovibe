import { useEffect } from 'react';
import type { FieldValues, UseFormReturn } from 'react-hook-form';

// RHF v7's reValidateMode: 'onChange' is dormant until the first submit — NOT
// after a blur-driven pass — so an inline error surfaced by mode 'onBlur' (or by
// a schema-rebuild trigger()) would persist while the user types the fix. This
// watch re-validates the changed field on every edit so the error clears on the
// first valid keystroke. No touched-state guard: a field IS touched after blur,
// which is exactly when we still need to clear-on-type, and trigger() is
// field-scoped + idempotent, so double-running with RHF's native path (if it
// ever fires) is harmless. info.type === 'change' keeps mount silent and filters
// out setValue() emissions (which already revalidate on shouldValidate: true);
// trigger() itself does not re-enter the watch (separate state subject).
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
