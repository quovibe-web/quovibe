// Tests for the structural XML sniff used by the Portfolio Performance XML
// import to block "obviously not XML" files before POST (BUG-09). The
// heuristic runs against the first ~4 KB of the file (decoded to text) and is
// intentionally loose: its only job is to reject binaries and plain-text
// garbage. PP-specific root-element validation remains on the server.
import { describe, it, expect } from 'vitest';
import { sniffLikelyXml } from './xml-sniff';

describe('sniffLikelyXml', () => {
  it('rejects content with a null byte as NOT_TEXT (binary masquerading as .xml)', () => {
    const result = sniffLikelyXml('<?xml version="1.0"?>\n<client>\x00\x01</client>');
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('NOT_TEXT');
  });

  it('rejects text that does not start with an angle bracket', () => {
    const result = sniffLikelyXml('This is not XML, just plain text.');
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('NO_XML_PROLOG_OR_ROOT');
  });

  it('rejects empty input', () => {
    const result = sniffLikelyXml('');
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('NO_XML_PROLOG_OR_ROOT');
  });

  it('accepts a well-formed PP-style export', () => {
    const result = sniffLikelyXml('<?xml version="1.0" encoding="UTF-8"?>\n<client>\n  <portfolios id="1"/>\n</client>');
    expect(result.ok).toBe(true);
    expect(result.reason).toBe(null);
  });

  it('accepts XML with leading whitespace', () => {
    const result = sniffLikelyXml('   \n\t<?xml version="1.0"?><client/>');
    expect(result.ok).toBe(true);
  });

  it('accepts XML with a leading UTF-8 BOM', () => {
    const result = sniffLikelyXml('\uFEFF<?xml version="1.0"?><client/>');
    expect(result.ok).toBe(true);
  });

  it('accepts XML without a prolog (bare root element)', () => {
    const result = sniffLikelyXml('<client><portfolios id="1"/></client>');
    expect(result.ok).toBe(true);
  });
});
