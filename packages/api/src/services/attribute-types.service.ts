import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type {
  CreateAttributeTypeInput,
  UpdateAttributeTypeInput,
  FriendlyAttributeType,
} from '@quovibe/shared';

// `logo` alone — handled by a dedicated upload/fetch surface in AttributesSection
// (and per-account/portfolio in BrokerageUnitCard). All other PP attribute IDs
// (aum/ter/acquisitionFee/managementFee/vendor/etc.) are user-editable per PP parity.
export const BUILTIN_TYPE_IDS = new Set<string>(['logo']);

export const SECURITY_TARGET = 'name.abuchen.portfolio.model.Security';

const FRIENDLY_TYPE_MAP: Record<FriendlyAttributeType, { type: string; converterClass: string }> = {
  TEXT:       { type: 'java.lang.String',  converterClass: 'name.abuchen.portfolio.model.AttributeType$StringConverter' },
  NUMBER:     { type: 'java.lang.Double',  converterClass: 'name.abuchen.portfolio.model.AttributeType$NumberConverter' },
  PERCENTAGE: { type: 'java.lang.Double',  converterClass: 'name.abuchen.portfolio.model.AttributeType$PercentConverter' },
  AMOUNT:     { type: 'java.lang.Long',    converterClass: 'name.abuchen.portfolio.model.AttributeType$AmountPlainConverter' },
  DATE:       { type: 'java.util.Date',    converterClass: 'name.abuchen.portfolio.model.AttributeType$DateConverter' },
  BOOLEAN:    { type: 'java.lang.Boolean', converterClass: 'name.abuchen.portfolio.model.AttributeType$BooleanConverter' },
};

// Reverse map: converterClass → FriendlyAttributeType. Discriminates on converterClass (not type)
// because NUMBER and PERCENTAGE both map to java.lang.Double but have distinct converterClass values.
const CONVERTER_TO_FRIENDLY: Record<string, FriendlyAttributeType> = Object.fromEntries(
  (Object.entries(FRIENDLY_TYPE_MAP) as [FriendlyAttributeType, { converterClass: string }][]).map(
    ([ft, { converterClass }]) => [converterClass, ft],
  ),
) as Record<string, FriendlyAttributeType>;

export type AttributeTypeRow = {
  id: string;
  name: string;
  columnLabel: string;
  source: string | null;
  target: string;
  type: string;
  converterClass: string;
  friendlyType: FriendlyAttributeType;
  usageCount: number;
};

export type AttributeTypeServiceErrorCode =
  | 'DUPLICATE_NAME'
  | 'ATTRIBUTE_TYPE_NOT_FOUND'
  | 'BUILTIN_TYPE_PROTECTED';

export class AttributeTypeServiceError extends Error {
  constructor(public readonly code: AttributeTypeServiceErrorCode, message: string) {
    super(message);
    this.name = 'AttributeTypeServiceError';
  }
}

type RawAttributeTypeRow = Omit<AttributeTypeRow, 'friendlyType'>;

function enrichRow(raw: RawAttributeTypeRow): AttributeTypeRow {
  return { ...raw, friendlyType: CONVERTER_TO_FRIENDLY[raw.converterClass] ?? 'TEXT' };
}

function selectRow(sqlite: Database.Database, id: string): AttributeTypeRow | undefined {
  const raw = sqlite
    .prepare(
      `SELECT at.id, at.name, at.columnLabel, at.source, at.target, at.type, at.converterClass,
              (SELECT COUNT(*) FROM security_attr WHERE attr_uuid = at.id) AS usageCount
       FROM attribute_type at
       WHERE at.id = ?`,
    )
    .get(id) as RawAttributeTypeRow | undefined;
  return raw ? enrichRow(raw) : undefined;
}

function assertUniqueName(
  sqlite: Database.Database,
  name: string,
  target: string,
  selfId?: string,
): void {
  const trimmed = name.trim().toLowerCase();
  const rows = sqlite
    .prepare(
      `SELECT id FROM attribute_type WHERE target = ? AND LOWER(TRIM(name)) = ?`,
    )
    .all(target, trimmed) as { id: string }[];
  for (const row of rows) {
    if (row.id !== selfId) {
      throw new AttributeTypeServiceError('DUPLICATE_NAME', `Attribute type "${name}" already exists`);
    }
  }
}

function assertNotBuiltin(id: string): void {
  if (BUILTIN_TYPE_IDS.has(id)) {
    throw new AttributeTypeServiceError(
      'BUILTIN_TYPE_PROTECTED',
      `Built-in attribute type "${id}" is protected and cannot be modified`,
    );
  }
}

export function listAttributeTypes(
  sqlite: Database.Database,
  target: string = SECURITY_TARGET,
): AttributeTypeRow[] {
  const rows = sqlite
    .prepare(
      `SELECT at.id, at.name, at.columnLabel, at.source, at.target, at.type, at.converterClass,
              (SELECT COUNT(*) FROM security_attr WHERE attr_uuid = at.id) AS usageCount
       FROM attribute_type at
       WHERE at.target = ?
       ORDER BY at.name`,
    )
    .all(target) as RawAttributeTypeRow[];
  return rows.map(enrichRow);
}

export function createAttributeType(
  sqlite: Database.Database,
  input: CreateAttributeTypeInput,
): AttributeTypeRow {
  const target = SECURITY_TARGET;
  assertUniqueName(sqlite, input.name, target);
  const map = FRIENDLY_TYPE_MAP[input.friendlyType];
  const id = randomUUID();
  const name = input.name.trim();
  const columnLabel = input.columnLabel?.trim() || name;
  sqlite
    .prepare(
      `INSERT INTO attribute_type (id, name, columnLabel, source, target, type, converterClass, props_json)
       VALUES (?, ?, ?, NULL, ?, ?, ?, '[]')`,
    )
    .run(id, name, columnLabel, target, map.type, map.converterClass);
  const row = selectRow(sqlite, id);
  if (!row) throw new Error('createAttributeType: row vanished after insert');
  return row;
}

export function updateAttributeType(
  sqlite: Database.Database,
  id: string,
  input: UpdateAttributeTypeInput,
): AttributeTypeRow {
  assertNotBuiltin(id);
  const existing = selectRow(sqlite, id);
  if (!existing) {
    throw new AttributeTypeServiceError('ATTRIBUTE_TYPE_NOT_FOUND', `Attribute type ${id} not found`);
  }
  assertUniqueName(sqlite, input.name, existing.target, id);
  const name = input.name.trim();
  const columnLabel = input.columnLabel?.trim() || name;
  sqlite
    .prepare(`UPDATE attribute_type SET name = ?, columnLabel = ? WHERE id = ?`)
    .run(name, columnLabel, id);
  const row = selectRow(sqlite, id);
  if (!row) throw new Error('updateAttributeType: row vanished');
  return row;
}

export function deleteAttributeType(
  sqlite: Database.Database,
  id: string,
): { cascadedSecurityAttrs: number } {
  assertNotBuiltin(id);
  const existing = selectRow(sqlite, id);
  if (!existing) {
    throw new AttributeTypeServiceError('ATTRIBUTE_TYPE_NOT_FOUND', `Attribute type ${id} not found`);
  }
  const cascadedSecurityAttrs = sqlite.transaction(() => {
    const r = sqlite.prepare('DELETE FROM security_attr WHERE attr_uuid = ?').run(id);
    sqlite.prepare('DELETE FROM attribute_type WHERE id = ?').run(id);
    return r.changes;
  })();
  return { cascadedSecurityAttrs };
}
