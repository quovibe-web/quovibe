import { Router, type Router as RouterType, type RequestHandler } from 'express';
import { getSqlite } from '../helpers/request';
import {
  createTaxonomySchema, renameTaxonomySchema, reorderTaxonomySchema,
  createCategorySchema, updateCategorySchema,
  createAssignmentSchema, updateAssignmentSchema,
} from '@quovibe/shared';
import {
  createTaxonomy, deleteTaxonomy, renameTaxonomy, reorderTaxonomy,
  createCategory, updateCategory, deleteCategory,
  createAssignment, updateAssignment, deleteAssignment,
} from '../services/taxonomy.service';

export const taxonomyWriteRouter: RouterType = Router();

// POST /api/taxonomies — create taxonomy
const createHandler: RequestHandler = (req, res) => {
  const sqlite = getSqlite(req);
  const { name, template } = createTaxonomySchema.parse(req.body);
  try {
    const result = createTaxonomy(sqlite, name, template);
    res.status(201).json({ id: result.uuid, name: result.name });
  } catch (e: unknown) {
    res.status(400).json({ error: (e as Error).message });
  }
};

// PATCH /api/taxonomies/:id — rename
const renameHandler: RequestHandler = (req, res) => {
  const sqlite = getSqlite(req);
  const id = req.params['id'] as string;
  const { name } = renameTaxonomySchema.parse(req.body);
  const ok = renameTaxonomy(sqlite, id, name);
  if (!ok) { res.status(404).json({ error: 'Taxonomy not found' }); return; }
  res.json({ ok: true });
};

// DELETE /api/taxonomies/:id
const deleteHandler: RequestHandler = (req, res) => {
  const sqlite = getSqlite(req);
  const id = req.params['id'] as string;
  const ok = deleteTaxonomy(sqlite, id);
  if (!ok) { res.status(404).json({ error: 'Taxonomy not found' }); return; }
  res.json({ ok: true });
};

// POST /api/taxonomies/:id/categories
const createCategoryHandler: RequestHandler = (req, res) => {
  const sqlite = getSqlite(req);
  const taxonomyId = req.params['id'] as string;
  const { name, parentId, color, rank } = createCategorySchema.parse(req.body);
  try {
    const result = createCategory(sqlite, taxonomyId, parentId, name, color, rank);
    res.status(201).json(result);
  } catch (e: unknown) {
    res.status(400).json({ error: (e as Error).message });
  }
};

// PATCH /api/taxonomies/:id/categories/:catId
const updateCategoryHandler: RequestHandler = (req, res) => {
  const sqlite = getSqlite(req);
  const taxonomyId = req.params['id'] as string;
  const catId = req.params['catId'] as string;
  const updates = updateCategorySchema.parse(req.body);
  try {
    const ok = updateCategory(sqlite, taxonomyId, catId, updates);
    if (!ok) { res.status(404).json({ error: 'Category not found' }); return; }
    res.json({ ok: true });
  } catch (e: unknown) {
    res.status(400).json({ error: (e as Error).message });
  }
};

// DELETE /api/taxonomies/:id/categories/:catId
const deleteCategoryHandler: RequestHandler = (req, res) => {
  const sqlite = getSqlite(req);
  const taxonomyId = req.params['id'] as string;
  const catId = req.params['catId'] as string;
  const ok = deleteCategory(sqlite, taxonomyId, catId);
  if (!ok) { res.status(404).json({ error: 'Category not found' }); return; }
  res.json({ ok: true });
};

// POST /api/taxonomies/:id/assignments
const createAssignmentHandler: RequestHandler = (req, res) => {
  const sqlite = getSqlite(req);
  const taxonomyId = req.params['id'] as string;
  const { itemId, itemType, categoryId, weight } = createAssignmentSchema.parse(req.body);
  try {
    const result = createAssignment(sqlite, taxonomyId, itemId, itemType, categoryId, weight);
    res.status(201).json(result);
  } catch (e: unknown) {
    res.status(400).json({ error: (e as Error).message });
  }
};

// PATCH /api/taxonomies/:id/assignments/:assignmentId
const updateAssignmentHandler: RequestHandler = (req, res) => {
  const sqlite = getSqlite(req);
  const taxonomyId = req.params['id'] as string;
  const assignmentId = parseInt(req.params['assignmentId'] as string, 10);
  if (isNaN(assignmentId)) { res.status(400).json({ error: 'Invalid assignment ID' }); return; }
  const updates = updateAssignmentSchema.parse(req.body);
  const ok = updateAssignment(sqlite, taxonomyId, assignmentId, updates);
  if (!ok) { res.status(404).json({ error: 'Assignment not found' }); return; }
  res.json({ ok: true });
};

// DELETE /api/taxonomies/:id/assignments/:assignmentId
const deleteAssignmentHandler: RequestHandler = (req, res) => {
  const sqlite = getSqlite(req);
  const taxonomyId = req.params['id'] as string;
  const assignmentId = parseInt(req.params['assignmentId'] as string, 10);
  if (isNaN(assignmentId)) { res.status(400).json({ error: 'Invalid assignment ID' }); return; }
  const ok = deleteAssignment(sqlite, taxonomyId, assignmentId);
  if (!ok) { res.status(404).json({ error: 'Assignment not found' }); return; }
  res.json({ ok: true });
};

// PATCH /api/taxonomies/:id/reorder
const reorderHandler: RequestHandler = (req, res) => {
  const sqlite = getSqlite(req);
  const id = req.params['id'] as string;
  const { direction } = reorderTaxonomySchema.parse(req.body);
  const ok = reorderTaxonomy(sqlite, id, direction);
  if (!ok) { res.status(400).json({ error: 'TAXONOMY_MOVE_AT_BOUNDARY' }); return; }
  res.json({ ok: true });
};

taxonomyWriteRouter.post('/', createHandler);
taxonomyWriteRouter.patch('/:id/reorder', reorderHandler);
taxonomyWriteRouter.patch('/:id', renameHandler);
taxonomyWriteRouter.delete('/:id', deleteHandler);
taxonomyWriteRouter.post('/:id/categories', createCategoryHandler);
taxonomyWriteRouter.patch('/:id/categories/:catId', updateCategoryHandler);
taxonomyWriteRouter.delete('/:id/categories/:catId', deleteCategoryHandler);
taxonomyWriteRouter.post('/:id/assignments', createAssignmentHandler);
taxonomyWriteRouter.patch('/:id/assignments/:assignmentId', updateAssignmentHandler);
taxonomyWriteRouter.delete('/:id/assignments/:assignmentId', deleteAssignmentHandler);
