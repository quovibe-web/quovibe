// BUG-PRE14-02: ppxml2db crashes traceable to user-input XML must surface
// as 400 INVALID_FORMAT, not 500 CONVERSION_FAILED. Mocks execFile to
// reject with an AssertionError-shaped Error and asserts the wire status +
// body. Mirrors the BUG-96 sanitization test's mock pattern; both must
// stay green together.
//
// Stays compatible with BUG-96 info-disclosure posture: even when the wire
// status flips to 400, the response body must NOT echo the raw stderr.
import { describe, it, expect, vi, beforeAll } from 'vitest';
import path from 'path';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import request from 'supertest';
import Database from 'better-sqlite3';

const tmp = mkdtempSync(path.join(tmpdir(), 'qv-xml-userconv-'));
process.env.QUOVIBE_DATA_DIR = tmp;
process.env.QUOVIBE_DEMO_SOURCE = path.join(tmp, 'demo-src.db');
process.env.QUOVIBE_IMPORT_LOCK_FILE = path.join(tmp, 'import.lock');

// Deterministic ppxml2db AssertionError.
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
      const userError = new Error(
        "Command failed: py -3 C:\\quovibe\\packages\\api\\vendor\\ppxml2db.py " +
        "C:\\Users\\pibel\\AppData\\Local\\Temp\\probe.xml\r\n" +
        "Traceback (most recent call last):\r\n" +
        "  File \"C:\\quovibe\\packages\\api\\vendor\\ppxml2db.py\", line 250, in _consume_security\r\n" +
        "    self.sec_lookup[security_xmlid] = security_uuid\r\n" +
        "AssertionError: security xmlid '7' not found in lookup\r\n",
      );
      cb(userError);
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

describe('POST /api/import/xml user-XML conversion failures (BUG-PRE14-02)', () => {
  it('Python AssertionError in ppxml2db stderr → 400 INVALID_FORMAT, no leak', async () => {
    loadSettings();
    recoverFromInterruptedSwap();
    const app = createApp();

    const xml = '<?xml version="1.0"?><client><account id="a1"/></client>';

    const res = await request(app)
      .post('/api/import/xml')
      .attach('file', Buffer.from(xml), {
        filename: 'probe.xml',
        contentType: 'application/xml',
      });

    expect(res.status, `got ${res.status} ${JSON.stringify(res.body)}`).toBe(400);
    expect(res.body.error).toBe('INVALID_FORMAT');
    // The user-facing details string is a static English message — does NOT
    // include the matched substring or any subprocess output.
    expect(typeof res.body.details).toBe('string');
    expect(res.body.details).toMatch(/Re-export from the source application/);

    // Even at 400, the BUG-96 leak patterns must stay absent.
    const haystack = JSON.stringify(res.body) + (res.text ?? '');
    const leakPatterns: readonly RegExp[] = [
      /Traceback/,
      /ppxml2db\.py/,
      /C:\\quovibe/,
      /AppData\\Local\\Temp/,
      /AssertionError/,
      /sec_lookup/,
    ];
    for (const pat of leakPatterns) {
      expect(haystack, `response leaked ${pat}: ${haystack}`).not.toMatch(pat);
    }
  });
});
