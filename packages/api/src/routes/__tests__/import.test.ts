import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

// We test only the pure validation function (no subprocess needed)
import { validateXmlFormat, ImportError } from '../../services/import.service';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quovibe-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeXml(filename: string, content: string): string {
  const p = path.join(tmpDir, filename);
  fs.writeFileSync(p, content, 'utf-8');
  return p;
}

describe('validateXmlFormat', () => {
  it('accepts a valid XML with id attributes', () => {
    const xmlPath = writeXml('valid.xml', `<?xml version="1.0"?>
<client>
  <portfolios id="1">
    <portfolio id="2" name="Test"/>
  </portfolios>
  <securities id="3"/>
</client>`);
    expect(() => validateXmlFormat(xmlPath)).not.toThrow();
  });

  it('rejects non-XML content as ENCRYPTED_FORMAT', () => {
    const xmlPath = writeXml('binary.xml', '\x00\x01\x02encrypted binary content');
    expect(() => validateXmlFormat(xmlPath))
      .toThrow(expect.objectContaining({ code: 'ENCRYPTED_FORMAT' }));
  });

  it('rejects XML with wrong root element as INVALID_FORMAT', () => {
    const xmlPath = writeXml('wrong-root.xml', '<portfolio><accounts/></portfolio>');
    expect(() => validateXmlFormat(xmlPath))
      .toThrow(expect.objectContaining({ code: 'INVALID_FORMAT' }));
  });

  it('rejects XML without id attributes as INVALID_FORMAT', () => {
    const xmlPath = writeXml('no-ids.xml', `<client>
  <portfolios>
    <portfolio name="Test"/>
  </portfolios>
</client>`);
    expect(() => validateXmlFormat(xmlPath))
      .toThrow(expect.objectContaining({ code: 'INVALID_FORMAT' }));
  });

  it('throws INVALID_XML for unreadable file', () => {
    expect(() => validateXmlFormat('/tmp/does-not-exist-quovibe.xml'))
      .toThrow(expect.objectContaining({ code: 'INVALID_XML' }));
  });
});

describe('ImportError', () => {
  it('has correct code and name', () => {
    const err = new ImportError('CONVERSION_FAILED', 'test', 'details');
    expect(err.code).toBe('CONVERSION_FAILED');
    expect(err.name).toBe('ImportError');
    expect(err.details).toBe('details');
  });
});
