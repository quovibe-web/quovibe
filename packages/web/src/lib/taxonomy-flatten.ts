import type { TaxonomyTreeCategory } from '@/api/types';

export interface FlatCategory {
  id: string;
  name: string;
  depth: number;
}

/**
 * Walk a taxonomy tree depth-first and return every category as a flat list.
 * Each entry carries its `depth` so consumers can render nested indentation
 * (e.g. in a <select>) without the helper needing to know about presentation.
 */
export function flattenCategories(
  cats: TaxonomyTreeCategory[],
  depth = 0,
): FlatCategory[] {
  const result: FlatCategory[] = [];
  for (const cat of cats) {
    result.push({ id: cat.id, name: cat.name, depth });
    result.push(...flattenCategories(cat.children, depth + 1));
  }
  return result;
}

export function buildCategoryNameMap(cats: TaxonomyTreeCategory[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const entry of flattenCategories(cats)) {
    map.set(entry.id, entry.name);
  }
  return map;
}
