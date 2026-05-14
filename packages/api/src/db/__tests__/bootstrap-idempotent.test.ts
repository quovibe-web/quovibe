// packages/api/src/db/__tests__/bootstrap-idempotent.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { execFileSync } from 'child_process';
import { join } from 'path';
import { tmpdir } from 'os';
import { mkdtempSync, existsSync, rmSync } from 'fs';
import { applyBootstrap } from '../apply-bootstrap';

// Windows adaptation: the plan says `python3`, but on this workstation Python 3.13
// is reachable via the `py` launcher. Prefer env override, fall back to py, then python3.
const PYTHON_CMD = process.env.PYTHON_CMD ?? (process.platform === 'win32' ? 'py' : 'python3');

const VENDOR_DIR = join(__dirname, '..', '..', '..', 'vendor');

function dumpSchema(db: Database.Database): string {
  const rows = db.prepare(
    `SELECT type, name, tbl_name, sql FROM sqlite_master
     WHERE name NOT LIKE 'sqlite_%'
     ORDER BY type, name`,
  ).all();
  return JSON.stringify(rows, null, 2);
}

// Per-test tracked resources so afterEach can clean up even on assertion failure.
let openedDb: Database.Database | undefined;
let tmpDir: string | undefined;

afterEach(() => {
  openedDb?.close();
  openedDb = undefined;
  if (tmpDir && existsSync(tmpDir)) {
    rmSync(tmpDir, { recursive: true, force: true });
  }
  tmpDir = undefined;
});

function emptyDb(): Database.Database {
  openedDb = new Database(':memory:');
  return openedDb;
}

function populatedPpxml2dbFixture(): Database.Database {
  // Run ppxml2db_init.py against a temp file to get the exact vendor shape,
  // then open it. In-memory DBs can't be initialized by an external Python process,
  // so we use a tmpdir.
  tmpDir = mkdtempSync(join(tmpdir(), 'qv-boot-'));
  const dbPath = join(tmpDir, 'f.db');
  const vendorScript = join(VENDOR_DIR, 'ppxml2db_init.py');
  if (!existsSync(vendorScript)) {
    throw new Error(`ppxml2db_init.py not found at ${vendorScript}`);
  }
  // IMPORTANT: ppxml2db_init.py reads its per-table .sql files via relative paths.
  // Must invoke with cwd set to the vendor directory, otherwise it throws
  // FileNotFoundError: account.sql.
  execFileSync(PYTHON_CMD, ['ppxml2db_init.py', dbPath], { cwd: VENDOR_DIR });
  openedDb = new Database(dbPath);
  return openedDb;
}

function legacyApplyExtensionsFixture(): Database.Database {
  // Pre-015 shape: ppxml2db tables + the old vf_exchange_rate created by the
  // retired applyExtensions path. Simulate by running applyBootstrap and then
  // DROPping the vf_* tables that post-dated the old applyExtensions — this
  // reproduces what openDatabase() would see against a DB that was bootstrapped
  // by the legacy code path and not yet migrated forward.
  const db = populatedPpxml2dbFixture();
  applyBootstrap(db);
  db.exec(`
    DROP TABLE IF EXISTS vf_dashboard;
    DROP TABLE IF EXISTS vf_chart_config;
    DROP TABLE IF EXISTS vf_portfolio_meta;
    DROP TABLE IF EXISTS vf_csv_import_config;
  `);
  return db;
}

// Allow skipping the Python-dependent fixtures when the Python launcher isn't
// available (e.g. minimal CI containers). Set SKIP_PPXML_FIXTURE=1 to skip.
const skipPython = process.env.SKIP_PPXML_FIXTURE === '1';

describe('bootstrap.sql is idempotent', () => {
  it('against empty DB', () => {
    const db = emptyDb();
    applyBootstrap(db);
    const first = dumpSchema(db);
    applyBootstrap(db);
    const second = dumpSchema(db);
    expect(second).toEqual(first);
  });

  it.skipIf(skipPython)('against populated ppxml2db baseline', () => {
    const db = populatedPpxml2dbFixture();
    applyBootstrap(db);
    const first = dumpSchema(db);
    applyBootstrap(db);
    const second = dumpSchema(db);
    expect(second).toEqual(first);
  });

  it.skipIf(skipPython)('against legacy pre-015 applyExtensions shape', () => {
    const db = legacyApplyExtensionsFixture();
    applyBootstrap(db);
    const first = dumpSchema(db);
    applyBootstrap(db);
    const second = dumpSchema(db);
    expect(second).toEqual(first);
  });
});
