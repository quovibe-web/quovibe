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
          `[quovibe] Attenzione: ${table}.${column} è ${col.type},` +
          ` atteso ${expectedType}. Possibile incompatibilità ppxml2db.`
        );
      }
    } catch {
      // Tabella non trovata: già segnalata da verifySchema
    }
  }
}

export function applyExtensions(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS vf_exchange_rate (
      date TEXT NOT NULL,
      from_currency TEXT NOT NULL,
      to_currency TEXT NOT NULL,
      rate TEXT NOT NULL,
      PRIMARY KEY (date, from_currency, to_currency)
    )
  `);

  // Ensure property table exists (OPTIONAL in ppxml2db but required by quovibe)
  // Schema matches ppxml2db's own definition exactly
  db.exec(`
    CREATE TABLE IF NOT EXISTS property (
      name TEXT PRIMARY KEY,
      special INTEGER NOT NULL DEFAULT 0,
      value TEXT NOT NULL
    )
  `);

  // P0: account_attr — opzionale in ppxml2db, ma richiesto da quovibe (evita crash 500)
  db.exec(`
    CREATE TABLE IF NOT EXISTS account_attr (
      account VARCHAR(36) NOT NULL REFERENCES account(uuid),
      attr_uuid VARCHAR(36) NOT NULL,
      type VARCHAR(32) NOT NULL,
      value TEXT,
      seq INT NOT NULL DEFAULT 0
    )
  `);

  const createIndexes = [
    `CREATE INDEX IF NOT EXISTS idx_xact_date ON xact(date)`,
    `CREATE INDEX IF NOT EXISTS idx_xact_security ON xact(security)`,
    `CREATE INDEX IF NOT EXISTS idx_xact_cross_entry_from_acc ON xact_cross_entry(from_acc)`,
    `CREATE INDEX IF NOT EXISTS idx_xact_cross_entry_to_acc ON xact_cross_entry(to_acc)`,
    `CREATE INDEX IF NOT EXISTS idx_price_date ON price(tstamp)`,
    `CREATE INDEX IF NOT EXISTS idx_price_security_date ON price(security, tstamp)`,
  ];
  createIndexes.forEach(sql => db.exec(sql));

  // calendar/updatedAt may be missing in older exports — add if needed
  const addIfMissing = (sql: string) => {
    try { db.exec(sql); } catch { /* column already exists — safe to ignore */ }
  };
  addIfMissing(`ALTER TABLE security ADD COLUMN calendar TEXT`);
  addIfMissing(`ALTER TABLE security ADD COLUMN updatedAt TEXT`);

  // P3: one-shot migration — recreate latest_price with inline PRIMARY KEY so that
  // ON CONFLICT(security) upserts work. The original ppxml2db DDL uses a separate
  // UNIQUE INDEX which SQLite does not recognise for upsert conflict resolution.
  const lpInfo = db.prepare(`PRAGMA table_info(latest_price)`).all() as { name: string; pk: number }[];
  const lpHasPk = lpInfo.some(c => c.name === 'security' && c.pk > 0);
  if (!lpHasPk) {
    db.exec(`DROP TABLE IF EXISTS latest_price_new`);
    db.exec(`
      CREATE TABLE latest_price_new (
        security VARCHAR(36) NOT NULL PRIMARY KEY REFERENCES security(uuid),
        tstamp VARCHAR(32) NOT NULL,
        value BIGINT NOT NULL,
        open BIGINT,
        high BIGINT,
        low BIGINT,
        volume BIGINT
      );
      INSERT INTO latest_price_new (security, tstamp, value, high, low, volume)
        SELECT security, tstamp, value, high, low, volume FROM latest_price;
      DROP TABLE latest_price;
      ALTER TABLE latest_price_new RENAME TO latest_price;
    `);
  }

  // P2: one-shot migration — corrects xact_cross_entry.type values written by earlier
  // quovibe versions (used enum values like 'BUY', 'SELL') to ppxml2db conventions.
  // The query is idempotent: already-migrated values never match the WHERE clauses.
  try {
    db.exec(`
      UPDATE xact_cross_entry SET type = 'buysell'
        WHERE type IN ('BUY', 'SELL', 'DIVIDENDS');
      UPDATE xact_cross_entry SET type = 'account-transfer'
        WHERE type = 'TRANSFER_OUT' AND from_acc IN (SELECT uuid FROM account WHERE type = 'account');
      UPDATE xact_cross_entry SET type = 'portfolio-transfer'
        WHERE type IN ('TRANSFER_IN', 'TRANSFER_OUT', 'SECURITY_TRANSFER');
    `);
  } catch {
    // cross_entry potrebbe non avere colonna type nei DB molto vecchi — ignorare
  }
}
