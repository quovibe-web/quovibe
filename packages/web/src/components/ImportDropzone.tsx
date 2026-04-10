import React, { useRef, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Upload, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ImportDropzoneProps {
  onFile: (file: File) => void;
  disabled?: boolean;
}

export function ImportDropzone({ onFile, disabled }: ImportDropzoneProps) {
  const { t } = useTranslation('settings');
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const handleFile = useCallback((file: File) => {
    setSelectedFile(file);
    onFile(file);
  }, [onFile]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  return (
    <div className="space-y-3">
      <div
        className={cn(
          'border-2 rounded-lg p-8 text-center transition-all duration-150 cursor-pointer',
          dragging
            ? 'border-primary bg-primary/10 scale-[1.01]'
            : selectedFile
              ? 'border-solid border-primary/30 bg-primary/5'
              : 'border-dashed border-border hover:border-primary/50 hover:bg-muted/40',
          disabled && 'opacity-50 cursor-not-allowed',
        )}
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={disabled ? undefined : onDrop}
        onClick={() => !disabled && inputRef.current?.click()}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".xml"
          className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
          disabled={disabled}
        />
        <div className="flex flex-col items-center">
          {selectedFile ? (
            <>
              <FileText className="h-8 w-8 text-primary mb-2" />
              <p className="text-sm font-medium text-foreground">
                {selectedFile.name} ({(selectedFile.size / 1024).toFixed(0)} KB)
              </p>
            </>
          ) : (
            <>
              <Upload className="h-8 w-8 text-muted-foreground/40 mb-2" />
              <p className="text-sm text-muted-foreground">
                {t('import.dropzone')}
              </p>
            </>
          )}
        </div>
      </div>
      <p className="text-xs text-muted-foreground/60">
        {t('import.dropzoneFormat')}
        <br />
        {t('import.dropzoneHint')}
      </p>
    </div>
  );
}
