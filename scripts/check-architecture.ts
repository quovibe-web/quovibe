import { readFileSync, existsSync } from 'fs';
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
console.log('  QuoVibe Architecture Check');
console.log('══════════════════════════════════════════');

// ─── [A1] Engine package.json deps whitelist ─────────────────
header('[A1] Engine dependency boundary');

const enginePkgPath = join(ROOT, 'packages/engine/package.json');
if (!existsSync(enginePkgPath)) {
  info('packages/engine/package.json not found');
} else {
  const pkg = JSON.parse(readFileSync(enginePkgPath, 'utf-8'));
  const deps = Object.keys(pkg.dependencies || {});
  const allowed = ['decimal.js', 'date-fns', '@quovibe/shared'];
  let violations = 0;
  for (const dep of deps) {
    if (!allowed.includes(dep)) {
      fail(`engine: disallowed dependency — ${dep}`);
      violations++;
    }
  }
  if (violations === 0) {
    ok(`engine deps OK: ${deps.join(', ') || '(none)'}`);
  }
}

// ─── [A2] Shared package.json deps whitelist ─────────────────
header('[A2] Shared dependency boundary');

const sharedPkgPath = join(ROOT, 'packages/shared/package.json');
if (!existsSync(sharedPkgPath)) {
  info('packages/shared/package.json not found');
} else {
  const pkg = JSON.parse(readFileSync(sharedPkgPath, 'utf-8'));
  const deps = Object.keys(pkg.dependencies || {});
  const allowed = ['zod', 'decimal.js', 'date-fns'];
  let violations = 0;
  for (const dep of deps) {
    if (!allowed.includes(dep)) {
      fail(`shared: disallowed dependency — ${dep} (allowed: ${allowed.join(', ')})`);
      violations++;
    }
  }
  if (violations === 0) {
    ok(`shared deps OK: ${deps.join(', ') || '(none)'}`);
  }
}

// ─── [A3] Engine import boundary (full scan) ─────────────────
header('[A3] Engine import boundary (all files)');

const BANNED_IN_ENGINE = [
  '@quovibe/api', '@quovibe/web',
  'better-sqlite3', 'drizzle-orm', 'express', 'yahoo-finance2',
  'fs', 'path', 'http', 'https',
  'node:fs', 'node:path', 'node:http', 'node:https',
];

const engineAllFiles = globSync('packages/engine/src/**/*.ts', {
  cwd: ROOT, ignore: ['**/*.test.ts'],
});

let engineImportViolations = 0;
for (const file of engineAllFiles) {
  const content = readFileSync(join(ROOT, file), 'utf-8');
  for (const banned of BANNED_IN_ENGINE) {
    const patterns = [
      `from '${banned}'`, `from "${banned}"`,
      `require('${banned}')`, `require("${banned}")`,
    ];
    for (const p of patterns) {
      if (content.includes(p)) {
        fail(`${file} — banned import: ${banned}`);
        engineImportViolations++;
      }
    }
  }
}

if (engineImportViolations === 0) {
  ok(`No banned imports in engine (${engineAllFiles.length} files scanned)`);
}

// ─── [A4] Shared import boundary ─────────────────────────────
header('[A4] Shared import boundary');

const BANNED_IN_SHARED = [
  '@quovibe/api', '@quovibe/engine', '@quovibe/web',
  'better-sqlite3', 'drizzle-orm', 'express',
  'fs', 'path', 'http', 'https',
  'node:fs', 'node:path', 'node:http', 'node:https',
];

const sharedAllFiles = globSync('packages/shared/src/**/*.ts', {
  cwd: ROOT, ignore: ['**/*.test.ts'],
});

let sharedImportViolations = 0;
for (const file of sharedAllFiles) {
  const content = readFileSync(join(ROOT, file), 'utf-8');
  for (const banned of BANNED_IN_SHARED) {
    if (content.includes(`from '${banned}'`) || content.includes(`from "${banned}"`)) {
      fail(`${file} — banned import: ${banned}`);
      sharedImportViolations++;
    }
  }
}

if (sharedImportViolations === 0) {
  ok(`No banned imports in shared (${sharedAllFiles.length} files scanned)`);
}

// ─── [A5] API does not import from web ───────────────────────
header('[A5] API → web boundary');

const BANNED_IN_API = ['@quovibe/web'];

const apiAllFiles = globSync('packages/api/src/**/*.ts', {
  cwd: ROOT, ignore: ['**/*.test.ts', '**/__tests__/**'],
});

let apiImportViolations = 0;
for (const file of apiAllFiles) {
  const content = readFileSync(join(ROOT, file), 'utf-8');
  for (const banned of BANNED_IN_API) {
    if (content.includes(`from '${banned}'`) || content.includes(`from "${banned}"`)) {
      fail(`${file} — banned import: ${banned}`);
      apiImportViolations++;
    }
  }
}

if (apiImportViolations === 0) {
  ok(`No @quovibe/web imports in API (${apiAllFiles.length} files scanned)`);
}

// ─── [A6] Web does not import DB/server packages ─────────────
header('[A6] Web → server boundary');

const BANNED_IN_WEB = [
  'better-sqlite3', 'drizzle-orm', 'express',
  '@quovibe/api', '@quovibe/engine',
];

const webAllFiles = globSync('packages/web/src/**/*.ts*', {
  cwd: ROOT, ignore: ['**/*.test.ts', '**/__tests__/**'],
});

let webImportViolations = 0;
for (const file of webAllFiles) {
  const content = readFileSync(join(ROOT, file), 'utf-8');
  for (const banned of BANNED_IN_WEB) {
    if (content.includes(`from '${banned}'`) || content.includes(`from "${banned}"`)) {
      fail(`${file} — banned import: ${banned}`);
      webImportViolations++;
    }
  }
}

if (webImportViolations === 0) {
  ok(`No server imports in web (${webAllFiles.length} files scanned)`);
}

// ─── [A7] Native arithmetic in engine prod files ─────────────
header('[A7] Native arithmetic heuristic (engine)');

const FINANCIAL_NAMES = [
  'amount', 'price', 'value', 'gain', 'cost', 'fee', 'tax', 'rate', 'shares',
  'dividend', 'interest', 'balance', 'total', 'sum', 'profit', 'loss',
];
const namePattern = FINANCIAL_NAMES.join('|');
const nativeArithRegex = new RegExp(
  `\\b\\w*(${namePattern})\\w*\\s*[+\\-*/]\\s*(?!\\s*[/=])`,
  'gi'
);

let suspectCount = 0;
for (const file of engineAllFiles) {
  const content = readFileSync(join(ROOT, file), 'utf-8');
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim().startsWith('//') || line.trim().startsWith('*') || line.trim().startsWith('/**') || line.includes('import ')) continue;
    if (line.trim().startsWith('export * from') || line.trim().startsWith('export {')) continue;
    if (line.includes(': number') || line.includes(': Decimal') || line.includes('interface ') || line.includes('type ')) continue;
    if (line.includes('// native-ok')) continue;

    nativeArithRegex.lastIndex = 0;
    const match = nativeArithRegex.exec(line);
    if (match) {
      if (suspectCount < 10) {
        warn(`${file}:${i + 1} — suspect native arithmetic: "${line.trim().substring(0, 80)}"`);
      }
      suspectCount++;
    }
  }
}

if (suspectCount === 0) {
  ok('No suspect native arithmetic in engine');
} else if (suspectCount > 10) {
  warn(`...and ${suspectCount - 10} more occurrences (may be false positives)`);
}

// ─── [A8] Zod schemas in routes come from @quovibe/shared ───
header('[A8] Zod schemas in routes from shared');

const apiRouteFiles = globSync('packages/api/src/routes/**/*.ts', {
  cwd: ROOT, ignore: ['**/*.test.ts', '**/__tests__/**'],
});

// Inline Zod schema definition: z.object(), z.enum(), z.union() outside of imports
const inlineZodRegex = /\bz\.(object|enum|union|intersection|discriminatedUnion|tuple|record)\s*\(/g;
let inlineZodViolations = 0;

for (const file of apiRouteFiles) {
  const content = readFileSync(join(ROOT, file), 'utf-8');
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim().startsWith('//') || line.trim().startsWith('*')) continue;
    if (line.includes('// zod-ok')) continue;
    // Allow z.coerce (used for query param coercion in route handlers)
    if (line.includes('z.coerce')) continue;
    inlineZodRegex.lastIndex = 0;
    if (inlineZodRegex.test(line)) {
      warn(`${file}:${i + 1} — inline Zod schema (prefer @quovibe/shared): "${line.trim().substring(0, 80)}"`);
      inlineZodViolations++;
    }
  }
}

if (inlineZodViolations === 0) {
  ok('No inline Zod schema definitions in route files');
}

// ─── [A9] No async inside better-sqlite3 transactions ───────
header('[A9] No async inside better-sqlite3 transactions');

const ASYNC_PATTERNS = [/\bawait\b/, /\.then\s*\(/, /\bnew\s+Promise\b/, /\bsetTimeout\b/, /\bsetInterval\b/];

const serviceFilesA9 = globSync('packages/api/src/services/**/*.ts', {
  cwd: ROOT, ignore: ['**/*.test.ts', '**/__tests__/**'],
});

let asyncTxViolations = 0;

for (const file of serviceFilesA9) {
  const content = readFileSync(join(ROOT, file), 'utf-8');
  let searchFrom = 0;

  while (true) {
    const txIdx = content.indexOf('.transaction(', searchFrom);
    if (txIdx === -1) break;
    searchFrom = txIdx + 1;

    // Find the opening brace of the transaction callback
    const braceStart = content.indexOf('{', txIdx);
    if (braceStart === -1) continue;

    // Track braces to find the end of the callback body
    let depth = 0;
    let braceEnd = braceStart;
    for (let i = braceStart; i < content.length; i++) {
      if (content[i] === '{') depth++;
      if (content[i] === '}') depth--;
      if (depth === 0) { braceEnd = i; break; }
    }

    const txBody = content.substring(braceStart, braceEnd + 1);
    const txBodyLines = txBody.split('\n');
    const baseLine = content.substring(0, braceStart).split('\n').length;

    for (let i = 0; i < txBodyLines.length; i++) {
      const line = txBodyLines[i];
      if (line.trim().startsWith('//')) continue;
      for (const pattern of ASYNC_PATTERNS) {
        if (pattern.test(line)) {
          fail(`${file}:${baseLine + i} — async pattern inside .transaction(): "${line.trim().substring(0, 80)}"`);
          asyncTxViolations++;
          break;
        }
      }
    }
  }
}

if (asyncTxViolations === 0) {
  ok(`No async patterns inside better-sqlite3 transactions (${serviceFilesA9.length} files scanned)`);
}

// [A10] Drizzle schema <-> vendor DDL drift: retired in ADR-015.
// bootstrap.sql is now the single source of truth for DDL; the vendor/*.sql
// files are read-only reference material from ppxml2db (no drift to catch).

// ─── Summary ────────────────────────────────────────────────
console.log('\n══════════════════════════════════════════');
console.log(`  Result: ${criticalErrors} critical errors, ${warnings} warnings`);
console.log('══════════════════════════════════════════');

process.exit(criticalErrors > 0 ? 1 : 0);
