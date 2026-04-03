import { Router, type Router as RouterType, type RequestHandler } from 'express';
import { updateAllocationSchema } from '@quovibe/shared';
import { getSqlite } from '../helpers/request';

export const taxonomiesRouter: RouterType = Router();

// GET /api/taxonomies — list all taxonomies from the taxonomy table
const listTaxonomies: RequestHandler = (req, res) => {
  const sqlite = getSqlite(req);

  const roots = sqlite
    .prepare(
      `SELECT t.uuid, t.name
       FROM taxonomy t
       LEFT JOIN taxonomy_data td
         ON td.taxonomy = t.uuid AND td.category IS NULL AND td.name = 'sortOrder'
       ORDER BY COALESCE(CAST(td.value AS INTEGER), t._id)`,
    )
    .all() as { uuid: string; name: string }[];

  res.json(roots.map((r) => ({ id: r.uuid, name: r.name })));
};

// GET /api/taxonomies/:id — full tree for a taxonomy
const getTaxonomy: RequestHandler = (req, res) => {
  const sqlite = getSqlite(req);
  const id = req.params['id'] as string;

  // Check taxonomy exists in the taxonomy table
  const taxonomy = sqlite
    .prepare(`SELECT uuid, name, root FROM taxonomy WHERE uuid = ?`)
    .get(id) as { uuid: string; name: string; root: string | null } | undefined;

  if (!taxonomy) {
    res.status(404).json({ error: 'Taxonomy not found' });
    return;
  }

  // All categories in this taxonomy
  const categories = sqlite
    .prepare(
      `SELECT uuid, name, parent, color, weight, rank
       FROM taxonomy_category
       WHERE taxonomy = ?
       ORDER BY rank`,
    )
    .all(id) as {
    uuid: string;
    name: string;
    parent: string | null;
    color: string | null;
    weight: number | null;
    rank: number;
  }[];

  // Assignments for all categories in this taxonomy (securities and accounts)
  const assignments = sqlite
    .prepare(
      `SELECT ta._id, ta.item, ta.item_type, ta.category, ta.weight,
              s.name as security_name, a.name as account_name
       FROM taxonomy_assignment ta
       LEFT JOIN security s ON s.uuid = ta.item AND ta.item_type = 'security'
       LEFT JOIN account a ON a.uuid = ta.item AND ta.item_type = 'account'
       WHERE ta.taxonomy = ?`,
    )
    .all(id) as {
    _id: number;
    item: string;
    item_type: string;
    category: string;
    weight: number | null;
    security_name: string | null;
    account_name: string | null;
  }[];

  // Group assignments by category
  const assignmentsByCategory = new Map<string, typeof assignments>();
  for (const a of assignments) {
    if (!assignmentsByCategory.has(a.category)) {
      assignmentsByCategory.set(a.category, []);
    }
    assignmentsByCategory.get(a.category)!.push(a);
  }

  // Build tree: each category gets its children and assignments
  const categoryMap = new Map(
    categories.map((c) => [
      c.uuid,
      {
        id: c.uuid,
        name: c.name,
        parentId: c.parent,
        color: c.color,
        weight: c.weight,
        children: [] as unknown[],
        assignments: (assignmentsByCategory.get(c.uuid) ?? []).map((a) => ({
          assignmentId: a._id,
          itemId: a.item,
          itemType: a.item_type,
          name: a.security_name ?? a.account_name,
          weight: a.weight,
        })),
      },
    ]),
  );

  // Root children = categories whose parent is the root category UUID or null,
  // excluding the root category itself.
  // Track placed categories to prevent circular references in the output.
  const rootCategoryId = taxonomy.root;
  const rootChildren: unknown[] = [];
  const placed = new Set<string>();
  for (const cat of categoryMap.values()) {
    const isRoot = rootCategoryId && cat.id === rootCategoryId;
    if (!isRoot && (!cat.parentId || cat.parentId === rootCategoryId)) {
      rootChildren.push(cat);
      placed.add(cat.id);
    } else if (!isRoot && cat.parentId && categoryMap.has(cat.parentId) && !placed.has(cat.parentId + ':' + cat.id)) {
      // Guard: skip if parent is a descendant of this category (cycle)
      let ancestor: string | null = cat.parentId;
      let isCycle = false;
      let depth = 0;
      while (ancestor && depth < 50) {
        if (ancestor === cat.id) { isCycle = true; break; }
        const parentNode = categoryMap.get(ancestor);
        ancestor = parentNode?.parentId ?? null;
        depth++;
      }
      if (!isCycle) {
        (categoryMap.get(cat.parentId)!.children as unknown[]).push(cat);
        placed.add(cat.id);
      }
    }
  }

  res.json({
    id: taxonomy.uuid,
    name: taxonomy.name,
    rootId: rootCategoryId ?? null,
    categories: rootChildren,
  });
};

// PATCH /api/taxonomies/categories/:id/allocation
const updateAllocationHandler: RequestHandler = (req, res) => {
  const sqlite = getSqlite(req);
  const categoryId = req.params['id'] as string;

  const existing = sqlite
    .prepare('SELECT uuid FROM taxonomy_category WHERE uuid = ?')
    .get(categoryId) as { uuid: string } | undefined;
  if (!existing) { res.status(404).json({ error: 'Category not found' }); return; }

  const { allocation } = updateAllocationSchema.parse(req.body);

  sqlite
    .prepare('UPDATE taxonomy_category SET weight = ? WHERE uuid = ?')
    .run(allocation, categoryId);

  // Compute sibling sum for the updated category's parent group
  const parentRow = sqlite
    .prepare('SELECT parent FROM taxonomy_category WHERE uuid = ?')
    .get(categoryId) as { parent: string | null } | undefined;

  let allocationSum = allocation;
  let allocationSumOk = false;

  if (parentRow?.parent) {
    const siblingRow = sqlite
      .prepare('SELECT COALESCE(SUM(weight), 0) AS total FROM taxonomy_category WHERE parent = ?')
      .get(parentRow.parent) as { total: number };
    allocationSum = siblingRow.total;
    allocationSumOk = allocationSum === 10000;
  }

  res.json({ ok: true, allocationSum, allocationSumOk });
};

taxonomiesRouter.get('/', listTaxonomies);
taxonomiesRouter.get('/:id', getTaxonomy);
taxonomiesRouter.patch('/categories/:id/allocation', updateAllocationHandler);
