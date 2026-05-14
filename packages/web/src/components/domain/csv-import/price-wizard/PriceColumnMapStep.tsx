import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { csvDateFormats } from '@quovibe/shared';
import {
  PRICE_COLUMN_KEYS,
  type PriceColumnKey,
  type PriceColumnMapping,
  type PriceWizardState,
} from '@/pages/price-import-wizard.utils';

interface Props {
  state: PriceWizardState;
  onColumnMappingChange: (mapping: PriceColumnMapping) => void;
  onFormatChange: (patch: {
    dateFormat?: string;
    decimalSeparator?: '.' | ',';
    thousandSeparator?: '' | '.' | ',' | ' ';
  }) => void;
  onBack: () => void;
  onNext: () => void;
}

const REQUIRED_FIELDS: ReadonlyArray<PriceColumnKey> = ['date', 'close'];

export function PriceColumnMapStep({
  state,
  onColumnMappingChange,
  onFormatChange,
  onBack,
  onNext,
}: Props) {
  const { t } = useTranslation('csv-import');
  const headers = state.parseResult?.headers ?? [];

  const canProceed =
    state.columnMapping.date != null && state.columnMapping.close != null;

  function setField(field: PriceColumnKey, value: string) {
    const next: PriceColumnMapping = { ...state.columnMapping };
    if (value === '__unmapped') delete next[field];
    else next[field] = parseInt(value, 10); // native-ok
    onColumnMappingChange(next);
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="rounded-md">
          <CardHeader>
            <CardTitle>{t('prices.columnMapping')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {PRICE_COLUMN_KEYS.map((field) => {
              const required = REQUIRED_FIELDS.includes(field);
              return (
                <div key={field} className="flex items-center gap-2">
                  <span className="text-sm w-16 capitalize">
                    {field}
                    {required ? ' *' : ''}
                  </span>
                  <Select
                    value={
                      state.columnMapping[field] != null
                        ? String(state.columnMapping[field])
                        : '__unmapped'
                    }
                    onValueChange={(v) => setField(field, v)}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none">{t('columns.unmapped')}</SelectItem>
                      {headers.map((h, i) => (
                        <SelectItem key={i} value={String(i)}>
                          {h}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              );
            })}
          </CardContent>
        </Card>

        <Card className="rounded-md">
          <CardHeader>
            <CardTitle>{t('prices.formatSettings')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label>{t('upload.dateFormat')}</Label>
              <Select
                value={state.dateFormat}
                onValueChange={(v) => onFormatChange({ dateFormat: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {csvDateFormats.map((f) => (
                    <SelectItem key={f} value={f}>
                      {f}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>{t('upload.decimalSeparator')}</Label>
              <Select
                value={state.decimalSeparator}
                onValueChange={(v) =>
                  onFormatChange({ decimalSeparator: v as '.' | ',' })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value=".">. (dot)</SelectItem>
                  <SelectItem value=",">, (comma)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>{t('upload.thousandSeparator')}</Label>
              <Select
                value={state.thousandSeparator || 'none'}
                onValueChange={(v) =>
                  onFormatChange({
                    thousandSeparator: (v === 'none' ? '' : v) as '' | '.' | ',' | ' ',
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t('upload.thousandNone')}</SelectItem>
                  <SelectItem value=".">. (dot)</SelectItem>
                  <SelectItem value=",">, (comma)</SelectItem>
                  <SelectItem value=" ">{t('upload.thousandSpace')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>
      </div>

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
