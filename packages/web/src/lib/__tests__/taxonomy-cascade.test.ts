import { describe, it, expect } from 'vitest';
import type { TaxonomyTreeCategory } from '@/api/types';
import {
  buildCascadeMap,
  countCategoryCascade,
  findCategoryInTree,
  flattenCategoryWeights,
  walkTaxonomyTree,
} from '../taxonomy-cascade';

function makeCategory(
  id: string,
  opts: { assignments?: number; children?: TaxonomyTreeCategory[] } = {},
): TaxonomyTreeCategory {
  const assignments = Array.from({ length: opts.assignments ?? 0 }, (_, i) => ({
    assignmentId: i,
    itemId: `${id}-item-${i}`,
    itemType: 'security',
    name: null,
    weight: null,
  }));
  return {
    id,
    name: id,
    parentId: null,
    color: null,
    weight: null,
    children: opts.children ?? [],
    assignments,
  };
}

describe('countCategoryCascade', () => {
  it('returns 0/0 for missing tree', () => {
    expect(countCategoryCascade(undefined, 'nope')).toEqual({ assignments: 0, subcategories: 0 });
  });

  it('returns 0/0 for not-found category', () => {
    const tree = [makeCategory('a'), makeCategory('b')];
    expect(countCategoryCascade(tree, 'nope')).toEqual({ assignments: 0, subcategories: 0 });
  });

  it('counts direct assignments on a leaf', () => {
    const tree = [makeCategory('leaf', { assignments: 3 })];
    expect(countCategoryCascade(tree, 'leaf')).toEqual({ assignments: 3, subcategories: 0 });
  });

  it('counts direct assignments only (not descendant assignments)', () => {
    const tree = [
      makeCategory('parent', {
        assignments: 2,
        children: [
          makeCategory('child', { assignments: 5 }),
        ],
      }),
    ];
    expect(countCategoryCascade(tree, 'parent')).toEqual({ assignments: 2, subcategories: 1 });
  });

  it('counts all descendant categories recursively (not just direct children)', () => {
    const tree = [
      makeCategory('root', {
        children: [
          makeCategory('a', {
            children: [
              makeCategory('a1'),
              makeCategory('a2', {
                children: [makeCategory('a2a'), makeCategory('a2b')],
              }),
            ],
          }),
          makeCategory('b'),
        ],
      }),
    ];
    expect(countCategoryCascade(tree, 'root')).toEqual({ assignments: 0, subcategories: 6 });
  });

  it('finds deeply-nested target', () => {
    const tree = [
      makeCategory('root', {
        children: [
          makeCategory('mid', {
            children: [
              makeCategory('leaf', { assignments: 4 }),
            ],
          }),
        ],
      }),
    ];
    expect(countCategoryCascade(tree, 'leaf')).toEqual({ assignments: 4, subcategories: 0 });
  });
});

describe('walkTaxonomyTree + findCategoryInTree + flattenCategoryWeights', () => {
  const tree: TaxonomyTreeCategory[] = [
    { ...makeCategory('a'), weight: 3000, children: [
      { ...makeCategory('a1'), weight: 7000 },
    ] },
    { ...makeCategory('b'), weight: null },
  ];

  it('walkTaxonomyTree visits every node in DFS order', () => {
    const ids: string[] = [];
    walkTaxonomyTree(tree, (c) => ids.push(c.id));
    expect(ids).toEqual(['a', 'a1', 'b']);
  });

  it('findCategoryInTree returns nested node', () => {
    expect(findCategoryInTree(tree, 'a1')?.id).toBe('a1');
    expect(findCategoryInTree(tree, 'nope')).toBeNull();
  });

  it('flattenCategoryWeights defaults null weight to 0', () => {
    const m = flattenCategoryWeights(tree);
    expect(m.get('a')).toBe(3000);
    expect(m.get('a1')).toBe(7000);
    expect(m.get('b')).toBe(0);
  });

  it('buildCascadeMap precomputes cascade counts for every node', () => {
    const cascadeTree = [
      makeCategory('root', {
        assignments: 2,
        children: [
          makeCategory('child', { assignments: 3 }),
        ],
      }),
    ];
    const map = buildCascadeMap(cascadeTree);
    expect(map.get('root')).toEqual({ assignments: 2, subcategories: 1 });
    expect(map.get('child')).toEqual({ assignments: 3, subcategories: 0 });
  });
});
