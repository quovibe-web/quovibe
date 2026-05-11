import { useRef, useEffect, useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { createChart, type IChartApi, type DeepPartial, type ChartOptions } from 'lightweight-charts';
import { useTheme } from '@/hooks/use-theme';
import { useChartTheme, toLightweightTheme } from '@/hooks/use-chart-theme';

/** Map chart instances to their ResizeObserver for cleanup — avoids mutating the library object */
// quovibe:allow-module-state — DOM observer registry keyed by chart instance; portfolio-agnostic DOM cleanup (ADR-016).
const chartResizeObservers = new WeakMap<IChartApi, ResizeObserver>();
// quovibe:allow-module-state — DOM observer registry keyed by chart instance; portfolio-agnostic DOM cleanup (ADR-016).
const chartAttributionObservers = new WeakMap<IChartApi, MutationObserver>();

const SANITIZED_TV_HREF =
  'https://www.tradingview.com/?utm_medium=lwc-link&utm_campaign=lwc-chart&utm_source=quovibe-web';

/**
 * Strip the current page URL (which may contain portfolio / security UUIDs) from the
 * TradingView attribution anchor that lightweight-charts injects as `#tv-attr-logo`.
 * The library re-creates the anchor on theme changes, so we watch the container subtree.
 */
function sanitizeTradingViewAttribution(container: HTMLElement): MutationObserver {
  function fix(el: HTMLAnchorElement) {
    if (el.href !== SANITIZED_TV_HREF) el.href = SANITIZED_TV_HREF;
  }
  const existing = container.querySelector<HTMLAnchorElement>('a#tv-attr-logo');
  if (existing) fix(existing);
  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (!(node instanceof HTMLElement)) continue;
        if (node instanceof HTMLAnchorElement && node.id === 'tv-attr-logo') {
          fix(node);
          continue;
        }
        const anchor = node.querySelector?.<HTMLAnchorElement>('a#tv-attr-logo');
        if (anchor) fix(anchor);
      }
      if (
        m.type === 'attributes' &&
        m.target instanceof HTMLAnchorElement &&
        m.target.id === 'tv-attr-logo'
      ) {
        fix(m.target);
      }
    }
  });
  observer.observe(container, { childList: true, subtree: true, attributes: true, attributeFilter: ['href'] });
  return observer;
}

interface UseLightweightChartOptions {
  options?: DeepPartial<ChartOptions>;
  autoResize?: boolean;
}

/**
 * Callback ref that also exposes `.current` for read access. Pass it as `ref={containerRef}`
 * to bind, and read `containerRef.current?.clientWidth` like a regular RefObject.
 */
type ContainerRefCallback = ((node: HTMLDivElement | null) => void) & {
  readonly current: HTMLDivElement | null;
};

interface UseLightweightChartReturn {
  containerRef: ContainerRefCallback;
  chartRef: React.MutableRefObject<IChartApi | null>;
  /** Increments when the chart is created. Use as effect dependency to react to chart readiness. */
  ready: number;
}

export function useLightweightChart(
  opts: UseLightweightChartOptions = {},
): UseLightweightChartReturn {
  const { options, autoResize = true } = opts;
  const chartRef = useRef<IChartApi | null>(null);
  const containerNodeRef = useRef<HTMLDivElement | null>(null);
  const pendingSizeObsRef = useRef<ResizeObserver | null>(null);
  const [ready, setReady] = useState(0);
  const { resolvedTheme } = useTheme();
  const chartTheme = useChartTheme();
  const { i18n } = useTranslation();
  const locale = i18n.language;

  // Refs for values read inside the callback ref — keeps cb identity stable across renders
  // so React doesn't tear down + reattach the chart on every render.
  const localeRef = useRef(locale);
  localeRef.current = locale;
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const chartThemeRef = useRef(chartTheme);
  chartThemeRef.current = chartTheme;
  const autoResizeRef = useRef(autoResize);
  autoResizeRef.current = autoResize;

  /**
   * Callback ref. Reacts directly to container DOM attach / detach — no polling, no
   * timeout. Fixes two bugs that polling produced:
   *   1. Container gated behind user state (e.g. category selection) appeared after the
   *      5 s polling cap had expired, leaving the chart never created until refresh.
   *   2. When the chart's container was unmounted and remounted (e.g. parent Card
   *      toggled by route or filter state), the chart instance survived but its canvas
   *      was attached to a detached DOM subtree — series rendered invisibly until refresh.
   * The callback ref destroys the chart on detach and creates a fresh one on attach.
   */
  const containerRef = useMemo<ContainerRefCallback>(() => {
    function destroyChart() {
      const chart = chartRef.current;
      if (!chart) return;
      chartResizeObservers.get(chart)?.disconnect();
      chartAttributionObservers.get(chart)?.disconnect();
      try { chart.remove(); } catch { /* already disposed (HMR) */ }
      chartRef.current = null;
    }

    function createChartOn(node: HTMLDivElement) {
      if (chartRef.current) return;
      if (node.clientWidth === 0 || node.clientHeight === 0) return; // native-ok
      const themeOptions = toLightweightTheme(chartThemeRef.current);
      const chart = createChart(node, {
        width: node.clientWidth,
        height: node.clientHeight,
        ...themeOptions,
        ...optionsRef.current,
        localization: {
          locale: localeRef.current,
          ...themeOptions.localization,
          ...optionsRef.current?.localization,
        },
      });
      chartRef.current = chart;

      if (autoResizeRef.current) {
        const resizeObs = new ResizeObserver((entries) => {
          const entry = entries[0];
          if (entry && chartRef.current) {
            const { width, height } = entry.contentRect;
            if (width > 0 && height > 0) chartRef.current.resize(width, height); // native-ok
          }
        });
        resizeObs.observe(node);
        chartResizeObservers.set(chart, resizeObs);
      }

      chartAttributionObservers.set(chart, sanitizeTradingViewAttribution(node));

      setReady((v) => v + 1); // native-ok
    }

    const cb = (node: HTMLDivElement | null) => {
      // Tear down any pending size observer from a prior attach
      pendingSizeObsRef.current?.disconnect();
      pendingSizeObsRef.current = null;
      containerNodeRef.current = node;

      if (!node) {
        destroyChart();
        return;
      }

      // Fast path — container already has size at attach time
      if (node.clientWidth > 0 && node.clientHeight > 0) {
        createChartOn(node);
        return;
      }

      // Slow path — container is in DOM but hasn't laid out yet (e.g. parent uses
      // `display: none` or zero-height during animation). Watch for size and create
      // the chart as soon as it lays out. Replaces the old 5 s polling cap.
      const sizeObs = new ResizeObserver(() => {
        if (
          node.clientWidth > 0 && // native-ok
          node.clientHeight > 0 && // native-ok
          !chartRef.current &&
          containerNodeRef.current === node
        ) {
          createChartOn(node);
          sizeObs.disconnect();
          if (pendingSizeObsRef.current === sizeObs) pendingSizeObsRef.current = null;
        }
      });
      sizeObs.observe(node);
      pendingSizeObsRef.current = sizeObs;
    };

    Object.defineProperty(cb, 'current', {
      get: () => containerNodeRef.current,
    });

    return cb as ContainerRefCallback;
    // Stable cb identity — mutable values flow through refs declared above.
  }, []);

  // Final cleanup on hook unmount (e.g. consumer component unmounts while its
  // container is still attached — the callback ref's detach branch won't run in that
  // order, so we mirror the cleanup here).
  useEffect(() => {
    return () => {
      pendingSizeObsRef.current?.disconnect();
      pendingSizeObsRef.current = null;
      const chart = chartRef.current;
      if (chart) {
        chartResizeObservers.get(chart)?.disconnect();
        chartAttributionObservers.get(chart)?.disconnect();
        try { chart.remove(); } catch { /* already disposed (HMR) */ }
        chartRef.current = null;
      }
    };
  }, []);

  // Apply theme changes to existing chart
  useEffect(() => {
    if (!chartRef.current) return;
    const themeOptions = toLightweightTheme(chartTheme);
    chartRef.current.applyOptions(themeOptions);
  }, [resolvedTheme, chartTheme]);

  // Apply locale changes — without this, lightweight-charts falls back to navigator.language.
  useEffect(() => {
    if (!chartRef.current) return;
    chartRef.current.applyOptions({ localization: { locale } });
  }, [locale]);

  return { containerRef, chartRef, ready };
}
