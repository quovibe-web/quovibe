// Env-var prelude — must precede all project imports (config.ts reads at module-load time)
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const QUOVIBE_DATA_DIR = mkdtempSync(join(tmpdir(), 'qv-attr-types-test-'));
const QUOVIBE_DEMO_SOURCE = join(QUOVIBE_DATA_DIR, 'demo.db');
process.env['QUOVIBE_DATA_DIR'] = QUOVIBE_DATA_DIR;
process.env['QUOVIBE_DEMO_SOURCE'] = QUOVIBE_DEMO_SOURCE;

import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';

import { seedFreshPortfolio } from './_helpers/portfolio-fixtures.js';
import { acquirePortfolioDb, releasePortfolioDb } from '../services/portfolio-db-pool.js';

// Bootstrap the demo source DB before any test creates a portfolio
beforeAll(async () => {
  const Database = (await import('better-sqlite3')).default;
  const { applyBootstrap } = await import('../db/apply-bootstrap.js');
  const db = new Database(QUOVIBE_DEMO_SOURCE);
  applyBootstrap(db);
  db.prepare("INSERT OR IGNORE INTO vf_portfolio_meta (key, value) VALUES ('name', 'Demo')").run();
  db.close();
});

const BASE = (pid: string) => `/api/p/${pid}/attribute-types`;

// ─── Case 1: GET empty list ────────────────────────────────────────────────
describe('GET /api/p/:portfolioId/attribute-types', () => {
  it('returns empty array for fresh portfolio', async () => {
    const { portfolioId, app } = await seedFreshPortfolio();
    const res = await request(app).get(BASE(portfolioId)).expect(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(0);
  });
});

// ─── Case 1b: GET — usageCount populated ──────────────────────────────────
describe('GET /api/p/:portfolioId/attribute-types — usageCount', () => {
  it('returns usageCount === 1 when one security_attr row references the type', async () => {
    const { portfolioId, app } = await seedFreshPortfolio();

    // Create the attribute type via the API
    const created = await request(app)
      .post(BASE(portfolioId))
      .send({ name: 'Usage Count Test', friendlyType: 'TEXT' })
      .expect(201);
    const attrId: string = (created.body as { id: string }).id;

    // Seed a security row and a security_attr row directly via SQLite
    const h1b = acquirePortfolioDb(portfolioId);
    const sqlite1b = h1b.sqlite;
    const secUuid = randomUUID();
    try {
      sqlite1b
        .prepare(
          `INSERT INTO security (uuid, name, currency, updatedAt)
           VALUES (?, ?, ?, ?)`,
        )
        .run(secUuid, 'Usage Test Security', 'EUR', new Date().toISOString());

      sqlite1b
        .prepare(
          `INSERT INTO security_attr (security, attr_uuid, type, value)
           VALUES (?, ?, ?, ?)`,
        )
        .run(secUuid, attrId, 'TEXT', 'some-value');
    } finally {
      releasePortfolioDb(portfolioId);
    }

    const list = await request(app).get(BASE(portfolioId)).expect(200);
    const found = (list.body as { id: string; usageCount: number }[]).find((r) => r.id === attrId);
    expect(found).toBeDefined();
    expect(found!.usageCount).toBe(1);
  });
});

// ─── Case 2: POST creates attribute type (201) ─────────────────────────────
describe('POST /api/p/:portfolioId/attribute-types', () => {
  it('creates a new attribute type and returns 201 with the created row', async () => {
    const { portfolioId, app } = await seedFreshPortfolio();
    const res = await request(app)
      .post(BASE(portfolioId))
      .send({ name: 'My Rating', friendlyType: 'TEXT' })
      .expect(201);

    // type stores the Java class name (friendlyType TEXT → java.lang.String)
    expect(res.body).toMatchObject({
      name: 'My Rating',
      converterClass: 'name.abuchen.portfolio.model.AttributeType$StringConverter',
    });
    expect(typeof res.body.type).toBe('string');
    expect(typeof res.body.id).toBe('string');
    expect(res.body.id).toBeTruthy();
  });
});

// ─── Case 3: POST → GET round-trip ────────────────────────────────────────
describe('POST → GET round-trip', () => {
  it('created attribute type appears in the GET list', async () => {
    const { portfolioId, app } = await seedFreshPortfolio();

    await request(app)
      .post(BASE(portfolioId))
      .send({ name: 'Sector', friendlyType: 'TEXT' })
      .expect(201);

    const list = await request(app).get(BASE(portfolioId)).expect(200);
    const found = (list.body as { name: string }[]).find((r) => r.name === 'Sector');
    expect(found).toBeDefined();
  });
});

// ─── Case 4: POST 409 on duplicate name ───────────────────────────────────
describe('POST duplicate name', () => {
  it('returns 409 DUPLICATE_NAME when name already exists for same target', async () => {
    const { portfolioId, app } = await seedFreshPortfolio();

    await request(app)
      .post(BASE(portfolioId))
      .send({ name: 'ESG Score', friendlyType: 'NUMBER' })
      .expect(201);

    const res = await request(app)
      .post(BASE(portfolioId))
      .send({ name: 'ESG Score', friendlyType: 'TEXT' })
      .expect(409);

    expect(res.body.error).toBe('DUPLICATE_NAME');
  });
});

// ─── Case 5: PUT renames attribute type ───────────────────────────────────
describe('PUT /api/p/:portfolioId/attribute-types/:id', () => {
  it('updates name and columnLabel, returns 200 with updated row', async () => {
    const { portfolioId, app } = await seedFreshPortfolio();

    const created = await request(app)
      .post(BASE(portfolioId))
      .send({ name: 'Old Name', friendlyType: 'DATE' })
      .expect(201);

    const id: string = (created.body as { id: string }).id;

    const res = await request(app)
      .put(`${BASE(portfolioId)}/${id}`)
      .send({ name: 'New Name', columnLabel: 'NL' })
      .expect(200);

    expect(res.body).toMatchObject({ id, name: 'New Name', columnLabel: 'NL' });
  });
});

// ─── Case 6: PUT 404 on unknown id ────────────────────────────────────────
describe('PUT unknown id', () => {
  it('returns 404 ATTRIBUTE_TYPE_NOT_FOUND for non-existent id', async () => {
    const { portfolioId, app } = await seedFreshPortfolio();
    const res = await request(app)
      .put(`${BASE(portfolioId)}/${randomUUID()}`)
      .send({ name: 'X' })
      .expect(404);

    expect(res.body.error).toBe('ATTRIBUTE_TYPE_NOT_FOUND');
  });
});

// ─── Case 7: DELETE cascades security_attr rows ───────────────────────────
describe('DELETE /api/p/:portfolioId/attribute-types/:id — cascade', () => {
  it('deletes the type and returns cascadedSecurityAttrs count', async () => {
    const { portfolioId, app } = await seedFreshPortfolio();

    // Create the attribute type
    const created = await request(app)
      .post(BASE(portfolioId))
      .send({ name: 'Cascade Test', friendlyType: 'TEXT' })
      .expect(201);
    const attrId: string = (created.body as { id: string }).id;

    // Seed a security row and a security_attr row directly via SQLite
    const h7 = acquirePortfolioDb(portfolioId);
    const sqlite7 = h7.sqlite;
    const secUuid = randomUUID();
    try {
      sqlite7
        .prepare(
          `INSERT INTO security (uuid, name, currency, updatedAt)
           VALUES (?, ?, ?, ?)`,
        )
        .run(secUuid, 'Test Security', 'EUR', new Date().toISOString());

      sqlite7
        .prepare(
          `INSERT INTO security_attr (security, attr_uuid, type, value)
           VALUES (?, ?, ?, ?)`,
        )
        .run(secUuid, attrId, 'TEXT', 'some-value');
    } finally {
      releasePortfolioDb(portfolioId);
    }

    const res = await request(app)
      .delete(`${BASE(portfolioId)}/${attrId}`)
      .expect(200);

    expect(res.body.cascadedSecurityAttrs).toBe(1);
  });
});

// ─── Case 8: DELETE 403 on builtin type id ────────────────────────────────
describe('DELETE builtin type protection', () => {
  it('returns 403 BUILTIN_TYPE_PROTECTED when deleting a builtin id (logo)', async () => {
    const { portfolioId, app } = await seedFreshPortfolio();

    // assertNotBuiltin runs BEFORE existence check — no seeded row needed
    const res = await request(app)
      .delete(`${BASE(portfolioId)}/logo`)
      .expect(403);

    expect(res.body.error).toBe('BUILTIN_TYPE_PROTECTED');
  });
});

// ─── Case 9: Drizzle PK fix — two rows with same id different targets ──────
describe('Drizzle PK fix lock — attribute_type._id is PK, id has no UNIQUE constraint', () => {
  it('allows two rows with same id string if targets differ (verifies no UNIQUE on id column)', async () => {
    const { portfolioId } = await seedFreshPortfolio();

    const h9 = acquirePortfolioDb(portfolioId);
    const sqlite = h9.sqlite;
    try {
      // Insert two rows with the same `id` value but different targets
      // If a UNIQUE constraint existed on `id`, the second insert would throw
      sqlite
        .prepare(
          `INSERT INTO attribute_type (id, name, columnLabel, target, type, converterClass, props_json)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          'pk-test-id',
          'PK Test A',
          'PK A',
          'name.abuchen.portfolio.model.Security',
          'java.lang.String',
          'name.abuchen.portfolio.model.AttributeType$StringConverter',
          '[]',
        );

      sqlite
        .prepare(
          `INSERT INTO attribute_type (id, name, columnLabel, target, type, converterClass, props_json)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          'pk-test-id',
          'PK Test B',
          'PK B',
          'name.abuchen.portfolio.model.Account',
          'java.lang.String',
          'name.abuchen.portfolio.model.AttributeType$StringConverter',
          '[]',
        );

      const rows = sqlite
        .prepare(`SELECT id FROM attribute_type WHERE id = ?`)
        .all('pk-test-id') as { id: string }[];

      // Two rows with the same id string must coexist — confirms no UNIQUE on `id`
      expect(rows).toHaveLength(2);
    } finally {
      releasePortfolioDb(portfolioId);
    }
  });
});

// ─── Case 10: PUT strict schema rejects friendlyType ──────────────────────
describe('PUT strict schema enforcement', () => {
  it('returns 400 when PUT body includes friendlyType (updateAttributeTypeSchema is .strict())', async () => {
    const { portfolioId, app } = await seedFreshPortfolio();

    const created = await request(app)
      .post(BASE(portfolioId))
      .send({ name: 'Strict Test', friendlyType: 'BOOLEAN' })
      .expect(201);
    const id: string = (created.body as { id: string }).id;

    // updateAttributeTypeSchema is .strict() — friendlyType is not allowed on PUT
    const res = await request(app)
      .put(`${BASE(portfolioId)}/${id}`)
      .send({ name: 'New Strict', friendlyType: 'TEXT' })
      .expect(400);

    expect(res.body.error).toBeDefined();
  });
});
