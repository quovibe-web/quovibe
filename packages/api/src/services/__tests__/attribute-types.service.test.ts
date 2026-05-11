import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { applyBootstrap } from '../../db/apply-bootstrap';
import {
  listAttributeTypes,
  createAttributeType,
  updateAttributeType,
  deleteAttributeType,
  AttributeTypeServiceError,
  BUILTIN_TYPE_IDS,
} from '../attribute-types.service';

function freshDb() {
  const db = new Database(':memory:');
  applyBootstrap(db);
  return db;
}

describe('createAttributeType — friendly type matrix', () => {
  const matrix = [
    { friendly: 'TEXT',       java: 'java.lang.String',  conv: 'name.abuchen.portfolio.model.AttributeType$StringConverter' },
    { friendly: 'NUMBER',     java: 'java.lang.Double',  conv: 'name.abuchen.portfolio.model.AttributeType$NumberConverter' },
    { friendly: 'PERCENTAGE', java: 'java.lang.Double',  conv: 'name.abuchen.portfolio.model.AttributeType$PercentConverter' },
    { friendly: 'AMOUNT',     java: 'java.lang.Long',    conv: 'name.abuchen.portfolio.model.AttributeType$AmountPlainConverter' },
    { friendly: 'DATE',       java: 'java.util.Date',    conv: 'name.abuchen.portfolio.model.AttributeType$DateConverter' },
    { friendly: 'BOOLEAN',    java: 'java.lang.Boolean', conv: 'name.abuchen.portfolio.model.AttributeType$BooleanConverter' },
  ] as const;

  for (const row of matrix) {
    it(`maps ${row.friendly} → ${row.java} + correct converter`, () => {
      const db = freshDb();
      const created = createAttributeType(db, { name: `T_${row.friendly}`, friendlyType: row.friendly });
      expect(created.type).toBe(row.java);
      expect(created.converterClass).toBe(row.conv);
      expect(created.target).toBe('name.abuchen.portfolio.model.Security');
    });
  }
});

describe('createAttributeType — defaults + invariants', () => {
  it('defaults columnLabel to name when omitted', () => {
    const db = freshDb();
    const created = createAttributeType(db, { name: 'Sector', friendlyType: 'TEXT' });
    expect(created.columnLabel).toBe('Sector');
  });

  it('honours explicit columnLabel', () => {
    const db = freshDb();
    const created = createAttributeType(db, { name: 'Risk Rating', columnLabel: 'Risk', friendlyType: 'TEXT' });
    expect(created.columnLabel).toBe('Risk');
  });

  it('writes props_json="[]" + source=NULL', () => {
    const db = freshDb();
    const created = createAttributeType(db, { name: 'Sector', friendlyType: 'TEXT' });
    const row = db.prepare('SELECT source, props_json FROM attribute_type WHERE id = ?').get(created.id) as { source: string | null; props_json: string };
    expect(row.source).toBeNull();
    expect(row.props_json).toBe('[]');
  });

  it('rejects DUPLICATE_NAME case-insensitive trim within same target', () => {
    const db = freshDb();
    createAttributeType(db, { name: 'Sector', friendlyType: 'TEXT' });
    expect(() =>
      createAttributeType(db, { name: '  sector ', friendlyType: 'NUMBER' }),
    ).toThrow(expect.objectContaining({ code: 'DUPLICATE_NAME' }));
  });
});

describe('updateAttributeType', () => {
  it('renames OK', () => {
    const db = freshDb();
    const c = createAttributeType(db, { name: 'Sector', friendlyType: 'TEXT' });
    const u = updateAttributeType(db, c.id, { name: 'Industry' });
    expect(u.name).toBe('Industry');
    expect(u.type).toBe('java.lang.String');
  });

  it('selfId allows same-name PATCH (no-op rename)', () => {
    const db = freshDb();
    const c = createAttributeType(db, { name: 'Sector', friendlyType: 'TEXT' });
    expect(() => updateAttributeType(db, c.id, { name: 'Sector' })).not.toThrow();
  });

  it('throws ATTRIBUTE_TYPE_NOT_FOUND on unknown id', () => {
    const db = freshDb();
    expect(() => updateAttributeType(db, 'nope', { name: 'X' })).toThrow(
      expect.objectContaining({ code: 'ATTRIBUTE_TYPE_NOT_FOUND' }),
    );
  });

  it('throws BUILTIN_TYPE_PROTECTED on logo (the only protected builtin)', () => {
    const db = freshDb();
    db.prepare(
      `INSERT INTO attribute_type (id, name, columnLabel, target, type, converterClass, props_json)
       VALUES ('logo','Logo','Logo','name.abuchen.portfolio.model.Security','java.lang.String','name.abuchen.portfolio.model.AttributeType$ImageConverter','[]')`,
    ).run();
    expect(() => updateAttributeType(db, 'logo', { name: 'Hacked' })).toThrow(
      expect.objectContaining({ code: 'BUILTIN_TYPE_PROTECTED' }),
    );
  });
});

describe('deleteAttributeType', () => {
  it('cascades security_attr rows in single transaction', () => {
    const db = freshDb();
    const c = createAttributeType(db, { name: 'Sector', friendlyType: 'TEXT' });
    db.prepare(
      `INSERT INTO security (uuid, name, currency, isRetired, updatedAt) VALUES ('s1', 'Sec1', 'EUR', 0, '2024-01-01')`,
    ).run();
    db.prepare(
      `INSERT INTO security_attr (security, attr_uuid, type, value, seq) VALUES ('s1', ?, 'string', 'Tech', 0)`,
    ).run(c.id);

    const r = deleteAttributeType(db, c.id);

    expect(r.cascadedSecurityAttrs).toBe(1);
    expect(db.prepare('SELECT COUNT(*) AS c FROM attribute_type WHERE id = ?').get(c.id) as { c: number }).toEqual({ c: 0 });
    expect(db.prepare('SELECT COUNT(*) AS c FROM security_attr WHERE attr_uuid = ?').get(c.id) as { c: number }).toEqual({ c: 0 });
  });

  it('throws BUILTIN_TYPE_PROTECTED on logo (the only protected builtin)', () => {
    const db = freshDb();
    db.prepare(
      `INSERT INTO attribute_type (id, name, columnLabel, target, type, converterClass, props_json)
       VALUES ('logo','Logo','Logo','name.abuchen.portfolio.model.Security','java.lang.String','name.abuchen.portfolio.model.AttributeType$ImageConverter','[]')`,
    ).run();
    expect(() => deleteAttributeType(db, 'logo')).toThrow(
      expect.objectContaining({ code: 'BUILTIN_TYPE_PROTECTED' }),
    );
  });

  it('PP-parity: non-logo PP attribute ids (ter/aum/acquisitionFee/managementFee) are NOT protected', () => {
    const db = freshDb();
    for (const id of ['ter', 'aum', 'acquisitionFee', 'managementFee']) {
      db.prepare(
        `INSERT INTO attribute_type (id, name, columnLabel, target, type, converterClass, props_json)
         VALUES (?, ?, ?, 'name.abuchen.portfolio.model.Security', 'java.lang.String',
                 'name.abuchen.portfolio.model.AttributeType$StringConverter', '[]')`,
      ).run(id, id, id);
      expect(() => updateAttributeType(db, id, { name: `${id}-renamed` })).not.toThrow();
      expect(() => deleteAttributeType(db, id)).not.toThrow();
    }
  });
});

describe('listAttributeTypes', () => {
  it('returns target-filtered rows with usageCount', () => {
    const db = freshDb();
    const c = createAttributeType(db, { name: 'Sector', friendlyType: 'TEXT' });
    db.prepare(
      `INSERT INTO security (uuid, name, currency, isRetired, updatedAt) VALUES ('s1', 'Sec1', 'EUR', 0, '2024-01-01')`,
    ).run();
    db.prepare(
      `INSERT INTO security_attr (security, attr_uuid, type, value, seq) VALUES ('s1', ?, 'string', 'Tech', 0)`,
    ).run(c.id);

    const rows = listAttributeTypes(db, 'name.abuchen.portfolio.model.Security');
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(c.id);
    expect(rows[0].usageCount).toBe(1);
  });
});

it('exports BUILTIN_TYPE_IDS containing only logo', () => {
  expect([...BUILTIN_TYPE_IDS].sort()).toEqual(['logo']);
});
