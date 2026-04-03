// packages/web/src/components/domain/csv-import/CsvUploadStep.tsx
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useParseCsvTrades, useCsvConfigs } from '@/api/use-csv-import';
import type { WizardState } from '@/pages/CsvImportPage';
import { csvDelimiters, csvDateFormats } from '@quovibe/shared';

interface Props {
  state: WizardState;
  onUpdate: (partial: Partial<WizardState>) => void;
  onNext: () => void;
}

export function CsvUploadStep({ state, onUpdate, onNext }: Props) {
  const { t } = useTranslation('csv-import');
  const parseMutation = useParseCsvTrades();
  const { data: configs } = useCsvConfigs();

  function handleFile(file: File) {
    parseMutation.mutate(file, {
      onSuccess: (result) => {
        onUpdate({
          parseResult: result,
          delimiter: result.detectedDelimiter,
        });
      },
    });
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  }

  const canProceed = state.parseResult != null;

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

            {state.parseResult && (
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
