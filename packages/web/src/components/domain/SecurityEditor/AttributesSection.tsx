import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAttributeTypes } from '@/api/use-attribute-types';
import { useResolveLogo } from '@/api/use-logo';
import { resolveErrorMessage } from '@/api/query-client';
import { resizeToPng } from '@/lib/image-utils';
import { SectionHeader } from './SectionHeader';
import { AttributeTypeFormDialog } from './AttributeTypeFormDialog';
import type { SecurityAttribute, AttributeTypeItem } from '@/api/types';

// Only `logo` is hidden — it has a dedicated upload/fetch field rendered above
// the picker. All other PP-defined attribute types (aum/ter/etc.) appear in the
// picker and are fully user-editable per PP parity.
const HIDDEN_ATTRIBUTE_TYPE_IDS = new Set(['logo']);

function ImageField({
  attr, onUpdate, onFetchLogo,
}: {
  attr: SecurityAttribute;
  onUpdate: (typeId: string, value: string) => void;
  onFetchLogo?: () => Promise<void>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isFetching, setIsFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const { t } = useTranslation('securities');
  const { t: tCommon } = useTranslation('common');
  const hasImage = attr.value.startsWith('data:image');

  async function handleFetch() {
    if (!onFetchLogo) return;
    setIsFetching(true);
    setFetchError(null);
    try {
      await onFetchLogo();
    } catch (err) {
      setFetchError(resolveErrorMessage(err));
    } finally {
      setIsFetching(false);
    }
  }

  return (
    <div className="flex flex-col gap-1 flex-1">
      <div className="flex items-center gap-2">
        {hasImage ? (
          <img src={attr.value} alt={attr.typeName ?? ''} className="h-10 w-10 rounded-md object-contain border bg-muted" />
        ) : (
          <div className="h-10 w-10 rounded-md border bg-muted flex items-center justify-center text-muted-foreground text-xs">?</div>
        )}
        <button
          type="button"
          className="text-xs text-muted-foreground hover:text-foreground cursor-pointer"
          onClick={() => setTimeout(() => inputRef.current?.click(), 0)}
        >
          {hasImage ? t('attributes.change') : t('attributes.upload')}
        </button>
        {onFetchLogo && (
          <button
            type="button"
            disabled={isFetching}
            className="text-xs text-muted-foreground hover:text-foreground cursor-pointer disabled:opacity-50"
            onClick={handleFetch}
          >
            {isFetching ? t('attributes.fetchingLogo') : t('attributes.fetchLogo')}
          </button>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={async e => {
            const file = e.target.files?.[0];
            if (!file) return;
            try {
              const dataUrl = await resizeToPng(file);
              onUpdate(attr.typeId, dataUrl);
            } catch {
              toast.error(tCommon('toasts.imageTooLarge'));
            }
          }}
        />
      </div>
      {fetchError && <p className="text-xs text-destructive">{fetchError}</p>}
    </div>
  );
}

function PercentageField({ value, onUpdate }: { value: string; onUpdate: (v: string) => void }) {
  const toDisplay = (decimal: string) => {
    const n = parseFloat(decimal);
    if (isNaN(n)) return '';
    return (n * 100).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 4 });
  };

  const [display, setDisplay] = useState(() => toDisplay(value));
  useEffect(() => { setDisplay(toDisplay(value)); }, [value]);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value;
    setDisplay(raw);
    const normalized = raw.replace(/\./g, '').replace(',', '.');
    const n = parseFloat(normalized);
    if (!isNaN(n)) onUpdate((n / 100).toString());
  }

  return (
    <div className="flex items-center gap-1 flex-1">
      <Input value={display} onChange={handleChange} className="flex-1 text-sm text-right" placeholder="0" />
      <span className="text-sm text-muted-foreground shrink-0">%</span>
    </div>
  );
}

interface Props {
  attributes: SecurityAttribute[];
  onChange: (attributes: SecurityAttribute[]) => void;
  ticker?: string;
}

export function AttributesSection({ attributes, onChange, ticker }: Props) {
  const { t } = useTranslation('securities');
  const { data: types = [] } = useAttributeTypes();
  const resolveLogoMutation = useResolveLogo();

  const [pickerValue, setPickerValue] = useState('');
  const [editingType, setEditingType] = useState<AttributeTypeItem | null>(null);

  const logoAttr: SecurityAttribute = attributes.find(a => a.typeId === 'logo')
    ?? { typeId: 'logo', typeName: 'Logo', value: '' };
  const otherAttributes = attributes.filter(a => a.typeId !== 'logo');

  const usedTypeIds = new Set(attributes.map(a => a.typeId));
  const availableTypes = types.filter(
    tp => !HIDDEN_ATTRIBUTE_TYPE_IDS.has(tp.id) && !usedTypeIds.has(tp.id),
  );
  const typeById = new Map(types.map(tp => [tp.id, tp]));

  function handlePickerChange(value: string) {
    setPickerValue(value);
    const type = typeById.get(value);
    if (!type) return;
    onChange([...attributes, { typeId: type.id, typeName: type.name, value: '' }]);
    setPickerValue('');
  }

  function updateValue(typeId: string, value: string) {
    const exists = attributes.some(a => a.typeId === typeId);
    if (exists) {
      onChange(attributes.map(a => a.typeId === typeId ? { ...a, value } : a));
    } else {
      onChange([...attributes, { typeId, typeName: typeId === 'logo' ? 'Logo' : typeId, value }]);
    }
  }

  function removeFromSecurity(typeId: string) {
    onChange(attributes.filter(a => a.typeId !== typeId));
  }

  const onFetchLogo = ticker
    ? async () => {
        const { logoUrl } = await resolveLogoMutation.mutateAsync({ ticker });
        updateValue('logo', logoUrl);
      }
    : undefined;

  return (
    <div>
      <SectionHeader title={t('securityEditor.attributes')} id="section-attributes" />
      <div className="space-y-3 py-3">
        {/* Logo — always visible */}
        <div className="flex items-center gap-2">
          <span className="text-sm w-32 shrink-0 font-medium">{t('attributes.logo')}</span>
          <ImageField attr={logoAttr} onUpdate={updateValue} onFetchLogo={onFetchLogo} />
        </div>

        {otherAttributes.map(attr => {
          const attrTypeDef = typeById.get(attr.typeId);
          const isImage = attrTypeDef?.converterClass?.includes('ImageConverter') ?? false;
          const isPercentage = attrTypeDef?.type === 'java.lang.Double' && attrTypeDef?.converterClass?.includes('PercentConverter');
          return (
            <div key={attr.typeId} className="flex items-center gap-2">
              <span className="text-sm w-32 shrink-0 font-medium">{attr.typeName}</span>
              {isImage ? (
                <ImageField attr={attr} onUpdate={updateValue} />
              ) : isPercentage ? (
                <PercentageField value={attr.value} onUpdate={v => updateValue(attr.typeId, v)} />
              ) : (
                <Input
                  value={attr.value}
                  onChange={e => updateValue(attr.typeId, e.target.value)}
                  className="flex-1 text-sm"
                />
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 text-muted-foreground"
                    aria-label={t('attributeType.menu.aria')}
                  >
                    ⋮
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {attrTypeDef && (
                    <DropdownMenuItem onSelect={() => setEditingType(attrTypeDef)}>
                      {t('attributeType.menu.rename')}
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem onSelect={() => removeFromSecurity(attr.typeId)}>
                    {t('attributeType.menu.removeFromSec')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          );
        })}

        {availableTypes.length > 0 && (
          <div className="flex items-center gap-2 pt-2 border-t">
            <Select value={pickerValue} onValueChange={handlePickerChange}>
              <SelectTrigger className="flex-1">
                <SelectValue placeholder={t('securityEditor.addAttribute')} />
              </SelectTrigger>
              <SelectContent>
                {availableTypes.map(tp => (
                  <SelectItem key={tp.id} value={tp.id}>{tp.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      {editingType && (
        <AttributeTypeFormDialog
          open
          onOpenChange={open => { if (!open) setEditingType(null); }}
          type={editingType}
        />
      )}
    </div>
  );
}
