import { describe, it, expect } from 'vitest';
import { execFile, execSync } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { applyBootstrap } from '../db/apply-bootstrap';

const execFileAsync = promisify(execFile);

// FQNs we need to pin against PP source via subprocess parse.
const matrix = [
  { friendly: 'TEXT',       conv: 'name.abuchen.portfolio.model.AttributeType$StringConverter',       type: 'java.lang.String' },
  { friendly: 'NUMBER',     conv: 'name.abuchen.portfolio.model.AttributeType$NumberConverter',       type: 'java.lang.Double' },
  { friendly: 'PERCENTAGE', conv: 'name.abuchen.portfolio.model.AttributeType$PercentConverter',      type: 'java.lang.Double' },
  { friendly: 'AMOUNT',     conv: 'name.abuchen.portfolio.model.AttributeType$AmountPlainConverter',  type: 'java.lang.Long' },
  { friendly: 'DATE',       conv: 'name.abuchen.portfolio.model.AttributeType$DateConverter',         type: 'java.util.Date' },
  { friendly: 'BOOLEAN',    conv: 'name.abuchen.portfolio.model.AttributeType$BooleanConverter',      type: 'java.lang.Boolean' },
];

function buildClientXml(rows: typeof matrix): string {
  const blocks = rows.map(
    (r, i) => `      <attribute-type>
        <id>roundtrip-${r.friendly.toLowerCase()}-${i}</id>
        <name>RT_${r.friendly}</name>
        <columnLabel>RT_${r.friendly}</columnLabel>
        <target>name.abuchen.portfolio.model.Security</target>
        <type>${r.type}</type>
        <converterClass>${r.conv}</converterClass>
        <properties/>
      </attribute-type>`,
  ).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<client version="1" baseCurrency="EUR">
  <securities/>
  <accounts/>
  <portfolios/>
  <transactions/>
  <plans/>
  <taxonomies/>
  <dashboards/>
  <properties/>
  <settings>
    <bookmarks/>
    <attributeTypes>
${blocks}
    </attributeTypes>
    <configurationSets/>
  </settings>
</client>
`;
}

// Synchronous Python probe — must run before it() so vitest can decide skip vs run.
// On Windows the canonical launcher is `py` (ships with every official CPython installer);
// `python` / `python3` may not be in PATH on modern Windows systems.
// We resolve each candidate to its absolute path via `where` / `which` so that
// execFile can find it even when the Vitest worker's PATH lookup differs from the shell.
const { hasPython, pythonCmd, pythonArgs } = ((): {
  hasPython: boolean;
  pythonCmd: string;
  pythonArgs: string[];
} => {
  const isWindows = process.platform === 'win32';
  const candidates: Array<{ cmd: string; args: string[] }> = isWindows
    ? [
        { cmd: 'py',      args: ['-3'] },
        { cmd: 'python',  args: [] },
        { cmd: 'python3', args: [] },
      ]
    : [
        { cmd: 'python3', args: [] },
        { cmd: 'python',  args: [] },
      ];

  // Resolve a command name to its absolute path so execFile can find it even
  // when the Vitest worker's PATH lookup differs from the shell.
  function resolveAbsolute(cmd: string): string | null {
    try {
      const result = execSync(
        isWindows ? `where ${cmd}` : `which ${cmd}`,
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
      );
      // `where` can return multiple lines; take the first non-empty line
      const firstLine = result.split(/\r?\n/).find(l => l.trim().length > 0);
      return firstLine?.trim() ?? null;
    } catch {
      return null;
    }
  }

  for (const { cmd, args } of candidates) {
    const absPath = resolveAbsolute(cmd);
    if (absPath !== null) {
      // Verify it can actually run Python (probe with --version)
      try {
        execSync(`"${absPath}" --version`, { stdio: 'ignore' });
        return { hasPython: true, pythonCmd: absPath, pythonArgs: args };
      } catch {
        // found but non-functional — try next candidate
      }
    }
  }
  return { hasPython: false, pythonCmd: 'python', pythonArgs: [] };
})();

describe('attribute-type PP-XML round-trip', () => {
  it.skipIf(!hasPython)('all 6 friendlyTypes survive ppxml2db parse byte-equal', async () => {
    const tmp = mkdtempSync(path.join(tmpdir(), 'attr-rt-'));
    try {
      const xmlPath = path.join(tmp, 'roundtrip.xml');
      const dbPath  = path.join(tmp, 'roundtrip.db');
      writeFileSync(xmlPath, buildClientXml(matrix));

      // Bootstrap the empty DB before ppxml2db runs (mirrors import.service.ts behaviour:
      // ppxml2db only INSERTs; the schema must exist first).
      const emptyDb = new Database(dbPath);
      try {
        applyBootstrap(emptyDb);
      } finally {
        emptyDb.close();
      }

      // __dirname is packages/api/src/__tests__ — resolve up to vendor from there
      const ppxml2db = path.resolve(__dirname, '../../vendor/ppxml2db.py');
      const vendorDir = path.resolve(__dirname, '../../vendor');
      await execFileAsync(
        pythonCmd,
        [...pythonArgs, ppxml2db, xmlPath, dbPath],
        {
          timeout: 60_000,
          cwd: vendorDir, // so ppxml2db can import dbhelper and version modules
          env: { ...process.env },
        },
      );

      const db = new Database(dbPath, { readonly: true });
      const rows = db
        .prepare(`SELECT id, name, type, converterClass FROM attribute_type WHERE id LIKE 'roundtrip-%' ORDER BY id`)
        .all() as { id: string; name: string; type: string; converterClass: string }[];
      db.close();

      expect(rows).toHaveLength(matrix.length);
      for (const r of rows) {
        // id is e.g. 'roundtrip-text-0', 'roundtrip-percentage-2'
        const rawFriendly = r.id.split('-')[1];
        const friendly = rawFriendly.toUpperCase();
        const expected = matrix.find(m => m.friendly === friendly);
        expect(expected, `No matrix entry for friendly=${friendly} (id=${r.id})`).toBeDefined();
        expect(r.type, `type mismatch for ${friendly}`).toBe(expected!.type);
        expect(r.converterClass, `converterClass mismatch for ${friendly}`).toBe(expected!.conv);
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }, 90_000);
});
