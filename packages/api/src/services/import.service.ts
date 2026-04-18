import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import * as cheerio from 'cheerio';
import { v4 as uuidv4 } from 'uuid'; // uuid is already in packages/api/package.json
import { verifySchema } from '../db/verify';
import { applyBootstrap } from '../db/apply-bootstrap';

const execFileAsync = promisify(execFile);

// Resolve vendor dir: in a standard tsc build __dirname = dist/services/ so ../../vendor works.
// The Dockerfile strips dist/ when copying, making __dirname = services/ so ../vendor is needed.
const _vendorStandard = path.resolve(__dirname, '../../vendor');
const _vendorStripped  = path.resolve(__dirname, '../vendor');
const VENDOR_DIR = fs.existsSync(_vendorStripped) ? _vendorStripped : _vendorStandard;
const LOCK_FILE = path.join(os.tmpdir(), 'quovibe-import.lock');

export class ImportError extends Error {
  constructor(
    public readonly code: 'INVALID_XML' | 'INVALID_FORMAT' | 'ENCRYPTED_FORMAT' |
                           'IMPORT_IN_PROGRESS' | 'CONVERSION_FAILED' |
                           'FILE_TOO_LARGE' | 'INVALID_FILE_FORMAT' | 'NO_FILE',
    message: string,
    public readonly details?: string,
  ) {
    super(message);
    this.name = 'ImportError';
  }
}

/** Returns true if an import is currently in progress (with stale lock detection) */
export function isImportInProgress(): boolean {
  if (!fs.existsSync(LOCK_FILE)) return false;
  try {
    const content = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf-8'));
    const age = Date.now() - (content.ts ?? 0);
    if (age > 5 * 60 * 1000) {
      // Stale lock (>5 min, ppxml2db timeout is 110s) — remove and allow new import
      fs.unlinkSync(LOCK_FILE);
      return false;
    }
  } catch {
    // Malformed lock file — remove and allow new import
    try { fs.unlinkSync(LOCK_FILE); } catch { /* ok */ }
    return false;
  }
  return true;
}

/**
 * Validate that the XML file is a valid portfolio export
 * in "XML with ID attributes" format (unencrypted).
 * Throws ImportError on failure.
 */
export function validateXmlFormat(xmlPath: string): void {
  let content: string;
  try {
    content = fs.readFileSync(xmlPath, 'utf-8');
  } catch {
    throw new ImportError('INVALID_XML', 'Impossibile leggere il file XML');
  }

  // Must be parseable XML
  if (!content.trimStart().startsWith('<')) {
    throw new ImportError('ENCRYPTED_FORMAT', 'Il file non è XML (potrebbe essere cifrato)');
  }

  // Parse with cheerio in XML mode
  const $ = cheerio.load(content, { xmlMode: true });
  const root = $.root().children().first();

  // Root element must be <client>
  const rootName = (root[0] as { name?: string })?.name;
  if (rootName !== 'client') {
    throw new ImportError(
      'INVALID_FORMAT',
      `Root element '${rootName}' non riconosciuto. Atteso: 'client'`,
    );
  }

  // At least one element anywhere in the document must have an 'id' attribute
  // (distinguishes "XML with ID attributes" from other export formats).
  // In real exports, id attributes are on entities (security, account, portfolio),
  // not on container elements (securities, accounts) — so we check all descendants.
  const hasIdAttrs = root.find('[id]').length > 0;
  if (!hasIdAttrs) {
    throw new ImportError(
      'INVALID_FORMAT',
      'Il file XML non ha attributi ID. Esporta con: File → Salva come → XML con attributi ID',
    );
  }
}

export interface ImportResult {
  tempDbPath: string;
  accounts: number;
  securities: number;
}

/**
 * Run the full import pipeline:
 * 1. Validate XML format
 * 2. Convert XML → temp SQLite via ppxml2db
 * 3. Validate output schema
 * 4. Apply bootstrap DDL to temp DB
 * 5. Return { tempDbPath, accounts, securities }
 *
 * The caller (route handler) is responsible for the DB lifecycle:
 * close live DB, backup, swap files — via reloadApp() in index.ts.
 */
export async function runImport(xmlPath: string): Promise<ImportResult> {
  const uuid = uuidv4();
  const tempDbPath = path.join(os.tmpdir(), `quovibe-${uuid}.db`);
  const tempXmlPath = xmlPath; // already saved by multer

  // Create lock (exclusive create prevents TOCTOU race with concurrent requests)
  try {
    fs.writeFileSync(LOCK_FILE, JSON.stringify({ id: uuid, pid: process.pid, ts: Date.now() }), { flag: 'wx' });
  } catch {
    throw new ImportError('IMPORT_IN_PROGRESS', 'Import già in corso');
  }

  try {
    // Step 3: Validate XML format (fast, no Python)
    validateXmlFormat(tempXmlPath);

    // Step 4: Run ppxml2db conversion
    // ppxml2db.py requires explicit output db path: ppxml2db.py <xml_file> <db>
    const ppxml2dbPath = path.join(VENDOR_DIR, 'ppxml2db.py');

    // Python resolution is platform-specific.
    //
    // Windows: the canonical launcher is `py.exe` (shipped with every official CPython
    //   installer, always in PATH). `py -3` picks any installed Python 3.x even when
    //   `python.exe` / `python3.exe` are NOT in PATH (common on modern installs because
    //   MS Store stubs take precedence). If `py` is missing we fall back to the older
    //   `python` / `python3` candidates.
    //
    // POSIX: follow symlinks to the real binary to avoid execFile ENOENT on symlinks
    //   (observed in Alpine/Docker on Node.js v22). realpathSync throws if the path
    //   doesn't exist, so we catch and try the next candidate.
    const isWindows = process.platform === 'win32';
    let pythonCmd: string;
    let pythonPrefixArgs: string[];
    if (isWindows) {
      const winCandidates: Array<{ cmd: string; args: string[] }> = [
        { cmd: 'py',      args: ['-3'] },
        { cmd: 'python',  args: [] },
        { cmd: 'python3', args: [] },
      ];
      const picked = winCandidates[0];      // py is standard; fallback attempts happen at runtime if it fails
      pythonCmd = picked.cmd;
      pythonPrefixArgs = picked.args;
    } else {
      const posixCandidates = ['/usr/bin/python3', '/usr/local/bin/python3', 'python3'];
      pythonCmd = 'python3';
      for (const candidate of posixCandidates) {
        if (!candidate.includes('/')) { pythonCmd = candidate; break; }
        try {
          pythonCmd = fs.realpathSync(candidate);
          break;
        } catch { /* not found, try next */ }
      }
      pythonPrefixArgs = [];
    }

    // ⚠️ LOAD-BEARING ORDERING INVARIANT: bootstrap FIRST, then ppxml2db.py.
    //
    // ppxml2db.py only INSERTs; the sibling ppxml2db_init.py script is what
    // creates the schema from vendor/*.sql. We skip the init script because
    // bootstrap.sql is our own single DDL truth (ADR-015 §3.3) and carries the
    // same 24 core tables PLUS our 5 `vf_*` tables. Running bootstrap against
    // the empty temp DB is functionally equivalent to the init script.
    //
    // Every DDL statement in bootstrap.sql uses IF NOT EXISTS so running it
    // first is idempotent. Skipping this step makes the first ppxml2db.py
    // INSERT fail with `sqlite3.OperationalError: no such table: price`.
    const emptyDb = new Database(tempDbPath);
    try {
      applyBootstrap(emptyDb);
    } finally {
      emptyDb.close();
    }

    const runPython = async (cmd: string, prefixArgs: string[]): Promise<void> => {
      await execFileAsync(cmd, [...prefixArgs, ppxml2dbPath, tempXmlPath, tempDbPath], {
        timeout: 110_000, // under the 120s route timeout
        env: { ...process.env },
        cwd: VENDOR_DIR, // so ppxml2db can import dbhelper and version modules
      });
    };
    try {
      try {
        await runPython(pythonCmd, pythonPrefixArgs);
      } catch (primaryErr) {
        // Windows fallback: if `py` isn't installed, try `python` / `python3` directly
        // before giving up. ENOENT is the only primaryErr shape we retry on.
        const code = (primaryErr as NodeJS.ErrnoException).code;
        if (!isWindows || code !== 'ENOENT') throw primaryErr;
        try {
          await runPython('python', []);
        } catch {
          await runPython('python3', []);
        }
      }
    } catch (err: unknown) {
      const details = err instanceof Error ? err.message : String(err);
      throw new ImportError('CONVERSION_FAILED', 'Errore durante la conversione ppxml2db', details);
    }

    if (!fs.existsSync(tempDbPath)) {
      throw new ImportError('CONVERSION_FAILED', 'ppxml2db non ha prodotto il file .db atteso');
    }

    // Step 5: Validate schema of converted DB
    const tmpDb = new Database(tempDbPath, { readonly: true });
    let schemaResult: ReturnType<typeof verifySchema>;
    try {
      schemaResult = verifySchema(tmpDb);
    } finally {
      tmpDb.close();
    }

    if (!schemaResult.valid) {
      throw new ImportError(
        'INVALID_FORMAT',
        `Schema DB non valido. Tabelle mancanti: ${schemaResult.missing.join(', ')}`,
      );
    }

    // Apply bootstrap DDL to the temp DB (not the live DB — caller handles the swap)
    const newDb = new Database(tempDbPath);
    let accounts = 0;
    let securities = 0;
    try {
      applyBootstrap(newDb);

      // Count imported data
      accounts = (newDb.prepare('SELECT COUNT(*) as cnt FROM account').get() as { cnt: number }).cnt;
      securities = (newDb.prepare('SELECT COUNT(*) as cnt FROM security').get() as { cnt: number }).cnt;
    } finally {
      newDb.close();
    }

    return { tempDbPath, accounts, securities };

  } finally {
    // Only remove lock if it belongs to this import (prevents deleting a newer import's lock)
    try {
      const lock = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf-8'));
      if (lock.id === uuid) fs.unlinkSync(LOCK_FILE);
    } catch { /* lock already removed or malformed — ok */ }

    // Cleanup temp files (NOT tempDbPath — caller handles it after file swap)
    try { fs.unlinkSync(tempXmlPath); } catch { /* ok if not present */ }
  }
}
