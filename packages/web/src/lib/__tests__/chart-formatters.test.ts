import { describe, it, expect } from 'vitest';
import { chartTooltipFormatter } from '@/lib/chart-formatters';

describe('chartTooltipFormatter', () => {
  describe('Market Value series', () => {
    it('formats as currency and labels correctly', () => {
      const [formatted, label] = chartTooltipFormatter(305594.13, 'Market Value', { dataKey: 'marketValue' });
      expect(label).toBe('Market Value');
      // Must contain a digit and currency symbol — must NOT end with %
      expect(formatted).toMatch(/\d/);
      expect(formatted).not.toMatch(/%/);
    });

    it('formats zero value', () => {
      const [formatted, label] = chartTooltipFormatter(0, 'Market Value', { dataKey: 'marketValue' });
      expect(label).toBe('Market Value');
      expect(formatted).not.toMatch(/%/);
    });

    it('formats large values (millions)', () => {
      const [formatted, label] = chartTooltipFormatter(1_500_000.0, 'Market Value', { dataKey: 'marketValue' });
      expect(label).toBe('Market Value');
      expect(formatted).not.toMatch(/%/);
      expect(formatted).toMatch(/1/);
    });

    it('formats negative values (loss)', () => {
      const [formatted, label] = chartTooltipFormatter(-12345.67, 'Market Value', { dataKey: 'marketValue' });
      expect(label).toBe('Market Value');
      expect(formatted).not.toMatch(/%/);
    });
  });

  describe('TTWROR series', () => {
    it('formats as percentage and labels correctly', () => {
      const [formatted, label] = chartTooltipFormatter(0.0425, 'TTWROR', { dataKey: 'ttwror' });
      expect(label).toBe('TTWROR');
      expect(formatted).toMatch(/%/);
      // 4.25% expected
      expect(formatted).toContain('4.25');
    });

    it('formats zero TTWROR', () => {
      const [formatted, label] = chartTooltipFormatter(0, 'TTWROR', { dataKey: 'ttwror' });
      expect(label).toBe('TTWROR');
      expect(formatted).toMatch(/%/);
    });

    it('formats negative TTWROR (loss)', () => {
      const [formatted, label] = chartTooltipFormatter(-0.1234, 'TTWROR', { dataKey: 'ttwror' });
      expect(label).toBe('TTWROR');
      expect(formatted).toMatch(/%/);
    });

    it('does NOT format TTWROR as a raw market-value-scale number', () => {
      // Regression: before fix, market value (305594) was passed through formatPercentage
      // → produced "30,559,400.00%" — verify this cannot happen with correct routing
      const [formatted] = chartTooltipFormatter(0.0425, 'TTWROR', { dataKey: 'ttwror' });
      // Should be around 4%, not 30 million %
      expect(parseFloat(formatted.replace(/[^0-9.-]/g, ''))).toBeLessThan(1000);
    });
  });

  describe('Unknown series (fallback)', () => {
    it('returns raw string value and passthrough name', () => {
      const [formatted, label] = chartTooltipFormatter(42, 'UnknownSeries', { dataKey: 'UnknownSeries' });
      expect(label).toBe('UnknownSeries');
      expect(formatted).toBe('42');
    });
  });
});
