import { forwardRef, type ComponentPropsWithoutRef } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { UseMutationResult } from '@tanstack/react-query';
import { cn } from '@/lib/utils';

type ButtonProps = ComponentPropsWithoutRef<typeof Button>;

export interface SubmitButtonProps extends ButtonProps {
  /**
   * The TanStack Query mutation whose `isPending` drives this button's
   * disabled/aria-busy state. Pass the full mutation result (e.g. from
   * `const m = useCreateX(); <SubmitButton mutation={m}>…`).
   */
  mutation: Pick<UseMutationResult<unknown, unknown, unknown, unknown>, 'isPending'>;
}

/**
 * Submit button that reflects a mutation's pending state:
 * - disables itself while pending (prevents double-submit)
 * - sets aria-busy="true" so assistive tech announces the wait
 * - overlays a spinner while keeping the button's visible label (a11y)
 *
 * Designed for mutation-bound primary actions (Save, Create, Import, etc.).
 * For plain navigation buttons or non-mutation actions, use the base `<Button>`.
 */
export const SubmitButton = forwardRef<HTMLButtonElement, SubmitButtonProps>(
  function SubmitButton({ mutation, disabled, className, children, ...rest }, ref) {
    const pending = mutation.isPending;
    return (
      <Button
        ref={ref}
        disabled={disabled || pending}
        aria-busy={pending ? 'true' : 'false'}
        className={cn('relative', className)}
        {...rest}
      >
        {pending && (
          <Loader2
            data-testid="submit-button-spinner"
            className="mr-2 h-4 w-4 animate-spin"
            aria-hidden="true"
          />
        )}
        {children}
      </Button>
    );
  },
);
