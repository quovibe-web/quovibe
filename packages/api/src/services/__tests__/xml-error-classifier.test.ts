// BUG-PRE14-02: ppxml2db crashes that originate from malformed-but-
// superficially-valid input XML must be promoted from 500 CONVERSION_FAILED
// to 400 INVALID_FORMAT. The classifier scans stderr for Python exception
// patterns; it never echoes the matched substring on the wire.
import { describe, it, expect } from 'vitest';
import { looksLikeUserXmlBug } from '../import.service';

describe('looksLikeUserXmlBug (BUG-PRE14-02)', () => {
  it.each([
    'AssertionError',
    'KeyError',
    'AttributeError',
    'TypeError',
    'ValueError',
    'IndexError',
    'ParseError',
    'SyntaxError',
    'ExpatError',
    'xml.etree.ElementTree.ParseError',
    'ElementTree.ParseError',
  ])('classifies %s as user-XML bug', (name) => {
    const stderr = `Traceback (most recent call last):\n  File "ppxml2db.py", line 42, in <module>\n${name}: missing required attribute`;
    expect(looksLikeUserXmlBug(stderr)).toBe(true);
  });

  it('returns false for plain subprocess crashes (ENOENT, OSError)', () => {
    expect(looksLikeUserXmlBug('execFile ENOENT: python3 not found')).toBe(false);
    expect(looksLikeUserXmlBug('Command failed with exit code 137 SIGKILL')).toBe(false);
    expect(looksLikeUserXmlBug('OSError: [Errno 13] Permission denied')).toBe(false);
  });

  it('returns false for sqlite3.IntegrityError (deliberate carve-out)', () => {
    // The BUG-96 sanitization fixture stages a NOT NULL constraint failure
    // shape. That stderr is ambiguous (could be schema-mismatch on the
    // server side); we keep it as 500 so the BUG-96 regression assertion
    // (`expect(status).toBe(500)`) stays green.
    const stderr =
      'Command failed: py -3 ppxml2db.py probe.xml\n' +
      'sqlite3.IntegrityError: NOT NULL constraint failed: account.uuid';
    expect(looksLikeUserXmlBug(stderr)).toBe(false);
  });

  it('matches when an exception class appears mid-traceback', () => {
    const stderr = [
      'Traceback (most recent call last):',
      '  File "ppxml2db.py", line 100, in convert',
      '    self._consume_security(elem)',
      '  File "ppxml2db.py", line 250, in _consume_security',
      '    self.sec_lookup[security_xmlid] = security_uuid',
      "AssertionError: security xmlid '7' not found in lookup",
    ].join('\n');
    expect(looksLikeUserXmlBug(stderr)).toBe(true);
  });

  it('returns false on empty / non-string stderr', () => {
    expect(looksLikeUserXmlBug('')).toBe(false);
    expect(looksLikeUserXmlBug('something completely unrelated')).toBe(false);
  });
});
