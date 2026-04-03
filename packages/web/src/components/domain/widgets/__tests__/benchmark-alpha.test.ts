import { describe, it, expect } from 'vitest';

/**
 * Alpha = portfolio TTWROR - benchmark TTWROR (simple difference).
 * This is NOT Jensen's alpha — just the arithmetic difference.
 */
function computeAlpha(portfolioTtwror: number, benchmarkTtwror: number): number {
  return portfolioTtwror - benchmarkTtwror;
}

describe('Benchmark Comparison Widget — Alpha Calculation', () => {
  it('computes positive alpha when portfolio outperforms', () => {
    const alpha = computeAlpha(0.1245, 0.0823);
    expect(alpha).toBeCloseTo(0.0422, 4);
  });

  it('computes negative alpha when benchmark outperforms', () => {
    const alpha = computeAlpha(0.1245, 0.1423);
    expect(alpha).toBeCloseTo(-0.0178, 4);
  });

  it('computes zero alpha when equal', () => {
    const alpha = computeAlpha(0.15, 0.15);
    expect(alpha).toBeCloseTo(0, 10);
  });

  it('handles negative portfolio return', () => {
    const alpha = computeAlpha(-0.05, 0.03);
    expect(alpha).toBeCloseTo(-0.08, 4);
  });

  it('handles both negative returns', () => {
    const alpha = computeAlpha(-0.02, -0.08);
    expect(alpha).toBeCloseTo(0.06, 4);
  });
});
