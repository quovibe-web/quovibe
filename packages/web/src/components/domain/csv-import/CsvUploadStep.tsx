// packages/web/src/components/domain/csv-import/CsvUploadStep.tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useParseCsvTrades, useCsvConfigs } from '@/api/use-csv-import';
import type { WizardState } from '@/pages/CsvImportPage';
import { csvDelimiters, csvDateFormats, sniffLikelyTradeCsv } from '@quovibe/shared';

interface Props {
  state: WizardState;
  onUpdate: (partial: Partial<WizardState>) => void;
  onNext: () => void;
}

// 4 KB is enough to catch obviously-binary input (null bytes in headers /
// magic-byte regions) without blocking on large uploads. A real CSV has no
// null bytes in UTF-8 / ASCII text.
const BINARY_SNIFF_BYTES = 4096; // native-ok

async function validateFileClientSide(file: File): Promise<'invalidFile' | 'binary' | null> {
  if (!file.name.toLowerCase().endsWith('.csv')) return 'invalidFile';
  const slice = file.slice(0, BINARY_SNIFF_BYTES);
  const buf = new Uint8Array(await slice.arrayBuffer());
  for (let i = 0; i < buf.length; i++) { // native-ok
    if (buf[i] === 0) return 'binary';
  }
  return null;
}

function mapServerError(message: string): 'invalidFile' | 'tooLarge' {
  if (message === 'FILE_TOO_LARGE') return 'tooLarge';
  return 'invalidFile';
}

export function CsvUploadStep({ state, onUpdate, onNext }: Props) {
  const { t } = useTranslation('csv-import');
  const parseMutation = useParseCsvTrades();
  const { data: configs } = useCsvConfigs();
  const [uploadError, setUploadError] = useState<'invalidFile' | 'tooLarge' | 'binary' | null>(null);

  async function handleFile(file: File) {
    setUploadError(null);
    onUpdate({ parseResult: null });

    const clientReject = await validateFileClientSide(file);
    if (clientReject) {
      setUploadError(clientReject);
      return;
    }

    parseMutation.mutate(file, {
      onSuccess: (result) => {
        onUpdate({
          parseResult: result,
          delimiter: result.detectedDelimiter,
        });
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

  const sniff = state.parseResult
    ? sniffLikelyTradeCsv(
        state.parseResult.headers,
        state.parseResult.sampleRows,
        {
          dateFormat: state.dateFormat,
          decimalSeparator: state.decimalSeparator,
          thousandSeparator: state.thousandSeparator,
        },
      )
    : null;

  const canProceed = state.parseResult != null && sniff?.ok === true && uploadError == null;

  const sniffWarningKey: string | null = (() => {
    if (!sniff || sniff.ok) return null;
    switch (sniff.reason) {
      case 'SINGLE_COLUMN': return 'upload.warnings.singleColumn';
      case 'NO_DATE_COLUMN': return 'upload.warnings.noDate';
      case 'NO_AMOUNT_COLUMN': return 'upload.warnings.noAmount';
      case 'NO_SAMPLE_ROWS': return 'upload.warnings.noRows';
      default: return null;
    }
  })();

  return (
    <div className="space-y-6">
      {/* Saved configs */}
      {configs && configs.length > 0 && (
        <Card>
          <CardContent className="pt-4">
            <Label>{t('upload.savedConfigs')}</Label>
            <Select
              onValueChange={(id) => {
                const config = configs.find((c) => c.id === id);
                if (config) {
                  onUpdate({
                    delimiter: config.delimiter,
                    dateFormat: config.dateFormat,
                    decimalSeparator: config.decimalSeparator,
                    thousandSeparator: config.thousandSeparator,
                    columnMapping: config.columnMapping,
                  });
                }
              }}
            >
              <SelectTrigger><SelectValue placeholder={t('upload.selectConfig')} /></SelectTrigger>
              <SelectContent>
                {configs.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* File dropzone */}
        <Card>
          <CardHeader><CardTitle>{t('upload.title')}</CardTitle></CardHeader>
          <CardContent>
            <div
              className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer hover:border-primary transition-colors"
              onDrop={handleDrop}
              onDragOver={(e) => e.preventDefault()}
              onClick={() => document.getElementById('csv-file-input')?.click()}
            >
              <input
                id="csv-file-input"
                type="file"
                accept=".csv"
                className="hidden"
                onChange={handleFileInput}
              />
              <p className="text-muted-foreground">{t('upload.dropzone')}</p>
              <p className="text-xs text-muted-foreground mt-1">{t('upload.dropzoneHint')}</p>
            </div>

            {uploadError && (
              <Alert variant="destructive" className="mt-3" role="alert">
                <AlertDescription>{t(`upload.errors.${uploadError}`)}</AlertDescription>
              </Alert>
            )}

            {state.parseResult && !uploadError && (
              <p className="mt-3 text-sm text-muted-foreground">
                {t('upload.rows', { count: state.parseResult.totalRows })}
              </p>
            )}
          </CardContent>
        </Card>

        {/* Format settings */}
        <Card>
          <CardContent className="pt-6 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>{t('upload.delimiter')}</Label>
                <Select value={state.delimiter} onValueChange={(v) => onUpdate({ delimiter: v as typeof state.delimiter })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {csvDelimiters.map((d) => (
                      <SelectItem key={d} value={d}>
                        {d === '\t' ? 'Tab' : d === '|' ? 'Pipe' : d}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>{t('upload.dateFormat')}</Label>
                <Select value={state.dateFormat} onValueChange={(v) => onUpdate({ dateFormat: v as typeof state.dateFormat })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {csvDateFormats.map((f) => (
                      <SelectItem key={f} value={f}>{f}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>{t('upload.decimalSeparator')}</Label>
                <Select value={state.decimalSeparator} onValueChange={(v) => onUpdate({ decimalSeparator: v as '.' | ',' })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value=".">. (dot)</SelectItem>
                    <SelectItem value=",">, (comma)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>{t('upload.thousandSeparator')}</Label>
                <Select value={state.thousandSeparator || 'none'} onValueChange={(v) => onUpdate({ thousandSeparator: (v === 'none' ? '' : v) as typeof state.thousandSeparator })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t('upload.thousandNone')}</SelectItem>
                    <SelectItem value=".">. (dot)</SelectItem>
                    <SelectItem value=",">, (comma)</SelectItem>
                    <SelectItem value=" ">{t('upload.thousandSpace')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label>{t('upload.skipLines')}</Label>
              <Input
                type="number"
                min={0}
                defaultValue={0}
                onChange={(_e) => {/* skipLines control — handled on re-parse */}}
                className="w-24"
              />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Sniff warning — block Next with an inline explanation (BUG-47) */}
      {sniffWarningKey && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>
            <strong className="block mb-1">{t('upload.warnings.title')}</strong>
            {t(sniffWarningKey)}
          </AlertDescription>
        </Alert>
      )}

      {/* CSV preview table */}
      {state.parseResult && (
        <Card>
          <CardHeader><CardTitle>{t('upload.preview')}</CardTitle></CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    {state.parseResult.headers.map((h, i) => (
                      <th key={i} className="px-3 py-2 text-left font-medium text-muted-foreground">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {state.parseResult.sampleRows.slice(0, 5).map((row, ri) => (
                    <tr key={ri} className="border-b last:border-0">
                      {row.map((cell, ci) => (
                        <td key={ci} className="px-3 py-2">{cell}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Navigation */}
      <div className="flex justify-end">
        <Button onClick={onNext} disabled={!canProceed}>
          {t('nav.next')}
        </Button>
      </div>
    </div>
  );
}
