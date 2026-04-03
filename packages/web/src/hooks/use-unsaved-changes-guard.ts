import { useState, useCallback } from 'react';

interface UnsavedChangesGuard {
  /** Wrap onOpenChange with this — intercepts close when dirty */
  guardedOpenChange: (nextOpen: boolean) => void;
  /** AlertDialog open state */
  showDialog: boolean;
  /** Pass to AlertDialog onOpenChange */
  setShowDialog: (open: boolean) => void;
  /** Call from "Discard" button */
  discard: () => void;
}

export function useUnsavedChangesGuard(
  isDirty: boolean,
  onOpenChange: (open: boolean) => void,
): UnsavedChangesGuard {
  const [showDialog, setShowDialog] = useState(false);

  const guardedOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen && isDirty) {
        setShowDialog(true);
        return;
      }
      onOpenChange(nextOpen);
    },
    [isDirty, onOpenChange],
  );

  const discard = useCallback(() => {
    setShowDialog(false);
    onOpenChange(false);
  }, [onOpenChange]);

  return { guardedOpenChange, showDialog, setShowDialog, discard };
}
