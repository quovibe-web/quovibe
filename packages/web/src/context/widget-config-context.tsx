import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';
import type { DataSeriesValue, ReportingPeriodOverride, ReportingPeriodDef } from '@quovibe/shared';
import { resolveReportingPeriod } from '@quovibe/shared';

export interface WidgetConfigValue {
  dataSeries: DataSeriesValue | null;
  periodOverride: ReportingPeriodOverride | null;
  options: Record<string, unknown>;
  setDataSeries: (ds: DataSeriesValue | null) => void;
  setPeriodOverride: (def: ReportingPeriodDef | null) => void;
  setOptions: (opts: Record<string, unknown>) => void;
}

const WidgetConfigContext = createContext<WidgetConfigValue | null>(null);

interface WidgetConfigProviderProps {
  initialConfig: Record<string, unknown>;
  children: ReactNode;
}

export function WidgetConfigProvider({ initialConfig, children }: WidgetConfigProviderProps) {
  const [dataSeries, setDataSeries] = useState<DataSeriesValue | null>(
    (initialConfig.dataSeries as DataSeriesValue) ?? null,
  );
  const [periodOverride, setInternalPeriodOverride] = useState<ReportingPeriodOverride | null>(() => {
    const raw = initialConfig.periodOverride as (ReportingPeriodOverride & { definition?: ReportingPeriodDef }) | null;
    if (!raw) return null;
    if (!raw.definition) {
      const def: ReportingPeriodDef = { type: 'fromTo', from: raw.periodStart, to: raw.periodEnd };
      const resolved = resolveReportingPeriod(def);
      return { definition: def, ...resolved };
    }
    const resolved = resolveReportingPeriod(raw.definition);
    return { definition: raw.definition, ...resolved };
  });
  // Sync periodOverride when external config changes (e.g., "Reset all widget periods")
  useEffect(() => {
    const raw = initialConfig.periodOverride as (ReportingPeriodOverride & { definition?: ReportingPeriodDef }) | null | undefined;
    if (!raw) {
      setInternalPeriodOverride(null);
      return;
    }
    if (!raw.definition) {
      const def: ReportingPeriodDef = { type: 'fromTo', from: raw.periodStart, to: raw.periodEnd };
      const resolved = resolveReportingPeriod(def);
      setInternalPeriodOverride({ definition: def, ...resolved });
      return;
    }
    const resolved = resolveReportingPeriod(raw.definition);
    setInternalPeriodOverride({ definition: raw.definition, ...resolved });
  }, [initialConfig.periodOverride]);

  // Sync dataSeries when external config changes (e.g., Calculation toggle)
  const dsJson = JSON.stringify(initialConfig.dataSeries ?? null);
  useEffect(() => {
    setDataSeries(JSON.parse(dsJson) as DataSeriesValue | null);
  }, [dsJson]);

  const [options, setOptions] = useState<Record<string, unknown>>(
    (initialConfig.options as Record<string, unknown>) ?? {},
  );

  // Sync options when external config changes (e.g., Calculation cost method toggle)
  const optsJson = JSON.stringify(initialConfig.options ?? {});
  useEffect(() => {
    setOptions(JSON.parse(optsJson) as Record<string, unknown>);
  }, [optsJson]);

  const value: WidgetConfigValue = {
    dataSeries,
    periodOverride,
    options,
    setDataSeries: useCallback((ds) => setDataSeries(ds), []),
    setPeriodOverride: useCallback((def: ReportingPeriodDef | null) => {
      if (!def) {
        setInternalPeriodOverride(null);
        return;
      }
      const resolved = resolveReportingPeriod(def);
      setInternalPeriodOverride({ definition: def, ...resolved });
    }, []),
    setOptions: useCallback((o) => setOptions(o), []),
  };

  return (
    <WidgetConfigContext.Provider value={value}>
      {children}
    </WidgetConfigContext.Provider>
  );
}

export function useWidgetConfig(): WidgetConfigValue {
  const ctx = useContext(WidgetConfigContext);
  if (!ctx) {
    throw new Error('useWidgetConfig must be used within a WidgetConfigProvider');
  }
  return ctx;
}
