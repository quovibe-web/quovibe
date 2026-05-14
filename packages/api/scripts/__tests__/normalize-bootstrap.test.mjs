// packages/api/scripts/__tests__/normalize-bootstrap.test.mjs
import { describe, it, expect } from 'vitest';
import { normalize } from '../normalize-bootstrap.mjs';

describe('normalize-bootstrap', () => {
  it('strips line comments', () => {
    expect(normalize('-- a comment\nCREATE TABLE x (id INT);')).toBe('create table x (id int)');
  });
  it('strips block comments', () => {
    expect(normalize('/* multi\nline */ CREATE TABLE x (id INT);')).toBe('create table x (id int)');
  });
  it('removes IF NOT EXISTS', () => {
    expect(normalize('CREATE TABLE IF NOT EXISTS x (id INT);')).toBe('create table x (id int)');
  });
  it('lowercases keywords only outside strings', () => {
    expect(normalize(`CREATE TABLE x (id INT DEFAULT 'NOT NULL');`))
      .toBe(`create table x (id int default 'NOT NULL')`);
  });
  it('sorts CREATE INDEX alphabetically after tables', () => {
    const input = `
      CREATE TABLE a (id INT);
      CREATE INDEX idx_z ON a(id);
      CREATE INDEX idx_a ON a(id);
    `;
    expect(normalize(input)).toBe(
      'create table a (id int);\ncreate index idx_a on a(id);\ncreate index idx_z on a(id)'
    );
  });
  it('preserves table emission order', () => {
    const input = `CREATE TABLE z (id INT); CREATE TABLE a (id INT);`;
    expect(normalize(input)).toBe('create table z (id int);\ncreate table a (id int)');
  });
  it('collapses whitespace', () => {
    expect(normalize('CREATE    TABLE\n\nx  (id   INT);')).toBe('create table x (id int)');
  });
});
