import { describe, it, expect } from 'vitest';
import { buildSeriesOptions } from '../chart-series-factory';

describe('buildSeriesOptions', () => {
  const color = '#ff0000';

  it('returns LineSeries definition for "line" type', () => {
    const result = buildSeriesOptions('line', { color });
    expect(result.seriesType).toBe('Line');
    expect(result.options).toMatchObject({
      color,
      lineWidth: 2,
      lastValueVisible: false,
      priceLineVisible: false,
    });
  });

  it('returns AreaSeries definition for "area" type', () => {
    const result = buildSeriesOptions('area', { color });
    expect(result.seriesType).toBe('Area');
    expect(result.options).toMatchObject({
      lineColor: color,
      lineWidth: 2,
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
      lineWidth: 2,
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
