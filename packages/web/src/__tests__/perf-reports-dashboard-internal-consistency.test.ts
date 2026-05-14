import { describe, test, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const LOCALES_DIR = join(__dirname, '..', 'i18n', 'locales');
const LANGUAGES = ['en', 'it', 'de', 'fr', 'es', 'nl', 'pl', 'pt'] as const;

type Json = Record<string, unknown>;

function load(lang: string, ns: string): Json {
  return JSON.parse(readFileSync(join(LOCALES_DIR, lang, ns), 'utf-8')) as Json;
}

function get(obj: Json, path: string): string | undefined {
  const parts = path.split('.');
  let cur: unknown = obj;
  for (const p of parts) {
    if (typeof cur !== 'object' || cur === null) return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return typeof cur === 'string' ? cur : undefined;
}

function casefold(s: string): string {
  return s.normalize('NFC').toLocaleLowerCase();
}

describe('performance.json internal consistency', () => {
  for (const lang of LANGUAGES) {
    describe(`lang: ${lang}`, () => {
      const perf = load(lang, 'performance.json');

      test('ttwrorDescription not English fallback in non-en', () => {
        if (lang === 'en') return;
        expect(get(perf, 'metrics.ttwrorDescription')).not.toBe('True Time-Weighted Rate of Return');
      });

      test('line-style gender consistency: lineStyleSolid vs styleSolid', () => {
        const ls = get(perf, 'chart.lineStyleSolid');
        const s = get(perf, 'chart.styleSolid');
        if (!ls || !s) return;
        expect(casefold(s), `chart.styleSolid ("${s}") must match chart.lineStyleSolid ("${ls}")`).toEqual(casefold(ls));
      });

      test('line-style gender consistency: lineStyleDashed vs styleDashed', () => {
        const ls = get(perf, 'chart.lineStyleDashed');
        const s = get(perf, 'chart.styleDashed');
        if (!ls || !s) return;
        expect(casefold(s), `chart.styleDashed ("${s}") must match chart.lineStyleDashed ("${ls}")`).toEqual(casefold(ls));
      });

      test('line-style gender consistency: lineStyleDotted vs styleDotted', () => {
        const ls = get(perf, 'chart.lineStyleDotted');
        const s = get(perf, 'chart.styleDotted');
        if (!ls || !s) return;
        expect(casefold(s), `chart.styleDotted ("${s}") must match chart.lineStyleDotted ("${ls}")`).toEqual(casefold(ls));
      });

      test('IRR acronym consistency across metrics.irr and heroStrip.irr', () => {
        const metricsIrr = get(perf, 'metrics.irr');
        const heroIrr = get(perf, 'calculation.heroStrip.irr');
        if (!metricsIrr || !heroIrr) return;
        const acronymOf = (v: string): string => v.split(/\s|\(/)[0]!.trim();
        expect(
          casefold(acronymOf(heroIrr)),
          `calculation.heroStrip.irr ("${heroIrr}") must use same IRR-class acronym as metrics.irr ("${metricsIrr}")`,
        ).toEqual(casefold(acronymOf(metricsIrr)));
      });
    });
  }
});

describe('reports.json internal consistency', () => {
  for (const lang of LANGUAGES) {
    describe(`lang: ${lang}`, () => {
      const reports = load(lang, 'reports.json');

      test('rebalancing block not English fallback in non-en', () => {
        if (lang === 'en') return;
        const englishMarkers = [
          { path: 'rebalancing.columns.actualValue', english: 'Actual Value' },
          { path: 'rebalancing.columns.targetValue', english: 'Target Value' },
          { path: 'rebalancing.noData', english: 'No rebalancing data.' },
          { path: 'rebalancing.totalPortfolioValue', english: 'Total Portfolio Value' },
          { path: 'rebalancing.excluded', english: 'Excluded from rebalancing' },
        ];
        for (const { path, english } of englishMarkers) {
          const v = get(reports, path);
          if (!v) continue;
          expect(v, `reports.${path} must be translated (current: "${v}")`).not.toBe(english);
        }
      });
    });
  }
});

describe('dashboard.json internal consistency', () => {
  for (const lang of LANGUAGES) {
    describe(`lang: ${lang}`, () => {
      const dash = load(lang, 'dashboard.json');

      test('catalog.desc block not English fallback in non-en', () => {
        if (lang === 'en') return;
        const englishMarkers = [
          { path: 'catalog.desc.market-value', english: 'Current market value of the selected data series at the end of the reporting period.' },
          { path: 'catalog.desc.ttwror', english: 'Cumulative true time-weighted return of the selected data series for the reporting period.' },
          { path: 'catalog.desc.irr', english: 'Internal rate of return (money-weighted) that accounts for the timing and size of all cash flows.' },
          { path: 'catalog.desc.delta', english: 'Difference between the final and initial market value, adjusted for cash flows during the period.' },
        ];
        for (const { path, english } of englishMarkers) {
          const v = get(dash, path);
          if (!v) continue;
          expect(v, `dashboard.${path} must be translated`).not.toBe(english);
        }
      });

      test('performanceDesc IRR acronym matches widgetTypes.irr stem', () => {
        const widgetIrr = get(dash, 'widgetTypes.irr');
        const perfDesc = get(dash, 'performanceDesc');
        if (!widgetIrr || !perfDesc) return;
        const localAcronym = casefold(widgetIrr.split(/[\s(]/)[0]!);
        const folded = casefold(perfDesc);
        const STEM = localAcronym.slice(0, 3);
        expect(
          folded.includes(STEM),
          `dashboard.performanceDesc ("${perfDesc}") must contain IRR-class acronym matching widgetTypes.irr ("${widgetIrr}") — stem "${STEM}"`,
        ).toBe(true);
      });
    });
  }
});
