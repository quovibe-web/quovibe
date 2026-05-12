import { describe, expect, it } from 'vitest';
import { buildLightweightChartOptions } from '../use-lightweight-chart';

const DIMS = { width: 800, height: 400 };
const LOCALE = 'en';
const EMPTY_THEME = {};

describe('buildLightweightChartOptions', () => {
  it('disables attributionLogo by default (in layout sub-object)', () => {
    const opts = buildLightweightChartOptions(undefined, EMPTY_THEME, DIMS, LOCALE);
    expect(opts.layout?.attributionLogo).toBe(false);
  });

  it('honors explicit caller override to re-enable attributionLogo', () => {
    const opts = buildLightweightChartOptions(
      { layout: { attributionLogo: true } },
      EMPTY_THEME,
      DIMS,
      LOCALE,
    );
    expect(opts.layout?.attributionLogo).toBe(true);
  });

  it('preserves caller layout options unrelated to attributionLogo', () => {
    const opts = buildLightweightChartOptions(
      { layout: { textColor: '#abc123' } },
      EMPTY_THEME,
      DIMS,
      LOCALE,
    );
    expect(opts.layout?.textColor).toBe('#abc123');
    expect(opts.layout?.attributionLogo).toBe(false);
  });

  it('preserves caller-supplied top-level options unrelated to layout', () => {
    const opts = buildLightweightChartOptions(
      { rightPriceScale: { visible: true } },
      EMPTY_THEME,
      DIMS,
      LOCALE,
    );
    expect(opts.rightPriceScale).toEqual({ visible: true });
    expect(opts.layout?.attributionLogo).toBe(false);
  });

  it('injects dimensions from the node', () => {
    const opts = buildLightweightChartOptions(undefined, EMPTY_THEME, { width: 1200, height: 600 }, LOCALE);
    expect(opts.width).toBe(1200);
    expect(opts.height).toBe(600);
  });

  it('merges locale with precedence: callerOptions.localization > themeOptions.localization', () => {
    const opts = buildLightweightChartOptions(
      { localization: { locale: 'de' } },
      { localization: { locale: 'it' } },
      DIMS,
      'en',
    );
    // caller localization.locale wins over themeOptions
    expect(opts.localization?.locale).toBe('de');
  });

  it('falls back to locale param when neither theme nor caller provide localization', () => {
    const opts = buildLightweightChartOptions(undefined, EMPTY_THEME, DIMS, 'fr');
    expect(opts.localization?.locale).toBe('fr');
  });

  it('theme layout options are overridden by caller layout options', () => {
    const opts = buildLightweightChartOptions(
      { layout: { textColor: '#000' } },
      { layout: { textColor: '#fff' } },
      DIMS,
      LOCALE,
    );
    // caller wins; watermark still off
    expect(opts.layout?.textColor).toBe('#000');
    expect(opts.layout?.attributionLogo).toBe(false);
  });
});
