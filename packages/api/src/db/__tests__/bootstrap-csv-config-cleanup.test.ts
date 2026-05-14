// Locks the bootstrap-time cleanup: any saved CSV-import config whose
// nested `columnMapping` JSON still carries the legacy `crossAccount`
// key gets that key stripped on the next applyBootstrap() call.
//
// Real schema: vf_csv_import_config(id, name, type, config, createdAt,
// updatedAt). `columnMapping` lives inside the JSON `config` blob —
// not as a top-level column — so the cleanup helper must parse `config`,
// mutate `config.columnMapping`, and re-serialize.

import Database from 'better-sqlite3';
import { describe, it, expect, beforeEach } from 'vitest';
import { applyBootstrap } from '../apply-bootstrap';

describe('cleanupCsvConfigsCrossAccount', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    applyBootstrap(db);
  });

  it('strips legacy `crossAccount` key from existing vf_csv_import_config rows', () => {
    const config = {
      delimiter: ',',
      encoding: 'utf-8',
      dateFormat: 'yyyy-MM-dd',
      decimalSeparator: '.',
      thousandSeparator: '',
      columnMapping: { date: 0, type: 1, crossAccount: 5, amount: 4 },
    };
    db.prepare(
      'INSERT INTO vf_csv_import_config (id, name, type, config, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)',
    ).run('cfg-1', 'Legacy', 'TRADES', JSON.stringify(config), '2026-01-01', '2026-01-01');

    // Re-apply bootstrap: the cleanup helper runs as part of it.
    applyBootstrap(db);

    const row = db
      .prepare('SELECT config FROM vf_csv_import_config WHERE id=?')
      .get('cfg-1') as { config: string };
    const parsed = JSON.parse(row.config);
    expect(parsed.columnMapping).not.toHaveProperty('crossAccount');
    expect(parsed.columnMapping.date).toBe(0); // sibling keys preserved
    expect(parsed.columnMapping.amount).toBe(4);
    expect(parsed.columnMapping.type).toBe(1);
    // Outer config fields untouched.
    expect(parsed.delimiter).toBe(',');
    expect(parsed.dateFormat).toBe('yyyy-MM-dd');
  });

  it('leaves rows without `crossAccount` untouched', () => {
    const config = {
      delimiter: ';',
      encoding: 'utf-8',
      dateFormat: 'dd/MM/yyyy',
      decimalSeparator: ',',
      thousandSeparator: '.',
      columnMapping: { date: 0, type: 1, amount: 4 },
    };
    db.prepare(
      'INSERT INTO vf_csv_import_config (id, name, type, config, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)',
    ).run('cfg-2', 'Clean', 'TRADES', JSON.stringify(config), '2026-01-01', '2026-01-01');

    applyBootstrap(db);

    const row = db
      .prepare('SELECT config FROM vf_csv_import_config WHERE id=?')
      .get('cfg-2') as { config: string };
    const parsed = JSON.parse(row.config);
    expect(parsed.columnMapping).toEqual({ date: 0, type: 1, amount: 4 });
  });

  it('is idempotent on a fresh DB (no rows to touch)', () => {
    expect(() => applyBootstrap(db)).not.toThrow();
  });
});
