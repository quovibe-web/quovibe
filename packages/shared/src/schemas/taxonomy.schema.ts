import { z } from 'zod';

export const createTaxonomySchema = z.object({
  name: z.string().min(1).max(100),
  template: z.enum([
    'asset-classes',
    'industries-gics-sectors',
    'industry',
    'asset-allocation',
    'regions',
    'regions-msci',
    'type-of-security',
  ]).optional(),
});

export const renameTaxonomySchema = z.object({
  name: z.string().min(1).max(100),
});

export const createCategorySchema = z.object({
  name: z.string().min(1).max(100),
  parentId: z.string().min(1),
  color: z.string().optional(),
  rank: z.number().int().min(0).optional(),
});

export const updateCategorySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  color: z.string().optional(),
  parentId: z.string().min(1).optional(),
  rank: z.number().int().min(0).optional(),
});

export const createAssignmentSchema = z.object({
  itemId: z.string().min(1),
  itemType: z.enum(['security', 'account']),
  categoryId: z.string().min(1),
  weight: z.number().int().min(0).max(10000).optional(),
});

export const updateAssignmentSchema = z.object({
  categoryId: z.string().min(1).optional(),
  weight: z.number().int().min(0).max(10000).optional(),
});

export const reorderTaxonomySchema = z.object({
  direction: z.enum(['up', 'down']),
});

export const updateAllocationSchema = z.object({
  allocation: z.number().min(0).max(10000),
});

export type CreateTaxonomyInput = z.infer<typeof createTaxonomySchema>;
export type RenameTaxonomyInput = z.infer<typeof renameTaxonomySchema>;
export type CreateCategoryInput = z.infer<typeof createCategorySchema>;
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;
export type CreateAssignmentInput = z.infer<typeof createAssignmentSchema>;
export type UpdateAssignmentInput = z.infer<typeof updateAssignmentSchema>;
export type UpdateAllocationInput = z.infer<typeof updateAllocationSchema>;
