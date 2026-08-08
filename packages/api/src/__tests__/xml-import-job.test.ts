// Contract for the asynchronous PP-XML import.
//
// A large export takes minutes to convert. Holding the upload request open for
// that long is not survivable — some hop between browser and process (a reverse
// proxy's 60 s idle read, Node's own 120 s socket timeout) cuts the connection
// while the server keeps working, and the import completes against a socket
// nobody reads: server logs success, user sees a generic failure. The upload
// now returns 202 { jobId } as soon as the file is accepted, and the outcome is
// collected by polling. These tests pin that contract.
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import path from 'path';
import { mkdtempSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import request from 'supertest';
import type { Express } from 'express';
import Database from 'better-sqlite3';
import { importSummarySchema } from '@quovibe/shared';

const tmp = mkdtempSync(path.join(tmpdir(), 'qv-xml-job-'));
process.env.QUOVIBE_DATA_DIR = tmp;
process.env.QUOVIBE_DEMO_SOURCE = path.join(tmp, 'demo-src.db');
process.env.QUOVIBE_IMPORT_LOCK_FILE = path.join(tmp, 'import.lock');

// Test-controlled stand-in for the ppxml2db pipeline. Each case installs the
// behaviour it needs (resolve with a real bootstrapped DB, hang, or reject).
const control = vi.hoisted(() => ({
  impl: null as null | (() => Promise<{ tempDbPath: string }>),
}));

vi.mock('../services/import.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/import.service')>();
  return {
    ...actual,
    runImport: vi.fn(() => {
      if (!control.impl) throw new Error('test did not install a runImport impl');
      return control.impl();
    }),
  };
});

let applyBootstrap: typeof import('../db/apply-bootstrap').applyBootstrap;
let createApp: typeof import('../create-app').createApp;
let loadSettings: typeof import('../services/settings.service').loadSettings;
let recoverFromInterruptedSwap: typeof import('../services/boot-recovery').recoverFromInterruptedSwap;
let ImportError: typeof import('../services/import.service').ImportError;

/** A freshly bootstrapped DB standing in for ppxml2db's output. */
function buildConvertedDb(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'qv-xml-job-db-'));
  const dbPath = path.join(dir, 'imported.db');
  const db = new Database(dbPath);
  try {
    applyBootstrap(db);
    db.exec("INSERT OR IGNORE INTO vf_portfolio_meta (key, value) VALUES ('name','Converted')");
  } finally {
    db.close();
  }
  return dbPath;
}

const VALID_XML = '<?xml version="1.0"?><client><account id="a1"/></client>';

function upload(app: Express, filename = 'export.xml'): request.Test {
  return request(app)
    .post('/api/import/xml')
    .attach('file', Buffer.from(VALID_XML), { filename, contentType: 'application/xml' });
}

interface JobBody {
  id: string;
  state: 'running' | 'done' | 'error';
  finishedAt: string | null;
  result?: { entry: { id: string; name: string }; summary: unknown };
  error?: { code: string; status: number; details?: Record<string, unknown> };
}

/** Polls until the job leaves `running`, or fails the test. */
async function pollUntilSettled(app: Express, jobId: string): Promise<JobBody> {
  for (let attempt = 0; attempt < 100; attempt++) { // native-ok
    const res = await request(app).get(`/api/import/jobs/${jobId}`);
    expect(res.status, `poll returned ${res.status} ${JSON.stringify(res.body)}`).toBe(200);
    const body = res.body as JobBody;
    if (body.state !== 'running') return body;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`job ${jobId} never settled`);
}

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
  ({ ImportError } = await import('../services/import.service'));
  await import('../services/portfolio-registry');
});

function freshApp(): Express {
  loadSettings();
  recoverFromInterruptedSwap();
  return createApp();
}

beforeEach(() => {
  control.impl = null;
});

describe('POST /api/import/xml — accepts and returns a job', () => {
  it('responds 202 with a jobId instead of holding the request open', async () => {
    control.impl = () => Promise.resolve({ tempDbPath: buildConvertedDb() });
    const app = freshApp();

    const res = await upload(app, 'accepted.xml');

    expect(res.status, `got ${res.status} ${JSON.stringify(res.body)}`).toBe(202);
    expect(typeof res.body.jobId).toBe('string');
    expect(res.body.jobId.length).toBeGreaterThan(0);
    // The response must not carry the outcome — that is the whole point.
    expect(res.body.entry).toBeUndefined();
    expect(res.body.summary).toBeUndefined();

    await pollUntilSettled(app, res.body.jobId);
  });

  it('the job settles to done carrying the {entry, summary} envelope', async () => {
    control.impl = () => Promise.resolve({ tempDbPath: buildConvertedDb() });
    const app = freshApp();

    const started = await upload(app, 'envelope.xml');
    const job = await pollUntilSettled(app, started.body.jobId);

    expect(job.state, JSON.stringify(job)).toBe('done');
    expect(job.finishedAt).not.toBeNull();
    expect(job.result?.entry.name).toBe('envelope');
    expect(() => importSummarySchema.parse(job.result?.summary)).not.toThrow();
  });

  it('a second upload while a job runs returns 409 IMPORT_IN_PROGRESS', async () => {
    let release: (() => void) | null = null;
    control.impl = () =>
      new Promise((resolve) => {
        release = () => resolve({ tempDbPath: buildConvertedDb() });
      });
    const app = freshApp();

    const first = await upload(app, 'first.xml');
    expect(first.status).toBe(202);

    const uploadDirBefore = readdirSync(path.join(tmp, 'tmp')).length;

    const second = await upload(app, 'second.xml');
    expect(second.status, `got ${second.status} ${JSON.stringify(second.body)}`).toBe(409);
    expect(second.body.error).toBe('IMPORT_IN_PROGRESS');

    // multer wrote the loser's upload to disk before the handler ran; the 409
    // branch has to reap it or it sits there until the next boot sweep.
    expect(
      readdirSync(path.join(tmp, 'tmp')).length,
      `rejected upload left a temp file behind: ${JSON.stringify(readdirSync(path.join(tmp, 'tmp')))}`,
    ).toBe(uploadDirBefore);

    release!();
    await pollUntilSettled(app, first.body.jobId);
  });

  it('reports the running job on /api/import/status so a lost 202 can re-attach', async () => {
    let release: (() => void) | null = null;
    control.impl = () =>
      new Promise((resolve) => {
        release = () => resolve({ tempDbPath: buildConvertedDb() });
      });
    const app = freshApp();

    const started = await upload(app, 'reattach.xml');
    const status = await request(app).get('/api/import/status');

    expect(status.body.inProgress).toBe(true);
    expect(status.body.activeJobId).toBe(started.body.jobId);

    release!();
    await pollUntilSettled(app, started.body.jobId);

    const after = await request(app).get('/api/import/status');
    expect(after.body.inProgress).toBe(false);
    expect(after.body.activeJobId).toBeNull();
  });

  it('structural validation still rejects on the upload response, not via the job', async () => {
    control.impl = () => Promise.reject(new Error('runImport must not be reached'));
    const app = freshApp();

    const res = await request(app)
      .post('/api/import/xml')
      .attach('file', Buffer.from('<wrong-root id="x"/>'), {
        filename: 'wrong-root.xml',
        contentType: 'application/xml',
      });

    expect(res.status, `got ${res.status} ${JSON.stringify(res.body)}`).toBe(400);
    expect(res.body.error).toBe('INVALID_FORMAT');
  });
});

describe('GET /api/import/jobs/:jobId', () => {
  it('unknown job id returns 404 JOB_NOT_FOUND', async () => {
    const app = freshApp();
    const res = await request(app).get('/api/import/jobs/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('JOB_NOT_FOUND');
  });

  it('a converter failure settles as an error carrying code + would-be status', async () => {
    control.impl = () =>
      Promise.reject(new ImportError('CONVERSION_FAILED', 'Error during ppxml2db conversion'));
    const app = freshApp();

    const started = await upload(app, 'boom.xml');
    const job = await pollUntilSettled(app, started.body.jobId);

    expect(job.state).toBe('error');
    expect(job.error?.code).toBe('CONVERSION_FAILED');
    expect(job.error?.status).toBe(500);
    // BUG-96 posture survives the move to a job body: CONVERSION_FAILED never
    // carries details, since its message concatenates ppxml2db stderr.
    expect(job.error?.details).toBeUndefined();
  });

  it('a non-ImportError failure is sanitized to a bare CONVERSION_FAILED', async () => {
    control.impl = () =>
      Promise.reject(new Error("ENOENT: no such file or directory, open 'C:\\\\srv\\\\quovibe\\\\data\\\\tmp\\\\x.xml'"));
    const app = freshApp();

    const started = await upload(app, 'raw-error.xml');
    const job = await pollUntilSettled(app, started.body.jobId);

    expect(job.state).toBe('error');
    expect(job.error?.code).toBe('CONVERSION_FAILED');
    expect(JSON.stringify(job)).not.toMatch(/ENOENT|C:\\\\/);
  });

  it('a duplicate name settles as 409 DUPLICATE_NAME carrying the colliding name', async () => {
    control.impl = () => Promise.resolve({ tempDbPath: buildConvertedDb() });
    const app = freshApp();

    const first = await upload(app, 'twins.xml');
    await pollUntilSettled(app, first.body.jobId);

    const second = await upload(app, 'twins.xml');
    const job = await pollUntilSettled(app, second.body.jobId);

    expect(job.state, JSON.stringify(job)).toBe('error');
    expect(job.error?.code).toBe('DUPLICATE_NAME');
    expect(job.error?.status).toBe(409);
    expect(job.error?.details?.name).toBe('twins');
  });
});
