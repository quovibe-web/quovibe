import type BetterSqlite3 from 'better-sqlite3';
import { getTemplate, PALETTE, type TemplateCategory } from '../data/taxonomy-templates';

export function createTaxonomy(
  sqlite: BetterSqlite3.Database,
  name: string,
  templateKey?: string,
): { uuid: string; name: string } {
  const taxonomyUuid = crypto.randomUUID();
  const rootCategoryUuid = crypto.randomUUID();

  const insertTaxonomy = sqlite.prepare(
    `INSERT INTO taxonomy (uuid, name, root) VALUES (?, ?, ?)`,
  );
  const insertCategory = sqlite.prepare(
    `INSERT INTO taxonomy_category (uuid, name, parent, taxonomy, color, weight, rank)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );

  sqlite.transaction(() => {
    insertTaxonomy.run(taxonomyUuid, name, rootCategoryUuid);
    // Root category (invisible, parentId = null) — ppxml2db root categories have weight=10000
    insertCategory.run(rootCategoryUuid, name, null, taxonomyUuid, '#000000', 10000, 0);

    if (templateKey) {
      const template = getTemplate(templateKey);
      if (!template) throw new Error(`Unknown template: ${templateKey}`);
      insertTemplateCategories(insertCategory, taxonomyUuid, rootCategoryUuid, template.categories);
    }

    // Set initial sort order = max(effective sort order across all OTHER taxonomies) + 1.
    // Must consider both explicit sortOrder entries AND _id fallback values
    // to avoid collisions with imported taxonomies that lack sortOrder entries.
    // Exclude the just-inserted taxonomy to avoid its _id inflating the max.
    const maxRow = sqlite
      .prepare(
        `SELECT COALESCE(MAX(eff), -1) + 1 AS next FROM (
           SELECT COALESCE(CAST(td.value AS INTEGER), t._id) AS eff
           FROM taxonomy t
           LEFT JOIN taxonomy_data td
             ON td.taxonomy = t.uuid AND td.category IS NULL AND td.name = 'sortOrder'
           WHERE t.uuid != ?
         )`,
      )
      .get(taxonomyUuid) as { next: number };
    sqlite.prepare(
      `INSERT INTO taxonomy_data (taxonomy, category, name, type, value) VALUES (?, NULL, 'sortOrder', 'int', ?)`,
    ).run(taxonomyUuid, String(maxRow.next));
  })();

  return { uuid: taxonomyUuid, name };
}

function insertTemplateCategories(
  insertCategory: BetterSqlite3.Statement,
  taxonomyUuid: string,
  parentUuid: string,
  categories: TemplateCategory[],
): void {
  for (let i = 0; i < categories.length; i++) {
    const cat = categories[i];
    const uuid = crypto.randomUUID();
    insertCategory.run(uuid, cat.name, parentUuid, taxonomyUuid, cat.color, 0, i);
    if (cat.children?.length) {
      insertTemplateCategories(insertCategory, taxonomyUuid, uuid, cat.children);
    }
  }
}

export function deleteTaxonomy(sqlite: BetterSqlite3.Database, taxonomyUuid: string): boolean {
  const taxonomy = sqlite
    .prepare(`SELECT uuid FROM taxonomy WHERE uuid = ?`)
    .get(taxonomyUuid) as { uuid: string } | undefined;
  if (!taxonomy) return false;

  sqlite.transaction(() => {
    // 1. Delete taxonomy_assignment_data for all assignments in this taxonomy
    sqlite.prepare(
      `DELETE FROM taxonomy_assignment_data
       WHERE assignment IN (SELECT _id FROM taxonomy_assignment WHERE taxonomy = ?)`,
    ).run(taxonomyUuid);
    // 2. Delete assignments
    sqlite.prepare(`DELETE FROM taxonomy_assignment WHERE taxonomy = ?`).run(taxonomyUuid);
    // 3. Delete taxonomy_data
    sqlite.prepare(`DELETE FROM taxonomy_data WHERE taxonomy = ?`).run(taxonomyUuid);
    // 4. Delete categories
    sqlite.prepare(`DELETE FROM taxonomy_category WHERE taxonomy = ?`).run(taxonomyUuid);
    // 5. Delete taxonomy
    sqlite.prepare(`DELETE FROM taxonomy WHERE uuid = ?`).run(taxonomyUuid);
  })();

  return true;
}

export function renameTaxonomy(
  sqlite: BetterSqlite3.Database,
  taxonomyUuid: string,
  newName: string,
): boolean {
  const result = sqlite
    .prepare(`UPDATE taxonomy SET name = ? WHERE uuid = ?`)
    .run(newName, taxonomyUuid);
  return result.changes > 0;
}

export function createCategory(
  sqlite: BetterSqlite3.Database,
  taxonomyUuid: string,
  parentId: string,
  name: string,
  color?: string,
  rank?: number,
): { id: string } {
  // Verify parent exists and belongs to this taxonomy
  const parent = sqlite
    .prepare(`SELECT uuid FROM taxonomy_category WHERE uuid = ? AND taxonomy = ?`)
    .get(parentId, taxonomyUuid) as { uuid: string } | undefined;
  if (!parent) throw new Error('Parent category not found in this taxonomy');

  const categoryUuid = crypto.randomUUID();
  const finalRank = rank ?? getNextRank(sqlite, parentId);
  const finalColor = color ?? PALETTE[Math.floor(Math.random() * PALETTE.length)];

  sqlite.prepare(
    `INSERT INTO taxonomy_category (uuid, name, parent, taxonomy, color, weight, rank)
     VALUES (?, ?, ?, ?, ?, 0, ?)`,
  ).run(categoryUuid, name, parentId, taxonomyUuid, finalColor, finalRank);

  return { id: categoryUuid };
}

function getNextRank(sqlite: BetterSqlite3.Database, parentId: string): number {
  const row = sqlite
    .prepare(`SELECT COALESCE(MAX(rank), -1) + 1 AS next FROM taxonomy_category WHERE parent = ?`)
    .get(parentId) as { next: number };
  return row.next;
}

/** Shift sibling category ranks >= fromRank up by 1 to make room for an insert/move. */
function shiftCategoryRanks(sqlite: BetterSqlite3.Database, parentId: string, fromRank: number): void {
  sqlite.prepare(
    'UPDATE taxonomy_category SET rank = rank + 1 WHERE parent = ? AND rank >= ?',
  ).run(parentId, fromRank);
}

/** Re-compact ranks for siblings under parentId to be sequential (0, 1, 2, ...). */
function compactCategoryRanks(sqlite: BetterSqlite3.Database, parentId: string): void {
  const siblings = sqlite.prepare(
    'SELECT uuid FROM taxonomy_category WHERE parent = ? ORDER BY rank',
  ).all(parentId) as { uuid: string }[];
  const update = sqlite.prepare('UPDATE taxonomy_category SET rank = ? WHERE uuid = ?');
  for (let i = 0; i < siblings.length; i++) {
    update.run(i, siblings[i].uuid);
  }
}

/**
 * Checks if reparenting `categoryId` under `newParentId` would create a cycle.
 * Walks up the ancestor chain from newParentId — if categoryId is found, it's a cycle.
 */
function wouldCreateCycle(
  sqlite: BetterSqlite3.Database,
  taxonomyUuid: string,
  categoryId: string,
  newParentId: string,
): boolean {
  if (newParentId === categoryId) return true;
  let current: string | null = newParentId;
  const maxDepth = 50;
  let depth = 0;
  while (current && depth < maxDepth) {
    const row = sqlite.prepare(
      'SELECT parent FROM taxonomy_category WHERE uuid = ? AND taxonomy = ?',
    ).get(current, taxonomyUuid) as { parent: string | null } | undefined;
    if (!row || row.parent === null) return false; // reached root
    if (row.parent === categoryId) return true;    // cycle detected
    current = row.parent;
    depth++;
  }
  return depth >= maxDepth; // safety: treat depth overflow as potential cycle
}

export function updateCategory(
  sqlite: BetterSqlite3.Database,
  taxonomyUuid: string,
  categoryId: string,
  updates: { name?: string; color?: string; parentId?: string; rank?: number },
): boolean {
  const existing = sqlite
    .prepare(`SELECT uuid, parent FROM taxonomy_category WHERE uuid = ? AND taxonomy = ?`)
    .get(categoryId, taxonomyUuid) as { uuid: string; parent: string | null } | undefined;
  if (!existing) return false;

  // Validate reparent: prevent cycles and verify parent belongs to same taxonomy
  if (updates.parentId !== undefined && updates.parentId !== existing.parent) {
    if (wouldCreateCycle(sqlite, taxonomyUuid, categoryId, updates.parentId)) {
      throw new Error('Cannot reparent: would create a circular dependency');
    }
    const parentExists = sqlite
      .prepare('SELECT uuid FROM taxonomy_category WHERE uuid = ? AND taxonomy = ?')
      .get(updates.parentId, taxonomyUuid) as { uuid: string } | undefined;
    if (!parentExists) {
      throw new Error('Parent category not found in this taxonomy');
    }
  }

  const setClauses: string[] = [];
  const values: unknown[] = [];

  if (updates.name !== undefined) { setClauses.push('name = ?'); values.push(updates.name); }
  if (updates.color !== undefined) { setClauses.push('color = ?'); values.push(updates.color); }
  if (updates.parentId !== undefined) { setClauses.push('parent = ?'); values.push(updates.parentId); }
  if (updates.rank !== undefined) {
    setClauses.push('rank = ?'); values.push(updates.rank);
  }

  if (setClauses.length === 0) return true;

  values.push(categoryId);
  sqlite.transaction(() => {
    if (updates.rank !== undefined) {
      const targetParent = updates.parentId ?? existing.parent;
      if (targetParent !== null) {
        shiftCategoryRanks(sqlite, targetParent, updates.rank);
      }
    }
    sqlite.prepare(`UPDATE taxonomy_category SET ${setClauses.join(', ')} WHERE uuid = ?`).run(...values);
  })();
  return true;
}

export function deleteCategory(
  sqlite: BetterSqlite3.Database,
  taxonomyUuid: string,
  categoryId: string,
  opts?: { renormalize?: boolean },
): boolean {
  const existing = sqlite
    .prepare(`SELECT uuid, parent FROM taxonomy_category WHERE uuid = ? AND taxonomy = ?`)
    .get(categoryId, taxonomyUuid) as { uuid: string; parent: string | null } | undefined;
  if (!existing) return false;
  if (existing.parent === null) {
    throw new Error('Cannot delete root category');
  }

  const renormalize = opts?.renormalize === true;

  sqlite.transaction(() => {
    // Affected items live DIRECTLY in the to-be-deleted category; descendant
    // categories survive via the reparent, so their items are unaffected.
    // Snapshot per-item pre-delete totals in one query grouped by item.
    const preTotals = new Map<string, number>();
    if (renormalize) {
      const rows = sqlite
        .prepare(
          `SELECT item, SUM(weight) AS total FROM taxonomy_assignment
           WHERE taxonomy = ?
             AND item IN (SELECT DISTINCT item FROM taxonomy_assignment WHERE category = ? AND taxonomy = ?)
           GROUP BY item`,
        )
        .all(taxonomyUuid, categoryId, taxonomyUuid) as { item: string; total: number }[];
      for (const r of rows) preTotals.set(r.item, r.total);
    }

    sqlite.prepare(
      `UPDATE taxonomy_category SET parent = ? WHERE parent = ? AND taxonomy = ?`,
    ).run(existing.parent, categoryId, taxonomyUuid);

    sqlite.prepare(
      `DELETE FROM taxonomy_assignment_data
       WHERE assignment IN (SELECT _id FROM taxonomy_assignment WHERE category = ? AND taxonomy = ?)`,
    ).run(categoryId, taxonomyUuid);

    sqlite.prepare(
      `DELETE FROM taxonomy_assignment WHERE category = ? AND taxonomy = ?`,
    ).run(categoryId, taxonomyUuid);

    sqlite.prepare(
      `DELETE FROM taxonomy_data WHERE category = ? AND taxonomy = ?`,
    ).run(categoryId, taxonomyUuid);

    sqlite.prepare(
      `DELETE FROM taxonomy_category WHERE uuid = ? AND taxonomy = ?`,
    ).run(categoryId, taxonomyUuid);

    if (existing.parent) {
      compactCategoryRanks(sqlite, existing.parent);
    }

    if (renormalize && preTotals.size > 0) {
      const remainingStmt = sqlite.prepare(
        `SELECT _id, item, weight FROM taxonomy_assignment
         WHERE taxonomy = ? AND item IN (${Array.from(preTotals.keys()).map(() => '?').join(',')})
         ORDER BY item, _id`,
      );
      const remaining = remainingStmt.all(taxonomyUuid, ...preTotals.keys()) as { _id: number; item: string; weight: number }[];
      const byItem = new Map<string, { _id: number; weight: number }[]>();
      for (const r of remaining) {
        const arr = byItem.get(r.item) ?? [];
        arr.push({ _id: r._id, weight: r.weight });
        byItem.set(r.item, arr);
      }

      const updateWeight = sqlite.prepare(`UPDATE taxonomy_assignment SET weight = ? WHERE _id = ?`);
      for (const [itemId, preTotal] of preTotals) {
        if (preTotal <= 0) continue;
        const rows = byItem.get(itemId);
        if (!rows || rows.length === 0) continue;
        const postTotal = rows.reduce((acc, r) => acc + r.weight, 0);
        if (postTotal <= 0 || postTotal >= preTotal) continue;

        const scaled = rows.map(r => ({
          _id: r._id,
          weight: Math.max(0, Math.min(10000, Math.round((r.weight * preTotal) / postTotal))),
        }));
        // Absorb rounding residual into largest-weight row so Σ == preTotal exactly.
        const residual = preTotal - scaled.reduce((acc, r) => acc + r.weight, 0);
        if (residual !== 0) {
          const absorber = scaled.reduce((best, r) => r.weight > best.weight ? r : best, scaled[0]);
          absorber.weight = Math.max(0, Math.min(10000, absorber.weight + residual));
        }
        for (const r of scaled) updateWeight.run(r.weight, r._id);
      }
    }
  })();

  return true;
}

export function createAssignment(
  sqlite: BetterSqlite3.Database,
  taxonomyUuid: string,
  itemId: string,
  itemType: 'security' | 'account',
  categoryId: string,
  weight?: number,
): { id: number } {
  // Verify category belongs to taxonomy
  const cat = sqlite
    .prepare(`SELECT uuid FROM taxonomy_category WHERE uuid = ? AND taxonomy = ?`)
    .get(categoryId, taxonomyUuid) as { uuid: string } | undefined;
  if (!cat) throw new Error('Category not found in this taxonomy');

  // Check for existing assignment of same item in target category (merge)
  const existing = sqlite
    .prepare(
      `SELECT _id, weight FROM taxonomy_assignment
       WHERE item = ? AND category = ? AND taxonomy = ?`,
    ).get(itemId, categoryId, taxonomyUuid) as { _id: number; weight: number } | undefined;

  if (existing) {
    const merged = Math.min(existing.weight + (weight ?? 10000), 10000);
    sqlite.prepare(`UPDATE taxonomy_assignment SET weight = ? WHERE _id = ?`).run(merged, existing._id);
    return { id: existing._id };
  }

  // Compute default weight: unassigned remainder
  const finalWeight = weight ?? computeUnassignedRemainder(sqlite, taxonomyUuid, itemId);
  const rank = getNextAssignmentRank(sqlite, categoryId);

  const result = sqlite.prepare(
    `INSERT INTO taxonomy_assignment (item, category, taxonomy, item_type, weight, rank)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(itemId, categoryId, taxonomyUuid, itemType, finalWeight, rank);

  return { id: result.lastInsertRowid as number };
}

function computeUnassignedRemainder(
  sqlite: BetterSqlite3.Database,
  taxonomyUuid: string,
  itemId: string,
): number {
  const row = sqlite
    .prepare(
      `SELECT COALESCE(SUM(weight), 0) AS total
       FROM taxonomy_assignment WHERE item = ? AND taxonomy = ?`,
    ).get(itemId, taxonomyUuid) as { total: number };
  return Math.max(10000 - row.total, 0);
}

function getNextAssignmentRank(sqlite: BetterSqlite3.Database, categoryId: string): number {
  const row = sqlite
    .prepare(`SELECT COALESCE(MAX(rank), -1) + 1 AS next FROM taxonomy_assignment WHERE category = ?`)
    .get(categoryId) as { next: number };
  return row.next;
}

export function updateAssignment(
  sqlite: BetterSqlite3.Database,
  taxonomyUuid: string,
  assignmentId: number,
  updates: { categoryId?: string; weight?: number },
): boolean {
  const existing = sqlite
    .prepare(`SELECT _id, item, item_type, category, weight FROM taxonomy_assignment WHERE _id = ? AND taxonomy = ?`)
    .get(assignmentId, taxonomyUuid) as {
      _id: number; item: string; item_type: string; category: string; weight: number;
    } | undefined;
  if (!existing) return false;

  // Weight set to 0 → delete
  if (updates.weight === 0) {
    return deleteAssignment(sqlite, taxonomyUuid, assignmentId);
  }

  // Move to different category: check for merge
  if (updates.categoryId && updates.categoryId !== existing.category) {
    const targetExisting = sqlite
      .prepare(
        `SELECT _id, weight FROM taxonomy_assignment
         WHERE item = ? AND category = ? AND taxonomy = ?`,
      ).get(existing.item, updates.categoryId, taxonomyUuid) as { _id: number; weight: number } | undefined;

    if (targetExisting) {
      // Merge: sum weights capped at 10000, delete source
      const merged = Math.min(targetExisting.weight + existing.weight, 10000);
      sqlite.transaction(() => {
        sqlite.prepare(`UPDATE taxonomy_assignment SET weight = ? WHERE _id = ?`).run(merged, targetExisting._id);
        sqlite.prepare(`DELETE FROM taxonomy_assignment_data WHERE assignment = ?`).run(assignmentId);
        sqlite.prepare(`DELETE FROM taxonomy_assignment WHERE _id = ?`).run(assignmentId);
      })();
      return true;
    }
  }

  // Build a single atomic UPDATE for non-merge changes
  const setClauses: string[] = [];
  const values: unknown[] = [];
  if (updates.categoryId && updates.categoryId !== existing.category) {
    setClauses.push('category = ?'); values.push(updates.categoryId);
  }
  if (updates.weight !== undefined) {
    setClauses.push('weight = ?'); values.push(updates.weight);
  }
  if (setClauses.length > 0) {
    values.push(assignmentId);
    sqlite.prepare(`UPDATE taxonomy_assignment SET ${setClauses.join(', ')} WHERE _id = ?`).run(...values);
  }

  return true;
}

export function deleteAssignment(
  sqlite: BetterSqlite3.Database,
  taxonomyUuid: string,
  assignmentId: number,
): boolean {
  const existing = sqlite
    .prepare(`SELECT _id FROM taxonomy_assignment WHERE _id = ? AND taxonomy = ?`)
    .get(assignmentId, taxonomyUuid) as { _id: number } | undefined;
  if (!existing) return false;

  sqlite.transaction(() => {
    sqlite.prepare(`DELETE FROM taxonomy_assignment_data WHERE assignment = ?`).run(assignmentId);
    sqlite.prepare(`DELETE FROM taxonomy_assignment WHERE _id = ?`).run(assignmentId);
  })();
  return true;
}

/**
 * Thrown by `updateCategoryAllocationsBulk` when any incoming id doesn't
 * belong to the target taxonomy. Route handlers convert to HTTP 400
 * `{ error: 'CATEGORY_NOT_IN_TAXONOMY' }`.
 */
export class CategoryNotInTaxonomyError extends Error {
  readonly code = 'CATEGORY_NOT_IN_TAXONOMY' as const;
  readonly offendingId: string;
  constructor(offendingId: string) {
    super(`Category ${offendingId} does not belong to the target taxonomy`);
    this.offendingId = offendingId;
  }
}

/**
 * Bulk-update category allocations. Every id must belong to the target
 * taxonomy or the whole batch rolls back with `CategoryNotInTaxonomyError`.
 */
export function updateCategoryAllocationsBulk(
  sqlite: BetterSqlite3.Database,
  taxonomyUuid: string,
  items: Array<{ id: string; allocation: number }>,
): void {
  if (items.length === 0) return;
  sqlite.transaction(() => {
    const placeholders = items.map(() => '?').join(',');
    const found = sqlite.prepare(
      `SELECT uuid FROM taxonomy_category WHERE taxonomy = ? AND uuid IN (${placeholders})`,
    ).all(taxonomyUuid, ...items.map(i => i.id)) as { uuid: string }[];
    if (found.length !== items.length) {
      const foundSet = new Set(found.map(r => r.uuid));
      const missing = items.find(i => !foundSet.has(i.id))!;
      throw new CategoryNotInTaxonomyError(missing.id);
    }
    const updateStmt = sqlite.prepare(
      `UPDATE taxonomy_category SET weight = ? WHERE uuid = ? AND taxonomy = ?`,
    );
    for (const item of items) updateStmt.run(item.allocation, item.id, taxonomyUuid);
  })();
}

/**
 * Swap a category with its immediate sibling (under the same parent) in the
 * rank order. Returns false at the sibling-set boundary (first-sibling + up,
 * last-sibling + down) or when the category doesn't exist / is the root.
 */
export function reorderCategory(
  sqlite: BetterSqlite3.Database,
  taxonomyUuid: string,
  categoryId: string,
  direction: 'up' | 'down',
): boolean {
  const existing = sqlite
    .prepare(`SELECT uuid, parent FROM taxonomy_category WHERE uuid = ? AND taxonomy = ?`)
    .get(categoryId, taxonomyUuid) as { uuid: string; parent: string | null } | undefined;
  if (!existing || existing.parent === null) return false;

  return sqlite.transaction(() => {
    // Close any gaps from past deletes so rank is dense 0..N-1 before the swap.
    compactCategoryRanks(sqlite, existing.parent as string);

    const siblings = sqlite.prepare(
      `SELECT uuid FROM taxonomy_category WHERE parent = ? AND taxonomy = ? ORDER BY rank`,
    ).all(existing.parent, taxonomyUuid) as { uuid: string }[];

    const idx = siblings.findIndex(s => s.uuid === categoryId);
    if (idx < 0) return false;
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= siblings.length) return false;

    const update = sqlite.prepare('UPDATE taxonomy_category SET rank = ? WHERE uuid = ?');
    update.run(swapIdx, siblings[idx].uuid);
    update.run(idx, siblings[swapIdx].uuid);
    return true;
  })() as boolean;
}

export function reorderTaxonomy(
  sqlite: BetterSqlite3.Database,
  taxonomyUuid: string,
  direction: 'up' | 'down',
): boolean {
  // Get all taxonomies sorted by their current sort order
  const taxonomies = sqlite.prepare(
    `SELECT t.uuid,
            COALESCE(CAST(td.value AS INTEGER), t._id) AS sort_order
     FROM taxonomy t
     LEFT JOIN taxonomy_data td
       ON td.taxonomy = t.uuid AND td.category IS NULL AND td.name = 'sortOrder'
     ORDER BY sort_order`,
  ).all() as { uuid: string; sort_order: number }[];

  const idx = taxonomies.findIndex((t) => t.uuid === taxonomyUuid);
  if (idx < 0) return false;

  const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= taxonomies.length) return false;

  // Swap in the array
  const temp = taxonomies[idx];
  taxonomies[idx] = taxonomies[swapIdx];
  taxonomies[swapIdx] = temp;

  // Normalize: assign consecutive sortOrder values (0, 1, 2, ...) to ALL taxonomies.
  // This eliminates the mixed-mode problem where some taxonomies use _id fallback
  // and avoids sortOrder collisions or rank drift over time.
  sqlite.transaction(() => {
    for (let i = 0; i < taxonomies.length; i++) {
      upsertSortOrder(sqlite, taxonomies[i].uuid, i);
    }
  })();

  return true;
}

function upsertSortOrder(sqlite: BetterSqlite3.Database, taxonomyUuid: string, rank: number): void {
  const existing = sqlite
    .prepare(`SELECT rowid FROM taxonomy_data WHERE taxonomy = ? AND category IS NULL AND name = 'sortOrder'`)
    .get(taxonomyUuid) as { rowid: number } | undefined;

  if (existing) {
    sqlite.prepare(
      `UPDATE taxonomy_data SET value = ? WHERE taxonomy = ? AND category IS NULL AND name = 'sortOrder'`,
    ).run(String(rank), taxonomyUuid);
  } else {
    sqlite.prepare(
      `INSERT INTO taxonomy_data (taxonomy, category, name, type, value) VALUES (?, NULL, 'sortOrder', 'int', ?)`,
    ).run(taxonomyUuid, String(rank));
  }
}
