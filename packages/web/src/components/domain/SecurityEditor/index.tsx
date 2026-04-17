import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from '@/components/ui/sheet';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { useSecurityDetail } from '@/api/use-securities';
import { useScopedApi } from '@/api/use-scoped-api';
import { getSecurityCompleteness } from '@/lib/security-completeness';
import type { SecurityAttribute, TaxonomyAssignment } from '@/api/types';
import { MasterDataSection, type MasterDataValues } from './MasterDataSection';
import { PriceFeedSection, type PriceFeedValues } from './PriceFeedSection';
import { AttributesSection } from './AttributesSection';
import { TaxonomiesSection } from './TaxonomiesSection';

export type EditorSection = 'masterData' | 'priceFeed' | 'attributes' | 'taxonomies';

interface SecurityEditorProps {
  mode: 'create' | 'edit';
  securityId?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (id: string) => void;
  initialSection?: EditorSection;
}

const DEFAULT_MASTER: MasterDataValues = {
  name: '', isin: '', ticker: '', wkn: '', currency: 'EUR',
  calendar: '', isRetired: false, note: '',
};

const DEFAULT_FEED: PriceFeedValues = {
  feed: '', feedUrl: '', pathToDate: '$[*].date', pathToClose: '$[*].close',
  latestFeed: '', latestFeedUrl: '',
};

export function SecurityEditor({
  mode, securityId, open, onOpenChange, onCreated, initialSection,
}: SecurityEditorProps) {
  const { t } = useTranslation('securities');
  const qc = useQueryClient();
  const api = useScopedApi();

  const { data: detail } = useSecurityDetail(
    mode === 'edit' && securityId ? securityId : '',
  );

  // Stable initial values: only recomputes when API data loads, NOT on every keystroke.
  // This prevents the defaultValues → form.reset → onChange → setMasterData → loop.
  const initialMaster = useMemo<MasterDataValues>(() => {
    if (mode === 'edit' && detail) {
      return {
        name: detail.name ?? '',
        isin: detail.isin ?? '',
        ticker: detail.ticker ?? '',
        wkn: detail.wkn ?? '',
        currency: detail.currency ?? 'EUR',
        calendar: detail.calendar ?? '',
        isRetired: detail.isRetired ?? false,
        note: detail.note ?? '',
      };
    }
    return DEFAULT_MASTER;
  }, [mode, detail]);

  const [masterData, setMasterData] = useState<MasterDataValues>(DEFAULT_MASTER);
  const [feedData, setFeedData] = useState<PriceFeedValues>(DEFAULT_FEED);
  const [attributes, setAttributes] = useState<SecurityAttribute[]>([]);
  const [taxonomyAssignments, setTaxonomyAssignments] = useState<TaxonomyAssignment[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);

  // Populate from detail when open
  useEffect(() => {
    if (!open) return;
    if (mode === 'edit' && detail) {
      setMasterData({
        name: detail.name ?? '',
        isin: detail.isin ?? '',
        ticker: detail.ticker ?? '',
        wkn: detail.wkn ?? '',
        currency: detail.currency ?? 'EUR',
        calendar: detail.calendar ?? '',
        isRetired: detail.isRetired ?? false,
        note: detail.note ?? '',
      });
      setFeedData({
        feed: detail.feed ?? '',
        feedUrl: detail.feedUrl ?? '',
        pathToDate: detail.feedProperties?.['GENERIC-JSON-DATE'] ?? '$[*].date',
        pathToClose: detail.feedProperties?.['GENERIC-JSON-CLOSE'] ?? '$[*].close',
        latestFeed: detail.latestFeed ?? '',
        latestFeedUrl: detail.latestFeedUrl ?? '',
      });
      setAttributes(detail.attributes ?? []);
      setTaxonomyAssignments(detail.taxonomyAssignments ?? []);
      setIsDirty(false);
      setError(null);
    } else if (mode === 'create') {
      setMasterData(DEFAULT_MASTER);
      setFeedData(DEFAULT_FEED);
      setAttributes([]);
      setTaxonomyAssignments([]);
      setIsDirty(false);
      setError(null);
    }
  }, [open, detail, mode]);

  // Scroll to initial section when opened
  useEffect(() => {
    if (!open || !initialSection) return;
    const sectionMap: Record<EditorSection, string> = {
      masterData: 'section-master-data',
      priceFeed: 'section-price-feed',
      attributes: 'section-attributes',
      taxonomies: 'section-taxonomies',
    };
    const el = document.getElementById(sectionMap[initialSection]);
    if (el) {
      requestAnimationFrame(() => el.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    }
  }, [open, initialSection]);

  // Handle close with dirty check
  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen && isDirty) {
      setShowUnsavedDialog(true);
      return;
    }
    onOpenChange(nextOpen);
  }

  const handleMasterChange = useCallback((values: MasterDataValues, dirty: boolean) => {
    setMasterData(values);
    if (dirty) setIsDirty(true);
  }, []);

  function handleFeedChange(patch: Partial<PriceFeedValues>) {
    setFeedData(prev => ({ ...prev, ...patch }));
    setIsDirty(true);
  }

  function handleAttributesChange(attrs: SecurityAttribute[]) {
    setAttributes(attrs);
    setIsDirty(true);
  }

  function handleTaxonomyChange(assignments: TaxonomyAssignment[]) {
    setTaxonomyAssignments(assignments);
    setIsDirty(true);
  }

  async function handleSave() {
    if (!masterData.name.trim()) {
      setError(t('securityEditor.nameRequired'));
      return;
    }
    if (!masterData.currency.trim()) {
      setError(t('securityEditor.currencyRequired'));
      return;
    }

    // Validate taxonomy weights
    const byTaxonomy = new Map<string, number>();
    for (const a of taxonomyAssignments) {
      const current = byTaxonomy.get(a.taxonomyId) ?? 0;
      byTaxonomy.set(a.taxonomyId, current + (a.weight ?? 0));
    }
    for (const [, sum] of byTaxonomy) {
      if (sum > 10000) {
        setError(t('taxonomies.weightSumError'));
        return;
      }
    }

    const cleanedAssignments = taxonomyAssignments.filter(a => a.categoryId);

    setError(null);
    setSaving(true);

    try {
      const calendarValue = masterData.calendar === '__none' ? '' : masterData.calendar;
      const masterPayload = {
        name: masterData.name,
        isin: masterData.isin || undefined,
        ticker: masterData.ticker || undefined,
        wkn: masterData.wkn || undefined,
        currency: masterData.currency,
        calendar: calendarValue || undefined,
        note: masterData.note || undefined,
        isRetired: masterData.isRetired,
        feed: feedData.feed || undefined,
        feedUrl: feedData.feedUrl || undefined,
        pathToDate: feedData.pathToDate || undefined,
        pathToClose: feedData.pathToClose || undefined,
        latestFeed: feedData.latestFeed || undefined,
        latestFeedUrl: feedData.latestFeedUrl || undefined,
      };

      let id: string;
      if (mode === 'create') {
        const created = await api.fetch<{ id: string }>('/api/securities', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(masterPayload),
        });
        id = created.id;
        onCreated?.(id);
      } else {
        await api.fetch(`/api/securities/${securityId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(masterPayload),
        });
        id = securityId!;
      }

      // Save non-logo attributes via full-replace endpoint FIRST
      // (this does DELETE all + INSERT, so it must run before the logo save)
      await api.fetch(`/api/securities/${id}/attributes`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          attributes: attributes
            .filter(a => a.typeId !== 'logo' && a.value !== '')
            .map(a => ({ typeId: a.typeId, value: a.value })),
        }),
      });

      // Save logo via dedicated endpoint (only touches logo row, no full replace)
      const logoAttr = attributes.find(a => a.typeId === 'logo');
      await api.fetch(`/api/securities/${id}/logo`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ logoUrl: logoAttr?.value || null }),
      });

      await api.fetch(`/api/securities/${id}/taxonomy`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assignments: cleanedAssignments }),
      });

      qc.invalidateQueries({ queryKey: ['portfolios', api.portfolioId, 'securities'] });
      qc.invalidateQueries({ queryKey: ['portfolios', api.portfolioId, 'securities', id] });
      qc.invalidateQueries({ queryKey: ['portfolios', api.portfolioId, 'taxonomies'] });
      qc.invalidateQueries({ queryKey: ['portfolios', api.portfolioId, 'rebalancing'] });
      qc.invalidateQueries({ queryKey: ['portfolios', api.portfolioId, 'reports'] });
      qc.invalidateQueries({ queryKey: ['portfolios', api.portfolioId, 'performance'] });

      toast.success(t('securityEditor.saved'));
      setIsDirty(false);
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('securityEditor.saveError'));
    } finally {
      setSaving(false);
    }
  }

  // Compute completeness for section dots (edit mode only)
  const completeness = mode === 'edit' && detail
    ? getSecurityCompleteness(detail)
    : null;

  function sectionStatus(section: EditorSection) {
    if (!completeness) return undefined;
    const sectionIssues = completeness.issues.filter(i => i.section === section);
    if (sectionIssues.length === 0) return 'complete' as const;
    if (sectionIssues.some(i => i.severity === 'warn')) return 'needs-attention' as const;
    return 'minimal' as const;
  }

  return (
    <>
      <Sheet open={open} onOpenChange={handleOpenChange}>
        <SheetContent
          side="right"
          className="w-full sm:max-w-xl p-0 flex flex-col"
          showCloseButton={true}
        >
          <SheetHeader className="px-6 pt-6 pb-2 shrink-0">
            <SheetTitle>
              {mode === 'create'
                ? t('securityEditor.createTitle')
                : masterData.name || t('securityEditor.title')}
            </SheetTitle>
            <SheetDescription className="sr-only">
              {mode === 'create' ? t('securityEditor.createTitle') : t('securityEditor.title')}
            </SheetDescription>
          </SheetHeader>

          <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 min-h-0">
            <MasterDataSection
              defaultValues={initialMaster}
              hasTransactions={false}
              status={sectionStatus('masterData')}
              onChange={handleMasterChange}
            />

            <PriceFeedSection
              securityId={securityId}
              ticker={masterData.ticker}
              values={feedData}
              status={sectionStatus('priceFeed')}
              onChange={handleFeedChange}
            />

            <AttributesSection
              attributes={attributes}
              onChange={handleAttributesChange}
              ticker={masterData.ticker}
              instrumentType={detail?.instrumentType ?? undefined}
            />

            <TaxonomiesSection
              assignments={taxonomyAssignments}
              onChange={handleTaxonomyChange}
              status={sectionStatus('taxonomies')}
            />

            <div className="h-4" />
          </div>

          {error && (
            <p className="text-sm text-destructive px-6 py-1 shrink-0">{error}</p>
          )}

          <SheetFooter className="border-t px-6 py-3 shrink-0 flex flex-row gap-2">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={() => handleOpenChange(false)}
            >
              {t('common:cancel')}
            </Button>
            <Button
              type="button"
              className="flex-1"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? t('securityEditor.saving') : t('securityEditor.save')}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <AlertDialog open={showUnsavedDialog} onOpenChange={setShowUnsavedDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('securityEditor.unsavedChanges')}</AlertDialogTitle>
            <AlertDialogDescription className="sr-only">
              {t('securityEditor.unsavedChanges')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('securityEditor.unsavedKeepEditing')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setShowUnsavedDialog(false);
                setIsDirty(false);
                onOpenChange(false);
              }}
            >
              {t('securityEditor.unsavedDiscard')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
