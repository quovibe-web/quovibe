import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useParseCsvPrices } from '@/api/use-csv-import';
import { validateFileClientSide, mapServerError } from '../csv-upload.utils';
import type { PriceColumnMapping } from '@/pages/price-import-wizard.utils';
import type { CsvParseResult } from '@quovibe/shared';

interface Props {
  parseResult: CsvParseResult | null;
  onParsed: (result: CsvParseResult, columnMapping: PriceColumnMapping) => void;
  onBack: () => void;
  onNext: () => void;
}

function autoMapColumns(headers: string[]): PriceColumnMapping {
  const mapping: PriceColumnMapping = {};
  headers.forEach((h, i) => {
    const lower = h.toLowerCase().trim();
    if (lower === 'date' || lower === 'datum') mapping.date = i;
    else if (
      lower === 'close' ||
      lower === 'price' ||
      lower === 'quote' ||
      lower === 'value'
    )
      mapping.close = i;
    else if (lower === 'high') mapping.high = i;
    else if (lower === 'low') mapping.low = i;
    else if (lower === 'volume') mapping.volume = i;
  });
  return mapping;
}

export function PriceCsvUploadStep({ parseResult, onParsed, onBack, onNext }: Props) {
  const { t } = useTranslation('csv-import');
  const parseMutation = useParseCsvPrices();
  const [uploadError, setUploadError] = useState<'invalidFile' | 'tooLarge' | 'binary' | null>(
    null,
  );

  async function handleFile(file: File) {
    if (parseMutation.isPending) return;
    setUploadError(null);
    const clientReject = await validateFileClientSide(file);
    if (clientReject) {
      setUploadError(clientReject);
      return;
    }
    parseMutation.mutate(file, {
      onSuccess: (result) => {
        onParsed(result, autoMapColumns(result.headers));
      },
      onError: (err) => {
        setUploadError(mapServerError(err instanceof Error ? err.message : String(err)));
      },
    });
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) void handleFile(file);
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) void handleFile(file);
  }

  const canProceed = parseResult !== null && uploadError === null;

  return (
    <div className="space-y-6">
      <Card className="rounded-md">
        <CardHeader>
          <CardTitle>{t('upload.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          <div
            className={`border border-dashed border-[var(--qv-border)] rounded-md bg-[var(--qv-surface-elevated)] p-8 text-center transition-colors ${
              parseMutation.isPending
                ? 'opacity-60 pointer-events-none'
                : 'cursor-pointer hover:border-[var(--color-primary)] hover:bg-[var(--qv-surface-3)]'
            }`}
            onDrop={handleDrop}
            onDragOver={(e) => e.preventDefault()}
            onClick={() => document.getElementById('price-csv-input')?.click()}
          >
            <input
              id="price-csv-input"
              type="file"
              accept=".csv"
              className="hidden"
              onChange={handleFileInput}
            />
            <p className="text-[var(--qv-text-secondary)]">{t('prices.dropzone')}</p>
            <p className="text-xs text-[var(--qv-text-faint)] mt-1">{t('upload.dropzoneHint')}</p>
          </div>

          {uploadError && (
            <Alert variant="destructive" className="mt-3" role="alert">
              <AlertDescription>{t(`upload.errors.${uploadError}`)}</AlertDescription>
            </Alert>
          )}

          {parseResult && !uploadError && (
            <p className="mt-3 text-sm text-[var(--qv-text-secondary)]">
              {t('upload.rows', { count: parseResult.totalRows })}
            </p>
          )}
        </CardContent>
      </Card>

      {parseResult && (
        <Card className="rounded-md">
          <CardHeader>
            <CardTitle>{t('upload.preview')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--qv-border-subtle)]">
                    {parseResult.headers.map((h, i) => (
                      <th
                        key={i}
                        className="px-3 py-2 text-left qv-eyebrow text-[var(--qv-text-faint)]"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {parseResult.sampleRows.slice(0, 5).map((row, ri) => (
                    <tr
                      key={ri}
                      className="border-b border-[var(--qv-border-subtle)] last:border-0"
                    >
                      {row.map((cell, ci) => (
                        <td key={ci} className="px-3 py-2">
                          {cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex justify-between">
        <Button variant="outline" onClick={onBack}>
          {t('nav.back')}
        </Button>
        <Button onClick={onNext} disabled={!canProceed}>
          {t('nav.next')}
        </Button>
      </div>
    </div>
  );
}
