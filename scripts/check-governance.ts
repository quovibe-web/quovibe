import { readFileSync, existsSync, readdirSync } from 'fs';
import { join, resolve } from 'path';
import { globSync } from 'glob';

const ROOT = resolve(__dirname, '..');
let criticalErrors = 0;
let warnings = 0;

function header(label: string) {
  console.log(`\n▶ ${label}`);
}

function ok(msg: string) { console.log(`  ✅ ${msg}`); }
function warn(msg: string) { warnings++; console.log(`  ⚠️  ${msg}`); }
function fail(msg: string) { criticalErrors++; console.log(`  ❌ ${msg}`); }
function info(msg: string) { console.log(`  ℹ️  ${msg}`); }

// ═══════════════════════════════════════════════════════════════
console.log('══════════════════════════════════════════');
console.log('  QuoVibe Governance Check');
console.log('══════════════════════════════════════════');

// ─── [G1] Doc ↔ filesystem alignment ───────────────────────
header('[G1] Doc ↔ filesystem alignment');

const archDocPath = join(ROOT, 'docs/architecture/monorepo-structure.md');
let docOk = 0, docMissing = 0;

if (existsSync(archDocPath)) {
  const archDoc = readFileSync(archDocPath, 'utf-8');

  const sec2Match = archDoc.match(/```\n([\s\S]*?)```/);
  if (sec2Match) {
    const treeBlock = sec2Match[0];
    const pathLines: string[] = [];
    const lines = treeBlock.split('\n');
    const pathStack: string[] = [];

    for (const line of lines) {
      const match = line.match(/^[│\s├└─┬]+\s*(\S+)/);
      if (!match) continue;
      const name = match[1].replace(/\s*#.*$/, '');
      if (name === 'QuoVibe/' || name === '```') continue;
      if (/^[│├└─┬\s]+$/.test(name)) continue;

      const prefix = line.match(/^([│\s├└─┬]*)/)?.[1] || '';
      const depth = Math.floor(prefix.replace(/[─┬]/g, '').length / 4);

      pathStack.length = depth;
      pathStack[depth] = name.replace(/\/$/, '');

      if (!name.endsWith('/')) {
        pathLines.push(pathStack.join('/'));
      }
    }

    for (const relPath of pathLines) {
      const fullPath = join(ROOT, relPath);
      if (existsSync(fullPath)) {
        docOk++;
      } else {
        warn(`${relPath} (in doc, not in filesystem)`);
        docMissing++;
      }
    }
  }

  // Check API routes vs route files
  const apiRoutesPath = join(ROOT, 'docs/architecture/api-routes.md');
  const apiRoutesDoc = existsSync(apiRoutesPath) ? readFileSync(apiRoutesPath, 'utf-8') : '';
  const sec8Match = apiRoutesDoc.match(/```\s*\n([\s\S]*?)```/);
  if (sec8Match) {
    const routeBlock = sec8Match[1];
    const docRouteGroups = new Set<string>();
    const routeMatches = routeBlock.matchAll(/(GET|POST|PUT|DEL)\s+\/api\/([\w-]+)/g);
    for (const m of routeMatches) {
      docRouteGroups.add(m[2]);
    }

    const routeDir = join(ROOT, 'packages/api/src/routes');
    if (existsSync(routeDir)) {
      const routeFiles = readdirSync(routeDir).filter(f => f.endsWith('.ts') && !f.startsWith('index'));
      const fsRouteNames = new Set(routeFiles.map(f => f.replace('.ts', '')));

      for (const docRoute of docRouteGroups) {
        const candidates = [docRoute, `${docRoute}s`, docRoute.replace(/s$/, '')];
        const found = candidates.some(c => fsRouteNames.has(c));
        if (!found) {
          warn(`Route /api/${docRoute} in doc but no matching route file`);
        }
      }
    }
  }

  console.log(`  Result: ${docOk} ✅ | ${docMissing} ❌`);
} else {
  info('docs/architecture/monorepo-structure.md not found — G1 skipped');
}

// ─── [G2] Engine test Reference tags ────────────────────────
header('[G2] Engine test Reference tags');

const engineTestFiles = globSync('packages/engine/src/**/*.test.ts', { cwd: ROOT });
if (engineTestFiles.length === 0) {
  info('No engine tests found');
} else {
  let withRef = 0;
  let withoutRef = 0;
  for (const file of engineTestFiles) {
    const content = readFileSync(join(ROOT, file), 'utf-8');
    if (!/\b(test|it)\s*\(/.test(content)) continue;
    if (/\bReference:/i.test(content)) {
      withRef++;
    } else {
      fail(`${file} — missing Reference tag`);
      withoutRef++;
    }
  }
  ok(`${withRef}/${withRef + withoutRef} test files have Reference`);
}

// ─── [G3] Upstream reference ban in engine tests ────────────
header('[G3] Upstream reference ban (engine tests)');

// These patterns indicate references to the upstream project that must not appear
const UPSTREAM_PATTERNS = [
  /\bPortfolio\s*Performance\b/gi,
  /\bportfolio-performance\b/gi,
  /\bgithub\.com\/portfolio-performance/gi,
  /\bpp-app\b/gi,
];

let upstreamViolations = 0;
for (const file of engineTestFiles) {
  const content = readFileSync(join(ROOT, file), 'utf-8');
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Skip import lines and pp-reference doc pointers
    if (line.includes('import ') || line.includes('pp-reference')) continue;
    for (const pattern of UPSTREAM_PATTERNS) {
      pattern.lastIndex = 0;
      if (pattern.test(line)) {
        fail(`${file}:${i + 1} — upstream reference: "${line.trim().substring(0, 80)}"`);
        upstreamViolations++;
        break;
      }
    }
  }
}

if (upstreamViolations === 0) {
  ok('No upstream references in engine tests');
}

// ─── [G4] ADR index ─────────────────────────────────────────
header('[G4] ADR index');

const adrDir = join(ROOT, 'docs/adr');
if (!existsSync(adrDir)) {
  info('docs/adr/ does not exist');
} else {
  const readmePath = join(adrDir, 'README.md');
  if (!existsSync(readmePath)) {
    warn('docs/adr/ exists but README.md missing');
  } else {
    const readme = readFileSync(readmePath, 'utf-8');
    const files = readdirSync(adrDir).filter(f => f.startsWith('ADR-') && f.endsWith('.md'));
    if (files.length === 0) {
      info('No ADRs yet');
    } else {
      let orphans = 0;
      for (const f of files) {
        if (!readme.includes(f)) {
          warn(`Orphan ADR: ${f}`);
          orphans++;
        }
      }
      const refs = readme.match(/ADR-\d{3}-[\w-]+\.md/g) || [];
      for (const r of refs) {
        if (!existsSync(join(adrDir, r))) {
          warn(`ADR referenced but missing: ${r}`);
        }
      }
      if (orphans === 0) ok(`${files.length} ADRs synchronized with README`);
    }
  }
}

// ─── [G5] Unit conversion outside service layer ─────────────
header('[G5] Unit conversion outside service layer');

const UNIT_PATTERNS = [/1e8/g, /100000000/g, /10\*\*8/g, /\.div\(1e8\)/g, /\.times\(1e8\)/g, /\.div\(100\)/g, /\.times\(100\)/g];

let unitWarnings = 0;

// Check engine source (no test files)
const engineSrcFiles = globSync('packages/engine/src/**/*.ts', {
  cwd: ROOT, ignore: ['**/*.test.ts'],
});
for (const file of engineSrcFiles) {
  const content = readFileSync(join(ROOT, file), 'utf-8');
  for (const p of UNIT_PATTERNS) {
    p.lastIndex = 0;
    if (p.test(content)) {
      warn(`${file} — unit conversion found (pattern: ${p.source})`);
      unitWarnings++;
      break;
    }
  }
}

// Check API route files (exclude tests)
const apiRouteFiles = globSync('packages/api/src/routes/**/*.ts', {
  cwd: ROOT, ignore: ['**/*.test.ts', '**/__tests__/**'],
});
for (const file of apiRouteFiles) {
  const content = readFileSync(join(ROOT, file), 'utf-8');
  const lines = content.split('\n').filter(l => !l.includes('conversion-ok'));
  const filtered = lines.join('\n');
  for (const p of UNIT_PATTERNS) {
    p.lastIndex = 0;
    if (p.test(filtered)) {
      warn(`${file} — unit conversion in route (should be in service layer)`);
      unitWarnings++;
      break;
    }
  }
}

if (unitWarnings === 0) {
  ok('No unit conversions outside service layer');
}

// ─── [G6] Engine I/O isolation (CRITICAL) ────────────────────
header('[G6] Engine I/O isolation');

const BANNED_IMPORTS = [
  'better-sqlite3', 'drizzle-orm', 'express', 'yahoo-finance2',
  'fs', 'path', 'http', 'https',
  'node:fs', 'node:path', 'node:http', 'node:https',
];

const engineProdFiles = globSync('packages/engine/src/**/*.ts', {
  cwd: ROOT, ignore: ['**/*.test.ts', '**/index.ts'],
});

let ioViolations = 0;
for (const file of engineProdFiles) {
  const content = readFileSync(join(ROOT, file), 'utf-8');
  for (const banned of BANNED_IMPORTS) {
    if (content.includes(`from '${banned}'`) || content.includes(`from "${banned}"`)) {
      fail(`${file} — banned import: ${banned}`);
      ioViolations++;
    }
    if (content.includes(`require('${banned}')`) || content.includes(`require("${banned}")`)) {
      fail(`${file} — banned require: ${banned}`);
      ioViolations++;
    }
  }
}

if (ioViolations === 0) {
  ok('No I/O imports in engine');
}

// ─── [G7] No 'any' type in engine ──────────────────────────
header('[G7] No explicit "any" in engine');

const anyTypeRegex = /:\s*any\b/g;
let anyViolations = 0;

for (const file of engineProdFiles) {
  const content = readFileSync(join(ROOT, file), 'utf-8');
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim().startsWith('//') || line.trim().startsWith('*')) continue;
    if (line.includes('// any-ok')) continue;
    anyTypeRegex.lastIndex = 0;
    if (anyTypeRegex.test(line)) {
      fail(`${file}:${i + 1} — explicit 'any' type: "${line.trim().substring(0, 80)}"`);
      anyViolations++;
    }
  }
}

if (anyViolations === 0) {
  ok('No explicit "any" in engine production code');
}

// ─── [G8] Service write methods use db.transaction() ────────
header('[G8] Multi-table writes use transaction()');

const serviceFiles = globSync('packages/api/src/services/**/*.ts', {
  cwd: ROOT, ignore: ['**/*.test.ts', '**/__tests__/**'],
});

// Services that must use transactions: those with multiple INSERT/UPDATE/DELETE statements
const MULTI_WRITE_SERVICES = ['transaction.service.ts', 'taxonomy.service.ts'];
let txViolations = 0;

for (const file of serviceFiles) {
  const basename = file.split('/').pop() || '';
  if (!MULTI_WRITE_SERVICES.some(s => basename === s)) continue;

  const content = readFileSync(join(ROOT, file), 'utf-8');
  // Check that the file uses .transaction()
  if (!content.includes('.transaction(')) {
    fail(`${file} — multi-write service without .transaction()`);
    txViolations++;
  }
}

if (txViolations === 0) {
  ok('All multi-write services use transaction()');
}

// ─── [G9] No Decimal arithmetic in route files ──────────────
header('[G9] No Decimal construction in route files');

// Routes should use convertAmountFromDb/convertTransactionFromDb, not new Decimal() directly
const DECIMAL_PATTERNS = [
  /new\s+Decimal\s*\(/g,
  /Decimal\.prototype/g,
];

let decimalRouteViolations = 0;

for (const file of apiRouteFiles) {
  const content = readFileSync(join(ROOT, file), 'utf-8');
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim().startsWith('//') || line.includes('// decimal-ok')) continue;
    for (const p of DECIMAL_PATTERNS) {
      p.lastIndex = 0;
      if (p.test(line)) {
        warn(`${file}:${i + 1} — direct Decimal in route: "${line.trim().substring(0, 80)}"`);
        decimalRouteViolations++;
        break;
      }
    }
  }
}

if (decimalRouteViolations === 0) {
  ok('No direct Decimal construction in route files');
}

// ─── [G14] No direct DB writes in route files ───────────────
header('[G14] No direct DB writes in route files');

// Route handlers must delegate writes to service methods (api.md rule).
// Add `// db-route-ok` on a line to allow an exceptional direct write.
const DB_WRITE_PATTERN = /\bdb\.(insert|update|delete)\s*\(/;
const SQLITE_WRITE_PATTERN = /sqlite\.prepare\s*\(\s*[`'"]\s*(INSERT|UPDATE|DELETE)\b/i;

let dbWriteRouteViolations = 0;

for (const file of apiRouteFiles) {
  const content = readFileSync(join(ROOT, file), 'utf-8');
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim().startsWith('//') || line.includes('// db-route-ok')) continue;
    if (DB_WRITE_PATTERN.test(line) || SQLITE_WRITE_PATTERN.test(line)) {
      fail(`${file}:${i + 1} — direct DB write in route (use a service method or // db-route-ok): "${line.trim().substring(0, 80)}"`);
      dbWriteRouteViolations++;
    }
  }
}

if (dbWriteRouteViolations === 0) {
  ok('No direct DB writes in route files');
}

// ─── [G10] Upstream reference ban in ALL source ─────────────
header('[G10] Upstream reference ban (all source)');

const allSourceFiles = globSync('packages/*/src/**/*.ts', {
  cwd: ROOT, ignore: ['**/*.test.ts', '**/__tests__/**', '**/node_modules/**'],
});

let allUpstreamViolations = 0;
for (const file of allSourceFiles) {
  const content = readFileSync(join(ROOT, file), 'utf-8');
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes('import ') || line.includes('pp-reference')) continue;
    if (line.trim().startsWith('//') && line.includes('upstream-ok')) continue;
    for (const pattern of UPSTREAM_PATTERNS) {
      pattern.lastIndex = 0;
      if (pattern.test(line)) {
        fail(`${file}:${i + 1} — upstream reference: "${line.trim().substring(0, 80)}"`);
        allUpstreamViolations++;
        break;
      }
    }
  }
}

if (allUpstreamViolations === 0) {
  ok('No upstream references in source code');
}

// ─── [G11] Write methods documented in implementation-verified.md ──
header('[G11] Write methods documented');

const implVerifiedPath = join(ROOT, 'docs/architecture/implementation-verified.md');
const WRITE_METHOD_RE = /^export\s+(?:async\s+)?function\s+(create|update|delete|remove|reorder|rename|duplicate)\w+/;

let undocumentedMethods = 0;

if (existsSync(implVerifiedPath)) {
  const implDoc = readFileSync(implVerifiedPath, 'utf-8');
  const svcFiles = globSync('packages/api/src/services/**/*.ts', {
    cwd: ROOT, ignore: ['**/*.test.ts', '**/__tests__/**'],
  });

  for (const file of svcFiles) {
    const content = readFileSync(join(ROOT, file), 'utf-8');
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(WRITE_METHOD_RE);
      if (!m) continue;
      // Extract full function name
      const fnMatch = lines[i].match(/function\s+(\w+)/);
      if (!fnMatch) continue;
      const fnName = fnMatch[1];
      // Private helpers (not exported effectively) — skip internal helpers
      if (fnName === 'deleteTransactionDeps') continue;
      if (!implDoc.includes(fnName)) {
        fail(`${file}:${i + 1} — write method '${fnName}' not in implementation-verified.md`);
        undocumentedMethods++;
      }
    }
  }

  if (undocumentedMethods === 0) {
    ok('All write methods documented in implementation-verified.md');
  }
} else {
  info('implementation-verified.md not found — G11 skipped');
}

// ─── [G11b] Reverse check: documented methods must exist in code ──
if (existsSync(implVerifiedPath)) {
  const implDoc = readFileSync(implVerifiedPath, 'utf-8');
  // Extract method names from markdown table rows: | `methodName` |
  const documentedMethods = [...implDoc.matchAll(/\|\s*`(\w+)`\s*\|/g)].map(m => m[1]);

  // Collect all service file contents
  const svcFiles = globSync('packages/api/src/services/**/*.ts', {
    cwd: ROOT, ignore: ['**/*.test.ts', '**/__tests__/**'],
  });
  const allSvcContent = svcFiles.map(f => readFileSync(join(ROOT, f), 'utf-8')).join('\n');

  let staleDocMethods = 0;
  for (const method of documentedMethods) {
    // Skip non-DB methods (file-based settings)
    if (['updateSettings', 'updateAppState', 'updatePreferences'].includes(method)) continue;
    // Check the method is actually exported in some service file
    const exportRe = new RegExp(`export\\s+(?:async\\s+)?function\\s+${method}\\b`);
    if (!exportRe.test(allSvcContent)) {
      fail(`implementation-verified.md documents '${method}' but it does not exist in any service file`);
      staleDocMethods++;
    }
  }

  if (staleDocMethods === 0) {
    ok('All documented methods exist in service files (reverse G11)');
  }
}

// ─── [G12] Test DDL consistency with schema.ts ──────────────
header('[G12] Test DDL consistency with schema.ts');

/** Parse CREATE TABLE from raw SQL string → { table, columns[] } */
function parseCreateTable(sql: string): Array<{ table: string; columns: string[] }> {
  const results: Array<{ table: string; columns: string[] }> = [];
  const regex = /CREATE\s+TABLE\s+(\w+)\s*\(([\s\S]*?)\)/gi;
  let m;
  while ((m = regex.exec(sql)) !== null) {
    const table = m[1];
    const body = m[2];
    const columns: string[] = [];
    for (const line of body.split('\n')) {
      const trimmed = line.trim().replace(/,$/, '');
      if (!trimmed || trimmed.startsWith('--') || trimmed.startsWith('CONSTRAINT') ||
          trimmed.startsWith('PRIMARY KEY') || trimmed.startsWith('UNIQUE') ||
          trimmed.startsWith('FOREIGN KEY') || trimmed.startsWith('CHECK')) continue;
      const colMatch = trimmed.match(/^(\w+)\s+/);
      if (colMatch) columns.push(colMatch[1]);
    }
    results.push({ table, columns });
  }
  return results;
}

/** Parse schema.ts Drizzle definitions → Map<tableName, Set<columnNames>> */
function parseDrizzleCols(content: string): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();
  const tableRegex = /sqliteTable\s*\(\s*['"](\w+)['"]/g;
  let tm;
  while ((tm = tableRegex.exec(content)) !== null) {
    const tableName = tm[1];
    const braceStart = content.indexOf('{', tm.index + tm[0].length);
    if (braceStart === -1) continue;
    let depth = 0, braceEnd = braceStart;
    for (let i = braceStart; i < content.length; i++) {
      if (content[i] === '{') depth++;
      if (content[i] === '}') depth--;
      if (depth === 0) { braceEnd = i; break; }
    }
    const body = content.substring(braceStart, braceEnd + 1);
    const cols = new Set<string>();
    const colRegex = /(?:text|integer|real)\s*\(\s*['"](\w+)['"]/g;
    let cm;
    while ((cm = colRegex.exec(body)) !== null) cols.add(cm[1]);
    result.set(tableName, cols);
  }
  return result;
}

const schemaPath = join(ROOT, 'packages/api/src/db/schema.ts');
let ddlDivergences = 0;

if (existsSync(schemaPath)) {
  const schemaCols = parseDrizzleCols(readFileSync(schemaPath, 'utf-8'));

  const testFiles = globSync('packages/api/src/**/*.test.ts', { cwd: ROOT });
  for (const file of testFiles) {
    const content = readFileSync(join(ROOT, file), 'utf-8');
    if (!content.includes('CREATE TABLE')) continue;
    const tables = parseCreateTable(content);

    for (const { table, columns } of tables) {
      const canonical = schemaCols.get(table);
      if (!canonical) continue; // test-only table, skip

      const testSet = new Set(columns);

      // Columns in test DDL that don't exist in schema → possibly wrong
      for (const col of testSet) {
        if (col === '_id') continue; // always acceptable in test DDL
        if (!canonical.has(col)) {
          warn(`${file}: test DDL for '${table}' has column '${col}' not in schema.ts`);
          ddlDivergences++;
        }
      }

      // Critical columns missing from test DDL that have NOT NULL in schema
      // (we only flag columns the service writes to, not all schema columns)
    }
  }

  if (ddlDivergences === 0) {
    ok(`Test DDL consistency OK (${testFiles.length} test files scanned)`);
  }
} else {
  info('schema.ts not found — G12 skipped');
}

// ─── [G13] Sign convention consistency ──────────────────────
header('[G13] Sign convention consistency');

const signRegistryPath = join(ROOT, 'docs/audit/sign-convention-registry.md');
let signViolations = 0;

if (existsSync(signRegistryPath)) {
  const registry = readFileSync(signRegistryPath, 'utf-8');

  // Verify the registry documents that ALL values are stored positive
  const allPositive = registry.includes('ppxml2db stores ALL numeric values as positive');
  if (!allPositive) {
    fail('sign-convention-registry.md: missing "ALL numeric values as positive" invariant');
    signViolations++;
  }

  // Verify service code never negates amounts/shares/fees/taxes
  const txServicePath = join(ROOT, 'packages/api/src/services/transaction.service.ts');
  if (existsSync(txServicePath)) {
    const txCode = readFileSync(txServicePath, 'utf-8');
    const lines = txCode.split('\n');

    // Check 1: computeNetAmountDb uses plus/minus but result must always be positive
    // The function should NOT contain explicit negation like `.neg()` or `* -1`
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.trim().startsWith('//')) continue;
      // Negation patterns that would violate the all-positive convention
      if (/\.neg\s*\(/.test(line) || /\*\s*-\s*1\b/.test(line) || /\bnegate\b/.test(line)) {
        fail(`transaction.service.ts:${i + 1} — sign negation found (violates all-positive convention): "${line.trim().substring(0, 80)}"`);
        signViolations++;
      }
    }

    // Check 2: OUTFLOW_TX_TYPES should only contain BUY (per registry: BUY = gross+fees+taxes)
    const outflowMatch = txCode.match(/OUTFLOW_TX_TYPES.*?new Set\(\[([\s\S]*?)\]\)/);
    if (outflowMatch) {
      const outflowTypes = outflowMatch[1];
      if (!outflowTypes.includes('BUY')) {
        fail('OUTFLOW_TX_TYPES missing BUY');
        signViolations++;
      }
      // BUY should be the ONLY outflow type
      const otherTypes = outflowTypes.replace(/TransactionType\.BUY/g, '').replace(/[,\s]/g, '');
      if (otherTypes.length > 0) {
        fail(`OUTFLOW_TX_TYPES has unexpected types beyond BUY: ${outflowTypes.trim()}`);
        signViolations++;
      }
    }

    // Check 3: INFLOW_TX_TYPES should contain SELL and DIVIDEND (per registry: net = gross-fees-taxes)
    const inflowMatch = txCode.match(/INFLOW_TX_TYPES.*?new Set\(\[([\s\S]*?)\]\)/);
    if (inflowMatch) {
      const inflowTypes = inflowMatch[1];
      if (!inflowTypes.includes('SELL')) {
        fail('INFLOW_TX_TYPES missing SELL');
        signViolations++;
      }
      if (!inflowTypes.includes('DIVIDEND')) {
        fail('INFLOW_TX_TYPES missing DIVIDEND');
        signViolations++;
      }
    }
  }

  if (signViolations === 0) {
    ok('Sign convention consistent with registry');
  }
} else {
  info('sign-convention-registry.md not found — G13 skipped');
}

// ─── Summary ────────────────────────────────────────────────
console.log('\n══════════════════════════════════════════');
console.log(`  Result: ${criticalErrors} critical errors, ${warnings} warnings`);
console.log('══════════════════════════════════════════');

process.exit(criticalErrors > 0 ? 1 : 0);
