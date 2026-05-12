import { useCallback, useEffect, useRef, useState } from 'react';
import type { DragEvent, ChangeEvent } from 'react';
import { Upload, FileText, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ImportDropzoneProps {
  onFile: (file: File) => void;
  file: File | null;
  accept: string;
  emptyText: string;
  changeHint: string;
  formatHint?: string;
  disabled?: boolean;
}

export function ImportDropzone({
  onFile,
  file,
  accept,
  emptyText,
  changeHint,
  formatHint,
  disabled,
}: ImportDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (disabled) setDragging(false);
  }, [disabled]);

  const handleFile = useCallback(
    (f: File) => {
      onFile(f);
    },
    [onFile],
  );

  const onDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const f = e.dataTransfer.files[0];
      if (f) handleFile(f);
    },
    [handleFile],
  );

  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) handleFile(f);
  };

  const state: 'empty' | 'dragging' | 'selected' = dragging
    ? 'dragging'
    : file
      ? 'selected'
      : 'empty';

  return (
    <div className="space-y-2">
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-label={
          state === 'selected' && file
            ? `${file.name} — ${changeHint}`
            : emptyText
        }
        aria-disabled={disabled || undefined}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false);
        }}
        onDrop={disabled ? undefined : onDrop}
        onClick={() => {
          if (disabled) return;
          if (inputRef.current) inputRef.current.value = '';
          inputRef.current?.click();
        }}
        onKeyDown={(e) => {
          if (!disabled && (e.key === 'Enter' || e.key === ' ') && e.currentTarget === e.target) {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        className={cn(
          'group relative flex flex-col items-center justify-center gap-3 overflow-hidden rounded-md border px-6 py-8 text-center',
          'transition-all duration-200 ease-out',
          !disabled && 'cursor-pointer',
          disabled && 'cursor-not-allowed opacity-50',
          state === 'empty' &&
            'border-dashed border-[var(--qv-border-strong)] bg-[var(--qv-surface-elevated)] hover:bg-[var(--qv-surface-3)]',
          state === 'selected' &&
            'border-solid border-[var(--color-primary)]/40 bg-card',
          state === 'dragging' &&
            'scale-[1.01] border-solid border-[var(--color-primary)] bg-[color-mix(in_srgb,var(--color-primary)_8%,transparent)]',
        )}
      >
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          className="sr-only"
          onChange={onChange}
          disabled={disabled}
          tabIndex={-1}
        />

        {state === 'empty' && (
          <>
            <span
              aria-hidden
              className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--qv-surface-3)] text-[var(--qv-text-secondary)] transition-all duration-200 group-hover:-translate-y-0.5 group-hover:text-foreground"
            >
              <Upload size={22} strokeWidth={1.75} />
            </span>
            <span className="flex flex-col gap-1">
              <span className="text-sm font-medium text-foreground">{emptyText}</span>
              {formatHint && (
                <span className="text-xs text-[var(--qv-text-secondary)]">{formatHint}</span>
              )}
            </span>
          </>
        )}

        {state === 'selected' && file && (
          <>
            <span
              aria-hidden
              className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--qv-surface-elevated)] text-[var(--color-primary)]"
            >
              <FileText size={22} strokeWidth={1.75} />
            </span>
            <span className="flex min-w-0 flex-col gap-1">
              <span className="flex items-center justify-center gap-1.5">
                <CheckCircle2 size={14} className="text-[var(--color-primary)]" aria-hidden />
                <span className="max-w-[18rem] truncate text-sm font-medium text-foreground">
                  {file.name}
                </span>
              </span>
              <span className="qv-numeric text-xs text-[var(--qv-text-secondary)]">
                {(file.size / 1024).toFixed(0)} KB · {changeHint}
              </span>
            </span>
          </>
        )}

        {state === 'dragging' && (
          <>
            <span
              aria-hidden
              className="flex h-12 w-12 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--color-primary)_20%,transparent)] text-[var(--color-primary)]"
            >
              <Upload size={22} strokeWidth={1.75} />
            </span>
            <span className="text-sm font-medium text-[var(--color-primary)]">
              {emptyText}
            </span>
          </>
        )}
      </div>
    </div>
  );
}
