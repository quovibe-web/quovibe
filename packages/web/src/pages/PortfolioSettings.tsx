// packages/web/src/pages/PortfolioSettings.tsx
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { Check, Eye, EyeOff } from 'lucide-react';
import { usePortfolioRegistry } from '@/api/use-portfolios';
import { usePortfolio as usePortfolioCtx } from '@/context/PortfolioContext';
import { usePortfolio, useUpdatePortfolioDbSettings } from '@/api/use-portfolio';
import { RenamePortfolioDialog } from '@/components/domain/RenamePortfolioDialog';
import { DeletePortfolioDialog } from '@/components/domain/DeletePortfolioDialog';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { CURRENCIES } from '@/lib/currencies';
import { CostMethod, getAllCalendarInfos, type UpdateSettingsInput } from '@quovibe/shared';

function SettingRow({
  label,
  description,
  children,
  saved,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
  saved?: boolean;
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 py-3.5 border-b border-border last:border-b-0">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{label}</span>
          {saved && (
            <span className="text-xs text-[var(--qv-success)] flex items-center gap-0.5 animate-in fade-in duration-300">
              <Check className="h-3 w-3" />
            </span>
          )}
        </div>
        {description && <p className="text-xs text-muted-foreground mt-0.5">{description}</p>}
      </div>
      <div className="sm:ml-4 shrink-0">{children}</div>
    </div>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mt-8 first:mt-0 mb-1">
      {children}
    </h3>
  );
}

export default function PortfolioSettings() {
  useDocumentTitle('Settings');
  const { t } = useTranslation('portfolioSettings');
  const { portfolioId } = useParams<{ portfolioId: string }>();
  const portfolio = usePortfolioCtx();
  const registry = usePortfolioRegistry();
  const { data: portfolioData } = usePortfolio();
  const updateSettings = useUpdatePortfolioDbSettings();
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const [costMethod, setCostMethod] = useState<string>('');
  const [currency, setCurrency] = useState<string>('');
  const [calendar, setCalendar] = useState<string>('');
  const [avKey, setAvKey] = useState<string>('');
  const [avRate, setAvRate] = useState<string>('');
  const [showKey, setShowKey] = useState(false);
  const [savedField, setSavedField] = useState<string | null>(null);

  // Seed local state once per portfolio. Re-seeding on every portfolioData
  // refetch would clobber in-flight edits in the free-text inputs.
  const seededForPid = useRef<string | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!portfolioData || !portfolioId || seededForPid.current === portfolioId) return;
    const cfg = portfolioData.config;
    setCostMethod(cfg['portfolio.costMethod'] ?? CostMethod.MOVING_AVERAGE);
    setCurrency(cfg['portfolio.currency'] ?? cfg['baseCurrency'] ?? 'EUR');
    setCalendar(cfg['portfolio.calendar'] ?? '');
    setAvRate(cfg['provider.alphavantage.rateLimit'] ?? '');
    seededForPid.current = portfolioId;
  }, [portfolioData, portfolioId]);

  useEffect(() => () => {
    if (flashTimer.current) clearTimeout(flashTimer.current);
  }, []);

  const hasKeyConfigured = portfolioData?.config['hasAlphaVantageApiKey'] === 'true';

  function flashSaved(field: string): void {
    if (flashTimer.current) clearTimeout(flashTimer.current);
    setSavedField(field);
    flashTimer.current = setTimeout(() => {
      setSavedField((prev) => (prev === field ? null : prev));
      flashTimer.current = null;
    }, 2000);
  }

  async function save(field: string, input: UpdateSettingsInput): Promise<void> {
    await updateSettings.mutateAsync(input);
    flashSaved(field);
  }

  const entry = registry.data?.portfolios.find((p) => p.id === portfolioId);
  if (!entry) return <div />;

  const onExport = (): void => {
    window.location.assign(`/api/portfolios/${entry.id}/export`);
  };
  const onUpdatePrices = async (): Promise<void> => {
    await fetch(`/api/p/${entry.id}/prices/fetch-all`, { method: 'POST' });
  };

  if (portfolio.kind === 'demo') {
    return (
      <main className="mx-auto max-w-2xl p-6">
        <h1 className="text-xl font-semibold">{t('current')}</h1>
        <p className="mt-2 font-medium">
          {entry.name} · {t('builtInPlayground')}
        </p>
        <p className="mt-4 text-sm text-muted-foreground">{t('demoExplainer')}</p>
        <div className="mt-6 flex gap-3">
          <Button onClick={onExport}>📤 {t('export')}</Button>
        </div>
        <h2 className="mt-10 text-lg font-semibold">{t('updates')}</h2>
        <Button className="mt-2" variant="outline" onClick={onUpdatePrices}>
          ⬇ {t('updatePrices')}
        </Button>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl p-6">
      <h1 className="text-xl font-semibold">{t('current')}</h1>
      <p className="mt-2 font-medium">
        {entry.name} · {t('real')} · {t('createdOn', { date: entry.createdAt.slice(0, 10) })}
      </p>
      <div className="mt-6 flex flex-wrap gap-3">
        <Button variant="outline" onClick={() => setRenameOpen(true)}>
          ✏️ {t('rename.cta')}
        </Button>
        <Button variant="outline" onClick={onExport}>
          📤 {t('export')}
        </Button>
        <Button variant="destructive" onClick={() => setDeleteOpen(true)}>
          🗑 {t('delete.cta')}
        </Button>
      </div>

      <SectionHeader>{t('data.sections.accounting')}</SectionHeader>
      <SettingRow
        label={t('data.fields.costMethod')}
        description={t('data.fields.costMethodDescription')}
        saved={savedField === 'costMethod'}
      >
        <Select
          value={costMethod}
          onValueChange={(v) => {
            setCostMethod(v);
            void save('costMethod', { costMethod: v as typeof CostMethod[keyof typeof CostMethod] });
          }}
        >
          <SelectTrigger className="w-[200px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={CostMethod.FIFO}>{t('data.fields.costMethodFifo')}</SelectItem>
            <SelectItem value={CostMethod.MOVING_AVERAGE}>
              {t('data.fields.costMethodMovingAverage')}
            </SelectItem>
          </SelectContent>
        </Select>
      </SettingRow>
      <SettingRow
        label={t('data.fields.currency')}
        description={t('data.fields.currencyDescription')}
        saved={savedField === 'currency'}
      >
        <Select
          value={currency}
          onValueChange={(v) => {
            setCurrency(v);
            void save('currency', { currency: v });
          }}
        >
          <SelectTrigger className="w-[200px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CURRENCIES.map((c) => (
              <SelectItem key={c.code} value={c.code}>
                {c.code} — {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingRow>
      <SettingRow
        label={t('data.fields.calendar')}
        description={t('data.fields.calendarDescription')}
        saved={savedField === 'calendar'}
      >
        <Select
          value={calendar === '' ? '__none' : calendar}
          onValueChange={(v) => {
            const next = v === '__none' ? '' : v;
            setCalendar(next);
            void save('calendar', { calendar: next });
          }}
        >
          <SelectTrigger className="w-[200px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none">{t('data.fields.calendarDefault')}</SelectItem>
            {calendar !== '' && !getAllCalendarInfos().some((c) => c.id === calendar) && (
              <SelectItem value={calendar} disabled>
                {`${calendar} (${t('data.fields.calendarUnknown')})`}
              </SelectItem>
            )}
            {getAllCalendarInfos()
              .filter((c) => c.id !== 'empty' && c.id !== 'default')
              .map((cal) => (
                <SelectItem key={cal.id} value={cal.id}>{cal.label}</SelectItem>
              ))}
          </SelectContent>
        </Select>
      </SettingRow>

      <SectionHeader>{t('data.sections.priceFeeds')}</SectionHeader>
      <SettingRow
        label={t('data.fields.alphaVantageApiKey')}
        description={
          hasKeyConfigured
            ? t('data.fields.alphaVantageApiKeyConfigured')
            : t('data.fields.alphaVantageApiKeyDescription')
        }
        saved={savedField === 'alphaVantageApiKey'}
      >
        <div className="flex items-center gap-1 w-[240px]">
          <Input
            type={showKey ? 'text' : 'password'}
            value={avKey}
            onChange={(e) => setAvKey(e.target.value)}
            onBlur={() => {
              if (avKey.length > 0) {
                void save('alphaVantageApiKey', { alphaVantageApiKey: avKey });
                setAvKey('');
              }
            }}
            placeholder={hasKeyConfigured ? '••••••••' : t('data.fields.alphaVantageApiKeyPlaceholder')}
            className="flex-1"
            autoComplete="off"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={() => setShowKey((v) => !v)}
            aria-label={showKey ? t('data.fields.alphaVantageApiKeyHide') : t('data.fields.alphaVantageApiKeyShow')}
          >
            {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </Button>
        </div>
      </SettingRow>
      <SettingRow
        label={t('data.fields.alphaVantageRateLimit')}
        description={t('data.fields.alphaVantageRateLimitDescription')}
        saved={savedField === 'alphaVantageRateLimit'}
      >
        <Input
          type="number"
          min={1}
          value={avRate}
          onChange={(e) => setAvRate(e.target.value)}
          onBlur={() => {
            if (avRate !== (portfolioData?.config['provider.alphavantage.rateLimit'] ?? '')) {
              void save('alphaVantageRateLimit', { alphaVantageRateLimit: avRate });
            }
          }}
          className="w-[120px]"
        />
      </SettingRow>

      <h2 className="mt-10 text-lg font-semibold">{t('updates')}</h2>
      <Button className="mt-2" variant="outline" onClick={onUpdatePrices}>
        ⬇ {t('updatePrices')}
      </Button>

      <RenamePortfolioDialog
        open={renameOpen}
        onOpenChange={setRenameOpen}
        id={entry.id}
        currentName={entry.name}
      />
      <DeletePortfolioDialog open={deleteOpen} onOpenChange={setDeleteOpen} id={entry.id} name={entry.name} />
    </main>
  );
}
