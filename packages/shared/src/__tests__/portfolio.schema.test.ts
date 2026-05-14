import { describe, it, expect } from 'vitest';
import { createPortfolioSchema, setupPortfolioSchema, patchPortfolioSchema } from '../schemas/portfolio.schema';

describe('createPortfolioSchema — fresh source requires M3 payload', () => {
  it('accepts a minimal valid fresh payload', () => {
    const result = createPortfolioSchema.safeParse({
      source: 'fresh',
      name: 'My Portfolio',
      baseCurrency: 'EUR',
      securitiesAccountName: 'Main Securities',
      primaryDeposit: { name: 'Cash' },
    });
    expect(result.success).toBe(true);
  });

  it('accepts a fresh payload with extra deposits', () => {
    const result = createPortfolioSchema.safeParse({
      source: 'fresh',
      name: 'My Portfolio',
      baseCurrency: 'EUR',
      securitiesAccountName: 'Main Securities',
      primaryDeposit: { name: 'EUR Cash' },
      extraDeposits: [
        { name: 'USD Cash', currency: 'USD' },
        { name: 'GBP Cash', currency: 'GBP' },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects fresh payload missing baseCurrency', () => {
    const result = createPortfolioSchema.safeParse({
      source: 'fresh',
      name: 'My Portfolio',
      securitiesAccountName: 'Main Securities',
      primaryDeposit: { name: 'Cash' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects fresh payload with empty securitiesAccountName', () => {
    const result = createPortfolioSchema.safeParse({
      source: 'fresh',
      name: 'My Portfolio',
      baseCurrency: 'EUR',
      securitiesAccountName: '',
      primaryDeposit: { name: 'Cash' },
    });
    expect(result.success).toBe(false);
  });

  it('still accepts source=demo with no extra fields', () => {
    const result = createPortfolioSchema.safeParse({ source: 'demo' });
    expect(result.success).toBe(true);
  });
});

describe('setupPortfolioSchema', () => {
  it('accepts minimal payload (no name, same shape as fresh minus name)', () => {
    const result = setupPortfolioSchema.safeParse({
      baseCurrency: 'EUR',
      securitiesAccountName: 'Main Securities',
      primaryDeposit: { name: 'Cash' },
    });
    expect(result.success).toBe(true);
  });

  it('rejects payload with a name field (setup does not rename the portfolio)', () => {
    const result = setupPortfolioSchema.safeParse({
      name: 'Should not be here',
      baseCurrency: 'EUR',
      securitiesAccountName: 'Main Securities',
      primaryDeposit: { name: 'Cash' },
    });
    // name is not in schema — .safeParse with strict() rejects; without strict, it passes silently.
    // We want the schema to be strict about unknown keys here.
    expect(result.success).toBe(false);
  });
});

describe('patchPortfolioSchema', () => {
  it('accepts a name-only patch', () => {
    const result = patchPortfolioSchema.safeParse({ name: 'Renamed' });
    expect(result.success).toBe(true);
  });

  it('accepts a lastOpenedAt-only patch', () => {
    const result = patchPortfolioSchema.safeParse({ lastOpenedAt: '2026-04-29T00:00:00Z' });
    expect(result.success).toBe(true);
  });

  it('accepts an empty patch (both fields optional)', () => {
    const result = patchPortfolioSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('rejects empty name', () => {
    const result = patchPortfolioSchema.safeParse({ name: '' });
    expect(result.success).toBe(false);
  });

  it('rejects name longer than 200 chars', () => {
    const result = patchPortfolioSchema.safeParse({ name: 'x'.repeat(201) });
    expect(result.success).toBe(false);
  });
});
