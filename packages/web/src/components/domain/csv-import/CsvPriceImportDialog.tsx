// packages/web/src/components/domain/csv-import/CsvPriceImportDialog.tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useParseCsvPrices, useExecuteCsvPrices } from '@/api/use-csv-import';
import { csvDateFormats } from '@quovibe/shared';
import type { CsvParseResult, PriceExecuteResult } from '@quovibe/shared';

interface Props {
  securityId: string;
  securityName: string;
}

export function CsvPriceImportDialog({ securityId, securityName }: Props) {
  const { t } = useTranslation('csv-import');
  const [open, setOpen] = useState(false);
  const parseMutation = useParseCsvPrices();
  const executeMutation = useExecuteCsvPrices();

  const [parseResult, setParseResult] = useState<CsvParseResult | null>(null);
  const [dateFormat, setDateFormat] = useState<string>('yyyy-MM-dd');
  const [decimalSeparator, setDecimalSeparator] = useState<'.' | ','>('.');
  const [thousandSeparator] = useState<'' | '.' | ',' | ' '>('');
  const [columnMapping, setColumnMapping] = useState<Record<string, number>>({});
  const [result, setResult] = useState<PriceExecuteResult | null>(null);

  const handleFile = (file: File) => {
    parseMutation.mutate(file, {
      onSuccess: (res) => {
        setParseResult(res);
        // Auto-map columns by header name
        const mapping: Record<string, number> = {};
        res.headers.forEach((h, i) => {
          const lower = h.toLowerCase().trim();
          if (lower === 'date' || lower === 'datum') mapping['date'] = i;
          else if (lower === 'close' || lower === 'price' || lower === 'quote' || lower === 'value') mapping['close'] = i;
          else if (lower === 'high') mapping['high'] = i;
          else if (lower === 'low') mapping['low'] = i;
          else if (lower === 'volume') mapping['volume'] = i;
        });
        setColumnMapping(mapping);
      },
    });
  };

  const handleExecute = () => {
    if (!parseResult || columnMapping['date'] == null || columnMapping['close'] == null) return;

    executeMutation.mutate({
      tempFileId: parseResult.tempFileId,
      securityId,
      columnMapping: {
        date: columnMapping['date'],
        close: columnMapping['close'],
        high: columnMapping['high'],
        low: columnMapping['low'],
        volume: columnMapping['volume'],
      },
      dateFormat,
      decimalSeparator,
      thousandSeparator,
      skipLines: 0,
    }, {
      onSuccess: (res) => setResult(res),
    });
  };

  const canExecute = parseResult != null && columnMapping['date'] != null && columnMapping['close'] != null;
  const headers = parseResult?.headers ?? [];

  const resetAndClose = () => {
    setParseResult(null);
    setResult(null);
    setColumnMapping({});
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) resetAndClose(); else setOpen(true); }}>
      <DialogTrigger asChild>
        <Button type="button" size="sm" variant="outline">
          {t('prices.title')}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl h-[min(85vh,540px)] flex flex-col">
        <DialogHeader className="shrink-0">
          <DialogTitle>{t('prices.title')} — {securityName}</DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto min-h-0">
        {result ? (
          <div className="space-y-4">
            <Alert>
              <AlertDescription>
                {t('prices.success', { inserted: result.inserted, skipped: result.skipped })}
              </AlertDescription>
            </Alert>
            {result.dateRange.from && (
              <p className="text-sm text-muted-foreground">
                {t('prices.dateRange')}: {result.dateRange.from} — {result.dateRange.to}
              </p>
            )}
            <Button onClick={resetAndClose}>{t('nav.close', 'Close')}</Button>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-6">
            {/* Left: file + config */}
            <div className="space-y-4">
              {/* Dropzone */}
              <div
                className="border-2 border-dashed rounded-lg p-6 text-center cursor-pointer hover:border-primary transition-colors"
                onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
                onDragOver={(e) => e.preventDefault()}
                onClick={() => document.getElementById('csv-price-input')?.click()}
              >
                <input
                  id="csv-price-input"
                  type="file"
                  accept=".csv"
                  className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
                />
                <p className="text-sm text-muted-foreground">{t('prices.dropzone')}</p>
              </div>

              {/* Column mapping */}
              {parseResult && (
                <div className="space-y-3">
                  <Label className="font-medium">{t('prices.columnMapping')}</Label>
                  {(['date', 'close', 'high', 'low', 'volume'] as const).map((field) => (
                    <div key={field} className="flex items-center gap-2">
                      <span className="text-sm w-16 capitalize">{field}{field === 'date' || field === 'close' ? ' *' : ''}</span>
                      <Select
                        value={columnMapping[field] != null ? String(columnMapping[field]) : '__none'}
                        onValueChange={(v) => {
                          setColumnMapping((prev) => {
                            const next = { ...prev };
                            if (v === '__none') delete next[field];
                            else next[field] = parseInt(v, 10); // native-ok
                            return next;
                          });
                        }}
                      >
                        <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none">—</SelectItem>
                          {headers.map((h, i) => (
                            <SelectItem key={i} value={String(i)}>{h}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ))}
                </div>
              )}

              {/* Format settings */}
              <div className="space-y-3">
                <Label className="font-medium">{t('prices.formatSettings')}</Label>
                <div className="grid grid-cols-2 gap-14 items-end">
                  <div>
                    <Label className="text-xs">{t('upload.dateFormat')}</Label>
                    <Select value={dateFormat} onValueChange={setDateFormat}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {csvDateFormats.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">{t('upload.decimalSeparator')}</Label>
                    <Select value={decimalSeparator} onValueChange={(v) => setDecimalSeparator(v as '.' | ',')}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value=".">.</SelectItem>
                        <SelectItem value=",">,</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
            </div>

            {/* Right: summary */}
            <div className="space-y-4">
              <Label className="font-medium">{t('prices.summary')}</Label>
              {parseResult ? (
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{t('prices.totalRows')}</span>
                    <span>{parseResult.totalRows}</span>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">{t('upload.noFile')}</p>
              )}

              <Button
                onClick={handleExecute}
                disabled={!canExecute || executeMutation.isPending}
                className="w-full"
              >
                {executeMutation.isPending
                  ? t('prices.importing')
                  : t('prices.confirm', { count: parseResult?.totalRows ?? 0 })}
              </Button>
            </div>
          </div>
        )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
