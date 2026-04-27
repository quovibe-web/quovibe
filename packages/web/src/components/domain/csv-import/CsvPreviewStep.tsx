// packages/web/src/components/domain/csv-import/CsvPreviewStep.tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useExecuteCsvTrades, useCreateCsvConfig } from '@/api/use-csv-import';
import { usePortfolio } from '@/context/PortfolioContext';
import type { WizardState } from '@/pages/CsvImportPage';
import type { TradeExecuteResult, CsvErrorCode } from '@quovibe/shared';

// Maps RowError codes (emitted by packages/api/src/services/csv/*) to the
// csv-import:errors.* i18n keys. The server's `message` field is an historical
// i18n path string (e.g. "csvImport.errors.missingSecurity") that doesn't
// resolve against any namespace on the client — we translate by `code` instead
// (BUG-99). Keep the mapping aligned with `csvErrorCodes` in
// packages/shared/src/csv/csv-types.ts.
const ROW_ERROR_I18N: Partial<Record<CsvErrorCode, string>> = {
  INVALID_DATE: 'errors.invalidDate',
  INVALID_NUMBER: 'errors.invalidNumber',
  UNKNOWN_TYPE: 'errors.unknownType',
  INVALID_PRICE: 'errors.invalidPrice',
  MISSING_SECURITY: 'errors.missingSecurity',
  MISSING_SHARES: 'errors.missingShares',
  MISSING_CROSS_ACCOUNT: 'errors.missingCrossAccount',
  FX_RATE_REQUIRED: 'errors.fxRateRequired',
  INVALID_FX_RATE: 'errors.invalidFxRate',
  FX_VERIFICATION_FAILED: 'errors.fxVerificationFailed',
  CURRENCY_MISMATCH: 'errors.currencyMismatch',
  INSUFFICIENT_SHARES: 'errors.insufficientShares',
};

interface Props {
  state: WizardState;
  onBack: () => void;
}

// Maps server-side CsvImportError codes (thrown by apiFetch as Error.message)
// to i18n keys. Keep the code-list aligned with .claude/rules/csv-import.md.
function mapExecuteError(message: string): string {
  switch (message) {
    case 'INVALID_SECURITIES_ACCOUNT': return 'errors.invalidSecuritiesAccount';
    case 'NO_REFERENCE_ACCOUNT': return 'errors.noReferenceAccount';
    case 'TEMP_FILE_EXPIRED': return 'errors.tempExpired';
    case 'IMPORT_IN_PROGRESS': return 'errors.importInProgress';
    case 'FX_RATE_REQUIRED': return 'errors.fxRateRequired';
    case 'INSUFFICIENT_SHARES': return 'errors.insufficientShares';
    default: return 'errors.importFailed';
  }
}

export function CsvPreviewStep({ state, onBack }: Props) {
  const { t } = useTranslation('csv-import');
  const navigate = useNavigate();
  const portfolio = usePortfolio();
  const executeMutation = useExecuteCsvTrades();
  const createConfig = useCreateCsvConfig();

  const preview = state.previewResult;
  const [excludedRows, setExcludedRows] = useState<Set<number>>(new Set());
  const [saveConfig, setSaveConfig] = useState(false);
  const [configName, setConfigName] = useState('');
  const [result, setResult] = useState<TradeExecuteResult | null>(null);

  // Defence-in-depth: if we somehow reach Step 4 without a preview (e.g. state
  // corruption or future routing change), show a readable fallback instead of
  // the silent blank that masked BUG-52. Under the normal flow,
  // CsvSecurityMatchStep now disables Next when the preview mutation fails,
  // so this branch should be unreachable via the UI.
  if (!preview) {
    return (
      <div className="space-y-6">
        <Alert variant="destructive" role="alert">
          <AlertDescription className="flex items-start justify-between gap-4">
            <span>{t('errors.previewFailed')}</span>
            <Button size="sm" variant="outline" onClick={onBack}>
              {t('nav.back')}
            </Button>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const validRows = preview.rows.filter((r) => !r.error);
  const selectedCount = validRows.filter((r) => !excludedRows.has(r.rowNumber)).length;

  const toggleRow = (rowNumber: number) => {
    setExcludedRows((prev) => {
      const next = new Set(prev);
      if (next.has(rowNumber)) next.delete(rowNumber);
      else next.add(rowNumber);
      return next;
    });
  };

  const handleImport = () => {
    if (!state.targetSecuritiesAccountId) return; // gated by Next-button on Step 3
    executeMutation.mutate({
      tempFileId: state.parseResult!.tempFileId,
      config: {
        delimiter: state.delimiter,
        columnMapping: state.columnMapping,
        dateFormat: state.dateFormat,
        decimalSeparator: state.decimalSeparator,
        thousandSeparator: state.thousandSeparator,
      },
      targetSecuritiesAccountId: state.targetSecuritiesAccountId,
      securityMapping: state.securityMapping,
      newSecurities: state.newSecurities,
      excludedRows: Array.from(excludedRows),
    }, {
      onSuccess: (res) => {
        setResult(res);
        if (saveConfig && configName) {
          createConfig.mutate({
            name: configName,
            type: 'TRADES',
            delimiter: state.delimiter,
            encoding: state.encoding as 'utf-8',
            skipLines: 0,
            dateFormat: state.dateFormat,
            decimalSeparator: state.decimalSeparator,
            thousandSeparator: state.thousandSeparator,
            columnMapping: state.columnMapping,
          });
        }
      },
    });
  };

  // Success state
  if (result) {
    return (
      <div className="space-y-6">
        <Alert>
          <AlertDescription className="space-y-1">
            <p className="font-medium">{t('result.success')}</p>
            <p>{t('result.transactions', { count: result.created.transactions })}</p>
            {result.created.securities > 0 && (
              <p>{t('result.securities', { count: result.created.securities })}</p>
            )}
            {result.errors.length > 0 && (
              <p className="text-destructive">{t('result.errors', { count: result.errors.length })}</p>
            )}
          </AlertDescription>
        </Alert>
        <Button onClick={() => navigate(`/p/${portfolio.id}/transactions`)}>
          {t('nav.viewTransactions', 'View Transactions')}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-4 text-center">
            <div className="text-2xl font-bold">{preview.summary.valid}</div>
            <div className="text-sm text-muted-foreground">{t('preview.valid')}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <div className="text-2xl font-bold text-destructive">{preview.summary.errors}</div>
            <div className="text-sm text-muted-foreground">{t('preview.errorCount')}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-sm font-medium mb-2">{t('preview.byType')}</div>
            {Object.entries(preview.summary.byType).map(([type, count]) => (
              <div key={type} className="flex justify-between text-sm">
                <span>{type}</span>
                <span>{count}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* Errors */}
      {preview.errors.length > 0 && (
        <Card>
          <CardHeader><CardTitle>{t('preview.errors')}</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {preview.errors.map((err, i) => {
                const i18nKey = ROW_ERROR_I18N[err.code];
                const translated = i18nKey
                  ? t(i18nKey, { value: err.value ?? '', field: err.column ?? '' })
                  : err.code;
                return (
                  <div key={i} className="text-sm text-destructive">
                    {t('preview.rowErrorPrefix', { row: err.row })}
                    {err.column ? ` [${err.column}] ` : ' '}{translated}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Row table */}
      <Card>
        <CardContent className="pt-4">
          <div className="overflow-x-auto max-h-96">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-background">
                <tr className="border-b">
                  <th className="px-2 py-2 w-8"></th>
                  <th className="px-2 py-2 text-left">#</th>
                  <th className="px-2 py-2 text-left">{t('columns.field.date')}</th>
                  <th className="px-2 py-2 text-left">{t('columns.field.type')}</th>
                  <th className="px-2 py-2 text-left">{t('columns.field.security')}</th>
                  <th className="px-2 py-2 text-right">{t('columns.field.shares')}</th>
                  <th className="px-2 py-2 text-right">{t('columns.field.amount')}</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row) => {
                  const hasError = !!row.error;
                  const excluded = excludedRows.has(row.rowNumber);
                  return (
                    <tr
                      key={row.rowNumber}
                      className={`border-b ${hasError ? 'bg-destructive/5' : ''} ${excluded ? 'opacity-40' : ''}`}
                    >
                      <td className="px-2 py-1">
                        {!hasError && (
                          <Checkbox
                            checked={!excluded}
                            onCheckedChange={() => toggleRow(row.rowNumber)}
                          />
                        )}
                      </td>
                      <td className="px-2 py-1 text-muted-foreground">{row.rowNumber}</td>
                      <td className="px-2 py-1">{row.date}</td>
                      <td className="px-2 py-1">{row.type}</td>
                      <td className="px-2 py-1">{row.securityName}</td>
                      <td className="px-2 py-1 text-right">{row.shares ?? '-'}</td>
                      <td className="px-2 py-1 text-right">{row.amount}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Save config */}
      <div className="flex items-center gap-4">
        <Checkbox
          checked={saveConfig}
          onCheckedChange={(v) => setSaveConfig(!!v)}
          id="save-config"
        />
        <Label htmlFor="save-config">{t('preview.saveConfig')}</Label>
        {saveConfig && (
          <Input
            value={configName}
            onChange={(e) => setConfigName(e.target.value)}
            placeholder={t('preview.configName')}
            className="w-60"
          />
        )}
      </div>

      {/* Execute-mutation error (surfaced inline in addition to the global toast) */}
      {executeMutation.isError && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>
            {t(mapExecuteError(executeMutation.error?.message ?? ''))}
          </AlertDescription>
        </Alert>
      )}

      {/* Navigation */}
      <div className="flex justify-between">
        <Button variant="outline" onClick={onBack}>{t('nav.back')}</Button>
        <Button
          onClick={handleImport}
          disabled={selectedCount === 0 || executeMutation.isPending}
        >
          {executeMutation.isPending
            ? t('preview.importing')
            : t('preview.confirm', { count: selectedCount })}
        </Button>
      </div>
    </div>
  );
}
