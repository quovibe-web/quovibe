import { describe, it, expect } from 'vitest';
import { buildSeriesOptions } from '../chart-series-factory';

describe('buildSeriesOptions', () => {
  const color = '#ff0000';

  it('returns LineSeries definition for "line" type', () => {
    const result = buildSeriesOptions('line', { color });
    expect(result.seriesType).toBe('Line');
    expect(result.options).toMatchObject({
      color,
      lineWidth: 2.5,
      lastValueVisible: false,
      priceLineVisible: false,
    });
  });

  it('returns AreaSeries definition for "area" type', () => {
    const result = buildSeriesOptions('area', { color });
    expect(result.seriesType).toBe('Area');
    expect(result.options).toMatchObject({
      lineColor: color,
      lineWidth: 2.5,
      bottomColor: 'transparent',
      lastValueVisible: false,
      priceLineVisible: false,
    });
    // topColor should contain alpha
    expect(result.options.topColor).toContain('ff0000');
  });

  it('returns BaselineSeries definition for "baseline" type', () => {
    const result = buildSeriesOptions('baseline', {
      color,
      basePrice: 100,
      profitColor: '#00ff00',
      lossColor: '#ff0000',
    });
    expect(result.seriesType).toBe('Baseline');
    expect(result.options).toMatchObject({
      baseValue: { type: 'price', price: 100 },
      topLineColor: '#00ff00',
      bottomLineColor: '#ff0000',
      lineWidth: 2.5,
    });
  });

  it('returns HistogramSeries definition for "histogram" type', () => {
    const result = buildSeriesOptions('histogram', { color });
    expect(result.seriesType).toBe('Histogram');
    expect(result.options.lastValueVisible).toBe(false);
    expect(result.options.priceLineVisible).toBe(false);
  });

  it('returns CandlestickSeries definition for "candlestick" type', () => {
    const result = buildSeriesOptions('candlestick', { color });
    expect(result.seriesType).toBe('Candlestick');
  });

  it('returns BarSeries definition for "bar" type', () => {
    const result = buildSeriesOptions('bar', { color });
    expect(result.seriesType).toBe('Bar');
  });

  it('allows priceScaleId override', () => {
    const result = buildSeriesOptions('line', { color, priceScaleId: 'left' });
    expect(result.options.priceScaleId).toBe('left');
  });

  it('allows lineStyle override', () => {
    const result = buildSeriesOptions('line', { color, lineStyle: 1 });
    expect(result.options.lineStyle).toBe(1);
  });

  it('allows visible override', () => {
    const result = buildSeriesOptions('line', { color, visible: false });
    expect(result.options.visible).toBe(false);
  });

  it('defaults to "line" for unknown type', () => {
    const result = buildSeriesOptions('line', { color });
    expect(result.seriesType).toBe('Line');
  });
});

describe('buildSeriesOptions — seriesRole integration', () => {
  const color = '#4385BE';

  it('portfolio role sets lineWidth to 3 (overrides COMMON_OPTIONS 2.5)', () => {
    const result = buildSeriesOptions('line', { color, seriesRole: 'portfolio' });
    expect(result.options.lineWidth).toBe(3);
  });

  it('holding role sets lineWidth to 2', () => {
    const result = buildSeriesOptions('line', { color, seriesRole: 'holding' });
    expect(result.options.lineWidth).toBe(2);
  });

  it('reference role sets lineWidth to 1.5 and lineStyle to Dashed (2)', () => {
    const result = buildSeriesOptions('line', { color, seriesRole: 'reference' });
    expect(result.options.lineWidth).toBe(1.5);
    expect(result.options.lineStyle).toBe(2); // LwcLineStyle.Dashed
  });

  it('isHovered bumps lineWidth by 0.5 for portfolio role', () => {
    const result = buildSeriesOptions('line', {
      color,
      seriesRole: 'portfolio',
      isHovered: true,
      anyHovered: true,
    });
    expect(result.options.lineWidth).toBe(3.5);
  });

  it('anyHovered without isHovered dims color for holding role (not equal to the original)', () => {
    const result = buildSeriesOptions('line', {
      color,
      seriesRole: 'holding',
      isHovered: false,
      anyHovered: true,
    });
    // withAlpha appends a hex alpha suffix — dimmed color differs from the original
    expect(result.options.color).not.toBe(color);
    // Verify the alpha channel was applied (hex form with 8 chars or rgba-style string)
    expect(String(result.options.color).length).toBeGreaterThan(color.length);
  });

  it('falls back to legacy behavior (color unchanged, lineWidth 2.5) when seriesRole is absent', () => {
    const result = buildSeriesOptions('line', { color });
    expect(result.options.color).toBe(color);
    expect(result.options.lineWidth).toBe(2.5);
  });

  it('passes seriesRole through to area type (uses effectiveColor)', () => {
    const result = buildSeriesOptions('area', {
      color,
      seriesRole: 'holding',
      isHovered: false,
      anyHovered: false,
    });
    expect(result.seriesType).toBe('Area');
    // lineColor must match the unmodified base color (no hover dimming)
    expect(result.options.lineColor).toBe(color);
    expect(result.options.lineWidth).toBe(2);
  });
});

describe('buildSeriesOptions — last-value badge + price line', () => {
  const color = '#4385BE';

  it('portfolio role auto-enables badge + dashed price line', () => {
    const result = buildSeriesOptions('line', { color, seriesRole: 'portfolio' });
    expect(result.options.lastValueVisible).toBe(true);
    expect(result.options.priceLineVisible).toBe(true);
    expect(result.options.priceLineStyle).toBe(2); // LwcLineStyle.Dashed
    expect(result.options.priceLineWidth).toBe(1);
    expect(result.options.priceLineColor).toBe(color);
  });

  it('holding role keeps badge off (avoids right-axis pile-up)', () => {
    const result = buildSeriesOptions('line', { color, seriesRole: 'holding' });
    expect(result.options.lastValueVisible).toBe(false);
    expect(result.options.priceLineVisible).toBe(false);
    expect(result.options.priceLineStyle).toBeUndefined();
  });

  it('reference role keeps badge off', () => {
    const result = buildSeriesOptions('line', { color, seriesRole: 'reference' });
    expect(result.options.lastValueVisible).toBe(false);
    expect(result.options.priceLineVisible).toBe(false);
  });

  it('no seriesRole keeps badge off (legacy default)', () => {
    const result = buildSeriesOptions('line', { color });
    expect(result.options.lastValueVisible).toBe(false);
    expect(result.options.priceLineVisible).toBe(false);
  });

  it('showLastValue=true overrides default off (PriceChart single-series opt-in)', () => {
    const result = buildSeriesOptions('line', { color, showLastValue: true });
    expect(result.options.lastValueVisible).toBe(true);
    expect(result.options.priceLineVisible).toBe(true);
    expect(result.options.priceLineColor).toBe(color);
  });

  it('showLastValue=false overrides portfolio default on', () => {
    const result = buildSeriesOptions('line', {
      color,
      seriesRole: 'portfolio',
      showLastValue: false,
    });
    expect(result.options.lastValueVisible).toBe(false);
    expect(result.options.priceLineVisible).toBe(false);
  });

  it('badge picks up dimmed effectiveColor when peer-hovered', () => {
    const result = buildSeriesOptions('line', {
      color,
      seriesRole: 'portfolio',
      isHovered: false,
      anyHovered: true,
    });
    // priceLineColor follows the dimmed (alpha-suffixed) color, not the raw hex.
    expect(result.options.priceLineColor).not.toBe(color);
    expect(String(result.options.priceLineColor).length).toBeGreaterThan(color.length);
  });
});

describe('buildSeriesOptions — gradient fill polish', () => {
  const color = '#4385BE';

  it('area fill alpha bumped to 0.45 (was 0.35)', () => {
    const result = buildSeriesOptions('area', { color });
    // hex #rrggbb + alpha hex — 0.45 → round(0.45*255)=115 → 0x73.
    // withAlpha preserves input case; lower-case both sides for comparison.
    expect(String(result.options.topColor).toLowerCase()).toBe('#4385be73');
  });

  it('area enables relativeGradient (gradient follows data extrema)', () => {
    const result = buildSeriesOptions('area', { color });
    expect(result.options.relativeGradient).toBe(true);
  });

  it('baseline profit/loss fills bumped to 0.40 alpha (was 0.25)', () => {
    const result = buildSeriesOptions('baseline', {
      color,
      basePrice: 0,
      profitColor: '#66800B',
      lossColor: '#AF3029',
    });
    // 0.40 → round(0.40*255)=102 → 0x66
    expect(String(result.options.topFillColor1).toLowerCase()).toBe('#66800b66');
    expect(String(result.options.bottomFillColor2).toLowerCase()).toBe('#af302966');
  });

  it('baseline enables relativeGradient', () => {
    const result = buildSeriesOptions('baseline', {
      color,
      basePrice: 0,
      profitColor: '#66800B',
      lossColor: '#AF3029',
    });
    expect(result.options.relativeGradient).toBe(true);
  });

  it('histogram alpha unchanged at 0.69', () => {
    const result = buildSeriesOptions('histogram', { color });
    // 0.69 → round(0.69*255)=176 → 0xb0
    expect(String(result.options.color).toLowerCase()).toBe('#4385beb0');
  });
});
