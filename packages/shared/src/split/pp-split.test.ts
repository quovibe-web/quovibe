import { describe, it, expect } from 'vitest';
import Decimal from 'decimal.js';
import {
  parseSplitRatio,
  formatSplitRatio,
  invertRatio,
  splitSharesDb,
  splitQuoteDb,
  readSplitDetails,
  type SplitRatio,
} from './pp-split';

const r = (newShares: string, oldShares: string): SplitRatio => ({
  newShares: new Decimal(newShares),
  oldShares: new Decimal(oldShares),
});

describe('parseSplitRatio', () => {
  it('parses a forward ratio as new:old', () => {
    const parsed = parseSplitRatio('20:1');
    expect(parsed?.newShares.toString()).toBe('20');
    expect(parsed?.oldShares.toString()).toBe('1');
  });

  it('parses a reverse ratio', () => {
    const parsed = parseSplitRatio('1:25');
    expect(parsed?.newShares.toString()).toBe('1');
    expect(parsed?.oldShares.toString()).toBe('25');
  });

  it('parses a fractional ratio', () => {
    const parsed = parseSplitRatio('2.1796:1');
    expect(parsed?.newShares.toString()).toBe('2.1796');
  });

  it('tolerates surrounding and inner whitespace', () => {
    expect(parseSplitRatio(' 3 : 2 ')?.newShares.toString()).toBe('3');
  });

  it('accepts 1:1 as well-formed (rejection belongs to the schema)', () => {
    expect(parseSplitRatio('1:1')).not.toBeNull();
  });

  it.each(['', '2', '0:1', '1:0', 'a:b', '-2:1', '1:-2', '2::1', '{"splitRatio":"2:1"}'])(
    'rejects %s',
    (bad) => {
      expect(parseSplitRatio(bad)).toBeNull();
    },
  );
});

describe('formatSplitRatio / invertRatio', () => {
  it('formats as new:old', () => {
    expect(formatSplitRatio(r('1', '25'))).toBe('1:25');
  });

  it('inverts by swapping the two sides', () => {
    expect(formatSplitRatio(invertRatio(r('1', '25')))).toBe('25:1');
  });

  it('round-trips through parse → invert → invert', () => {
    const once = invertRatio(parseSplitRatio('2.1796:1')!);
    const twice = invertRatio(once);
    expect(formatSplitRatio(twice)).toBe('2.1796:1');
  });
});

describe('splitSharesDb — shares are scaled x1e8', () => {
  it('20-for-1 forward split multiplies share count by 20', () => {
    // 10 shares -> 200 shares
    expect(splitSharesDb(10 * 1e8, r('20', '1'))).toBe(200 * 1e8);
  });

  it('1-for-25 reverse split divides share count by 25', () => {
    // 250 shares -> 10 shares
    expect(splitSharesDb(250 * 1e8, r('1', '25'))).toBe(10 * 1e8);
  });

  it('fractional ratio produces fractional shares on the 1e-8 grid', () => {
    // 10 shares x 2.1796 = 21.796 shares
    expect(splitSharesDb(10 * 1e8, r('2.1796', '1'))).toBe(2179600000);
  });

  it('leaves a zero share count at zero (cash-side rows are unaffected)', () => {
    expect(splitSharesDb(0, r('1', '25'))).toBe(0);
  });

  it('rounds half to even at the scaled-integer grid', () => {
    // 1 unit / 2 = 0.5 -> 0 (even);  3 units / 2 = 1.5 -> 2 (even)
    expect(splitSharesDb(1, r('1', '2'))).toBe(0);
    expect(splitSharesDb(3, r('1', '2'))).toBe(2);
  });
});

describe('splitQuoteDb — quotes are scaled x1e8 and move inversely', () => {
  it('20-for-1 forward split divides the quote by 20', () => {
    // 2443.00 -> 122.15
    expect(splitQuoteDb(244300000000, r('20', '1'))).toBe(12215000000);
  });

  it('1-for-25 reverse split multiplies the quote by 25', () => {
    // 4.00 -> 100.00
    expect(splitQuoteDb(400000000, r('1', '25'))).toBe(10000000000);
  });

  it('rounds half to even at the scaled-integer grid', () => {
    expect(splitQuoteDb(1, r('2', '1'))).toBe(0);
    expect(splitQuoteDb(3, r('2', '1'))).toBe(2);
  });

  it('is the exact inverse operation of splitSharesDb for the same ratio', () => {
    const ratio = r('20', '1');
    expect(splitQuoteDb(splitSharesDb(500 * 1e8, ratio), ratio)).toBe(500 * 1e8);
  });
});

describe('readSplitDetails — tolerant reader for stored event details', () => {
  it('reads the plain new:old storage format', () => {
    expect(formatSplitRatio(readSplitDetails('1:25')!)).toBe('1:25');
  });

  it('reads the legacy JSON shape', () => {
    expect(formatSplitRatio(readSplitDetails('{"splitRatio":"1:25"}')!)).toBe('1:25');
  });

  it('returns null for JSON without a usable ratio', () => {
    expect(readSplitDetails('{"foo":1}')).toBeNull();
    expect(readSplitDetails('{"splitRatio":"nope"}')).toBeNull();
    expect(readSplitDetails('{}')).toBeNull();
  });

  it('returns null for free text', () => {
    expect(readSplitDetails('one for twenty-five')).toBeNull();
  });
});
