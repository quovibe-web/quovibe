// packages/api/src/services/csv/csv-config.service.ts
import type BetterSqlite3 from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import type { CsvImportConfig, CreateCsvImportConfigInput } from '@quovibe/shared';

function rowToConfig(row: Record<string, string>): CsvImportConfig {
  const parsed = JSON.parse(row.config);
  return {
    id: row.id,
    name: row.name,
    type: row.type as CsvImportConfig['type'],
    ...parsed,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function listCsvConfigs(sqlite: BetterSqlite3.Database): CsvImportConfig[] {
  const rows = sqlite.prepare('SELECT * FROM vf_csv_import_config ORDER BY updatedAt DESC').all() as Record<string, string>[];
  return rows.map(rowToConfig);
}

export function createCsvConfig(
  sqlite: BetterSqlite3.Database,
  input: CreateCsvImportConfigInput,
): CsvImportConfig {
  const id = uuidv4();
  const now = new Date().toISOString();
  const { name, type, ...rest } = input;
  const configJson = JSON.stringify(rest);

  sqlite.prepare(
    'INSERT INTO vf_csv_import_config (id, name, type, config, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(id, name, type, configJson, now, now);

  return { id, ...input, createdAt: now, updatedAt: now };
}

export function updateCsvConfig(
  sqlite: BetterSqlite3.Database,
  id: string,
  input: Partial<CreateCsvImportConfigInput>,
): CsvImportConfig | null {
  const existing = sqlite.prepare('SELECT * FROM vf_csv_import_config WHERE id = ?').get(id) as Record<string, string> | undefined;
  if (!existing) return null;

  const oldConfig = JSON.parse(existing.config);
  const { name, type, ...rest } = input;
  const merged = { ...oldConfig, ...rest };
  const now = new Date().toISOString();

  sqlite.prepare(
    'UPDATE vf_csv_import_config SET name = ?, type = ?, config = ?, updatedAt = ? WHERE id = ?',
  ).run(name ?? existing.name, type ?? existing.type, JSON.stringify(merged), now, id);

  return rowToConfig({
    ...existing,
    name: name ?? existing.name,
    type: type ?? existing.type,
    config: JSON.stringify(merged),
    updatedAt: now,
  });
}

export function deleteCsvConfig(sqlite: BetterSqlite3.Database, id: string): boolean {
  const result = sqlite.prepare('DELETE FROM vf_csv_import_config WHERE id = ?').run(id);
  return result.changes > 0; // native-ok
}
