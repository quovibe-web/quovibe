import { useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ChevronsUpDown, ChevronsDownUp, Download, Maximize2, Minimize2 } from 'lucide-react';
import { MetricCardSkeleton } from '@/components/shared/MetricCardSkeleton';
import { SectionSkeleton } from '@/components/shared/SectionSkeleton';
import { usePrivacy } from '@/context/privacy-context';
import { useWidgetConfig } from '@/context/widget-config-context';
import { useCalculation, useReportingPeriod } from '@/api/use-performance';
import { useCalculationView, useSaveCalculationView } from '@/api/use-calculation-view';
import { usePortfolioRegistry } from '@/api/use-portfolios';
import { CalculationHeroStrip } from './CalculationHeroStrip';
import { CalculationWaterfallChart } from './CalculationWaterfallChart';
import { CalculationCategorySection } from './CalculationCategorySection';
import { CalculationAnchorsSection } from './CalculationAnchorsSection';
import { CalculationRightRail } from './CalculationRightRail';
import { CALCULATION_CATEGORIES, type CategoryId } from '@/lib/calculation-rows';
import { buildCalculationCsv, downloadCalculationCsv, slugifyFilename } from '@/lib/analytics-export';
import { resolveDataSeriesToParams } from '@/lib/data-series-utils';
import { CostMethod } from '@quovibe/shared';

export function CalculationPremiumView() {
  const { t } = useTranslation('performance');
  const { t: tCommon } = useTranslation('common');
  const { dataSeries, periodOverride, options } = useWidgetConfig();
  const { periodStart: urlStart, periodEnd: urlEnd } = useReportingPeriod();
  const { isPrivate } = usePrivacy();
  const { portfolioId } = useParams<{ portfolioId: string }>();
  const registry = usePortfolioRegistry();
  const { data: viewPrefs } = useCalculationView();
  const saveView = useSaveCalculationView();

  const density = viewPrefs?.tableDensity ?? 'comfortable';

  const periodStart = periodOverride?.periodStart ?? urlStart;
  const periodEnd = periodOverride?.periodEnd ?? urlEnd;
  const dsParams = resolveDataSeriesToParams(dataSeries);
  const preTax = dsParams.preTax;
  const costMethod =
    typeof options.costMethod === 'string' &&
    Object.values(CostMethod).includes(options.costMethod as CostMethod)
      ? (options.costMethod as CostMethod)
      : CostMethod.MOVING_AVERAGE;

  const { data, isLoading, isError, error } = useCalculation(
    preTax,
    costMethod,
    periodStart,
    periodEnd,
    dsParams.filter,
    dsParams.withReference,
    dsParams.taxonomyId,
    dsParams.categoryId,
  );

  const sectionRefs = useRef<Record<CategoryId, HTMLDivElement | null>>({
    drivers: null,
    frictions: null,
    flows: null,
    anchors: null,
  });
  const [expanded, setExpanded] = useState<Set<CategoryId>>(new Set());

  const toggleSection = useCallback((id: CategoryId) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleBarClick = useCallback((id: CategoryId) => {
    setExpanded((prev) => new Set(prev).add(id));
    const node = sectionRefs.current[id];
    if (node) {
      node.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, []);

  const expandableCategories = useMemo<CategoryId[]>(() => {
    if (!data) return [];
    return CALCULATION_CATEGORIES.filter((c) => c.id !== 'anchors')
      .filter(
        (c) =>
          c.extractSubRows(data).length > 0 ||
          c.extractDrillDownTables(data).some((tb) => tb.rows.length > 0 || tb.placeholderKey),
      )
      .map((c) => c.id);
  }, [data]);

  const expandAll = () => setExpanded(new Set(expandableCategories));
  const collapseAll = () => setExpanded(new Set());

  const toggleDensity = () => {
    const next = density === 'comfortable' ? 'dense' : 'comfortable';
    saveView.mutate({ tableDensity: next });
  };

  const handleExport = () => {
    if (!data || isPrivate) return;
    const portfolioName =
      registry.data?.portfolios.find((p) => p.id === portfolioId)?.name ?? 'portfolio';
    const slug = slugifyFilename(portfolioName);
    const filename = `analytics-calculation-${slug}-${periodStart}-${periodEnd}`;
    const csv = buildCalculationCsv(data, t, data.irrConverged);
    downloadCalculationCsv(csv, filename);
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {Array.from({ length: 6 }, (_, i) => (
            <MetricCardSkeleton key={i} index={i} />
          ))}
        </div>
        <MetricCardSkeleton index={0} />
        {Array.from({ length: 4 }, (_, i) => (
          <SectionSkeleton key={i} rows={4} />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <Alert variant="destructive" className="w-full">
        <AlertDescription>{error?.message ?? t('errors:unknown')}</AlertDescription>
      </Alert>
    );
  }

  if (!data) return null;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_240px] gap-6">
      {/* Main column */}
      <div className="space-y-4 min-w-0">
        {/* Top toolbar */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1">
            {expandableCategories.length > 0 && (
              <>
                <Button variant="ghost" size="sm" onClick={expandAll}>
                  <ChevronsUpDown size={14} className="mr-1" />
                  {t('calculation.expandAll')}
                </Button>
                <Button variant="ghost" size="sm" onClick={collapseAll}>
                  <ChevronsDownUp size={14} className="mr-1" />
                  {t('calculation.collapseAll')}
                </Button>
              </>
            )}
          </div>
          <div className="flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={toggleDensity}
                  aria-label={t('calculation.density.toggle')}
                >
                  {density === 'comfortable' ? (
                    <Minimize2 className="h-4 w-4" />
                  ) : (
                    <Maximize2 className="h-4 w-4" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {density === 'comfortable'
                  ? t('calculation.density.dense')
                  : t('calculation.density.comfortable')}
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleExport}
                  disabled={isPrivate}
                  aria-label={tCommon('exportCsv')}
                >
                  <Download className="h-4 w-4" />
                  <span className="ml-1">{tCommon('exportCsv')}</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {isPrivate ? tCommon('exportDisabledPrivacy') : tCommon('exportCsv')}
              </TooltipContent>
            </Tooltip>
          </div>
        </div>

        <CalculationHeroStrip data={data} />
        <CalculationWaterfallChart data={data} onBarClick={handleBarClick} />

        {CALCULATION_CATEGORIES.filter((c) => c.id !== 'anchors').map((category) => (
          <CalculationCategorySection
            key={category.id}
            ref={(node) => {
              sectionRefs.current[category.id] = node;
            }}
            category={category}
            data={data}
            expanded={expanded.has(category.id)}
            density={density}
            onToggle={() => toggleSection(category.id)}
          />
        ))}

        <CalculationAnchorsSection
          ref={(node) => {
            sectionRefs.current.anchors = node;
          }}
          data={data}
        />
      </div>

      {/* Right rail */}
      <div className="min-w-0">
        <CalculationRightRail data={data} />
      </div>
    </div>
  );
}
