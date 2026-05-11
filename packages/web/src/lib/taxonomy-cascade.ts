import type { TaxonomyTreeCategory } from '@/api/types';

export function walkTaxonomyTree(
  tree: TaxonomyTreeCategory[] | undefined,
  visit: (node: TaxonomyTreeCategory) => void,
): void {
  if (!tree) return;
  for (const c of tree) {
    visit(c);
    walkTaxonomyTree(c.children, visit);
  }
}

export function flattenCategoryWeights(
  tree: TaxonomyTreeCategory[] | undefined,
): Map<string, number> {
  const out = new Map<string, number>();
  walkTaxonomyTree(tree, (c) => { out.set(c.id, c.weight ?? 0); });
  return out;
}

export function findCategoryInTree(
  tree: TaxonomyTreeCategory[] | undefined,
  categoryId: string,
): TaxonomyTreeCategory | null {
  if (!tree) return null;
  for (const c of tree) {
    if (c.id === categoryId) return c;
    const inChildren = findCategoryInTree(c.children, categoryId);
    if (inChildren) return inChildren;
  }
  return null;
}

/**
 * `assignments` = directly on the target (descendants' assignments survive
 * via the reparent). `subcategories` = entire descendant subtree (every
 * descendant's effective parent changes by one level).
 */
export function countCategoryCascade(
  tree: TaxonomyTreeCategory[] | undefined,
  categoryId: string,
): { assignments: number; subcategories: number } {
  const target = findCategoryInTree(tree, categoryId);
  if (!target) return { assignments: 0, subcategories: 0 };
  return {
    assignments: target.assignments.length,
    subcategories: countDescendants(target.children),
  };
}

/**
 * Precompute cascade counts for every node in the tree in one walk. Lets
 * callers avoid an O(N) find + O(subtree) count per open of the row menu.
 */
export function buildCascadeMap(
  tree: TaxonomyTreeCategory[] | undefined,
): Map<string, { assignments: number; subcategories: number }> {
  const out = new Map<string, { assignments: number; subcategories: number }>();
  walkTaxonomyTree(tree, (c) => {
    out.set(c.id, {
      assignments: c.assignments.length,
      subcategories: countDescendants(c.children),
    });
  });
  return out;
}

function countDescendants(children: TaxonomyTreeCategory[]): number {
  let n = 0;
  for (const c of children) {
    n += 1 + countDescendants(c.children);
  }
  return n;
}
