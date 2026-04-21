import type BetterSqlite3 from 'better-sqlite3';

type Database = BetterSqlite3.Database;

// Nomi reali delle tabelle ppxml2db (NON nomi Drizzle!)
const REQUIRED_TABLES = [
  'account',
  'security',
  'xact',
  'xact_cross_entry',
  'xact_unit',
  'price',
  'latest_price',
  'taxonomy',
  'taxonomy_category',
  'taxonomy_assignment',
  'config_entry',
];

const OPTIONAL_TABLES = [
  'watchlist',
  'watchlist_security',
  'dashboard',           // P1.2: era 'dashboard_set'
  'property',
  'security_event',
  'security_attr',
  'security_prop',
  'attribute_type',
  'taxonomy_data',
  'account_attr',        // P0: aggiunto per evitare crash 500
  'config_set',          // P3: nuovo
  'bookmark',            // P3: nuovo
  'taxonomy_assignment_data', // P3: nuovo
];

export function verifySchema(db: Database): {
  valid: boolean;
  missing: string[];
  warnings: string[];
} {
  const existing = (db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table'`)
    .all() as { name: string }[])
    .map((r) => r.name);

  const missing = REQUIRED_TABLES.filter(t => !existing.includes(t));
  const missingOptional = OPTIONAL_TABLES.filter(t => !existing.includes(t));

  return {
    valid: missing.length === 0,
    missing,
    warnings: missingOptional.map(t => `Tabella opzionale '${t}' non trovata`),
  };
}

export function verifyColumnTypes(db: Database): void {
  const checks = [
    { table: 'xact', column: 'amount', expectedType: 'BIGINT' },
    { table: 'price', column: 'value', expectedType: 'BIGINT' },
    { table: 'xact_unit', column: 'amount', expectedType: 'BIGINT' },
  ];

  for (const { table, column, expectedType } of checks) {
    try {
      const info = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string; type: string }[];
      const col = info.find(c => c.name === column);
      if (col && col.type !== expectedType) {
        console.warn(
          `[quovibe] Warning: ${table}.${column} is ${col.type},` +
          ` expected ${expectedType}. Possible ppxml2db incompatibility.`
        );
      }
    } catch {
      // Table not found: already reported by verifySchema
    }
  }
}

