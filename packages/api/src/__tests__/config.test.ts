// packages/api/src/__tests__/config.test.ts
import { describe, it, expect } from 'vitest';
import { UUID_V4_RE, isPortfolioFilename, resolvePortfolioPath, DATA_DIR } from '../config';
import path from 'path';

describe('UUID_V4_RE', () => {
  it('accepts a valid lowercase v4 UUID', () => {
    expect(UUID_V4_RE.test('8a2fb1e4-7c3d-4b5e-9a1f-0123456789ab')).toBe(true);
  });
  it('rejects uppercase', () => {
    expect(UUID_V4_RE.test('8A2FB1E4-7C3D-4B5E-9A1F-0123456789AB')).toBe(false);
  });
  it('rejects v1 (time-based)', () => {
    expect(UUID_V4_RE.test('8a2fb1e4-7c3d-1b5e-9a1f-0123456789ab')).toBe(false);
  });
  it('rejects shape-only 36-char dashed strings', () => {
    expect(UUID_V4_RE.test('--------------------xxxxxxxxxxxxxxxx')).toBe(false);
  });
});

describe('isPortfolioFilename', () => {
  it('extracts id from portfolio-{uuid}.db', () => {
    const id = '8a2fb1e4-7c3d-4b5e-9a1f-0123456789ab';
    expect(isPortfolioFilename(`portfolio-${id}.db`)).toBe(id);
  });
  it('returns null for demo', () => {
    expect(isPortfolioFilename('portfolio-demo.db')).toBeNull();
  });
  it('returns null for non-uuid filenames', () => {
    expect(isPortfolioFilename('portfolio-notauuid.db')).toBeNull();
    expect(isPortfolioFilename('random.db')).toBeNull();
    expect(isPortfolioFilename('portfolio-demo.db.bak')).toBeNull();
  });
});

describe('resolvePortfolioPath', () => {
  const id = '8a2fb1e4-7c3d-4b5e-9a1f-0123456789ab';
  it('returns DATA_DIR/portfolio-demo.db for demo', () => {
    expect(resolvePortfolioPath({ id, kind: 'demo' }))
      .toBe(path.join(DATA_DIR, 'portfolio-demo.db'));
  });
  it('returns DATA_DIR/portfolio-{uuid}.db for real', () => {
    expect(resolvePortfolioPath({ id, kind: 'real' }))
      .toBe(path.join(DATA_DIR, `portfolio-${id}.db`));
  });
  it('throws INVALID_PORTFOLIO_ID for non-uuid id', () => {
    expect(() => resolvePortfolioPath({ id: '../etc/passwd', kind: 'real' }))
      .toThrow(/INVALID_PORTFOLIO_ID/);
  });
  it('throws for uppercase UUID', () => {
    expect(() => resolvePortfolioPath({ id: id.toUpperCase(), kind: 'real' }))
      .toThrow(/INVALID_PORTFOLIO_ID/);
  });
});
