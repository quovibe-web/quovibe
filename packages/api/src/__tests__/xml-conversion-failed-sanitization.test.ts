// BUG-96 regression: when ppxml2db crashes, `execFileAsync`'s rejected Error
// message carries the full Python traceback + absolute server install path +
// user home tmpdir + internal SQLite constraint names. The service layer
// must log that server-side and throw an ImportError without the `details`
// arg, and the route layer must emit `{error:'CONVERSION_FAILED'}` with NO
// `details` field. This test forces a deterministic traceback-shaped
// rejection (no Python required in CI) and asserts the wire is clean.
//
// Parallel posture to BUG-94's rename-race leak path in
// `xml-upload-hardening.test.ts`. Both must stay green together.
import { describe, it, expect, vi, beforeAll } from 'vitest';
import path from 'path';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import request from 'supertest';
import Database from 'better-sqlite3';

const tmp = mkdtempSync(path.join(tmpdir(), 'qv-xml-conv-'));
process.env.QUOVIBE_DATA_DIR = tmp;
process.env.QUOVIBE_DEMO_SOURCE = path.join(tmp, 'demo-src.db');
// Per-suite import lock so parallel test files don't clobber each other.
process.env.QUOVIBE_IMPORT_LOCK_FILE = path.join(tmp, 'import.lock');

// Deterministic ppxml2db failure: force the callback-style execFile
// (which import.service wraps via util.promisify) to reject with an Error
// whose message mirrors the real QA-5 leak payload. Rest of child_process
// is re-exported via importActual so nothing else breaks.
vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return {
    ...actual,
    execFile: (
      _cmd: string,
      _args: readonly string[],
      _opts: unknown,
      cb: (err: NodeJS.ErrnoException | null, stdout?: string, stderr?: string) => void,
    ) => {
      const leak = new Error(
        "Command failed: py -3 C:\\quovibe\\packages\\api\\vendor\\ppxml2db.py " +
        "C:\\Users\\pibel\\AppData\\Local\\Temp\\probe.xml\r\n" +
        "Traceback (most recent call last):\r\n" +
        "  File \"C:\\quovibe\\packages\\api\\vendor\\ppxml2db.py\", line 584, in <module>\r\n" +
        "    conv.iterparse()\r\n" +
        "sqlite3.IntegrityError: NOT NULL constraint failed: account.uuid\r\n",
      );
      cb(leak);
    },
  };
});

let applyBootstrap: typeof import('../db/apply-bootstrap').applyBootstrap;
let createApp: typeof import('../create-app').createApp;
let loadSettings: typeof import('../services/settings.service').loadSettings;
let recoverFromInterruptedSwap: typeof import('../services/boot-recovery').recoverFromInterruptedSwap;

beforeAll(async () => {
  ({ applyBootstrap } = await import('../db/apply-bootstrap'));
  const db = new Database(process.env.QUOVIBE_DEMO_SOURCE!);
  try {
    applyBootstrap(db);
    db.exec("INSERT INTO vf_portfolio_meta (key, value) VALUES ('name','Demo')");
  } finally {
    db.close();
  }
  ({ createApp } = await import('../create-app'));
  ({ loadSettings } = await import('../services/settings.service'));
  ({ recoverFromInterruptedSwap } = await import('../services/boot-recovery'));
  await import('../services/portfolio-registry');
});

describe('POST /api/import/xml CONVERSION_FAILED sanitization (BUG-96)', () => {
  it('CONVERSION_FAILED body carries NO details, even when ppxml2db stderr leaks a Python traceback + absolute paths', async () => {
    loadSettings();
    recoverFromInterruptedSwap();
    const app = createApp();

    // Passes multer's fileFilter + size limit; passes validateXmlFormat's
    // root=`client` + has-id check, so the request reaches the mocked
    // execFile and exits through the service-layer CONVERSION_FAILED path.
    const xml = '<?xml version="1.0"?><client><account id="a1"/></client>';

    const res = await request(app)
      .post('/api/import/xml')
      .attach('file', Buffer.from(xml), {
        filename: 'probe.xml',
        contentType: 'application/xml',
      });

    expect(res.status, `got ${res.status} ${JSON.stringify(res.body)}`).toBe(500);
    expect(res.body.error).toBe('CONVERSION_FAILED');
    expect(res.body.details, 'CONVERSION_FAILED must not carry details (BUG-96 posture)').toBeUndefined();

    // Full response text must not contain any fragment of the raw subprocess
    // error. If a future regression re-adds `details: err.message` in the
    // service or the route fallback, one of these will go red.
    const haystack = JSON.stringify(res.body) + (res.text ?? '');
    const leakPatterns: readonly RegExp[] = [
      /Traceback/,
      /ppxml2db\.py/,
      /C:\\quovibe/,
      /AppData\\Local\\Temp/,
      /sqlite3/,
      /IntegrityError/,
      /account\.uuid/,
    ];
    for (const pat of leakPatterns) {
      expect(haystack, `response leaked ${pat}: ${haystack}`).not.toMatch(pat);
    }
  });
});
