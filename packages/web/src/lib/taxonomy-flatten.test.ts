import { describe, it, expect } from 'vitest';
import type { TaxonomyTreeCategory } from '@/api/types';
import { flattenCategories, buildCategoryNameMap } from './taxonomy-flatten';

function cat(id: string, name: string, children: TaxonomyTreeCategory[] = []): TaxonomyTreeCategory {
  return { id, name, children } as TaxonomyTreeCategory;
}

describe('flattenCategories', () => {
  it('walks depth-first, preserving parent-before-children order', () => {
    const tree = [
      cat('A', 'Alpha', [
        cat('A1', 'Alpha-1', [cat('A1a', 'Alpha-1-a')]),
        cat('A2', 'Alpha-2'),
      ]),
      cat('B', 'Beta'),
    ];
    const flat = flattenCategories(tree);
    expect(flat.map((c) => c.id)).toEqual(['A', 'A1', 'A1a', 'A2', 'B']);
  });

  it('tags each entry with its tree depth (root = 0)', () => {
    const tree = [cat('root', 'Root', [cat('child', 'Child', [cat('grand', 'Grand')])])];
    const flat = flattenCategories(tree);
    expect(flat.map((c) => c.depth)).toEqual([0, 1, 2]);
  });

  it('returns an empty list for an empty tree', () => {
    expect(flattenCategories([])).toEqual([]);
  });
});

describe('buildCategoryNameMap', () => {
  it('maps every category id to its name regardless of depth', () => {
    const tree = [
      cat('top', 'Top', [cat('mid', 'Mid', [cat('leaf', 'Leaf')])]),
    ];
    const map = buildCategoryNameMap(tree);
    expect(map.get('top')).toBe('Top');
    expect(map.get('mid')).toBe('Mid');
    expect(map.get('leaf')).toBe('Leaf');
    expect(map.size).toBe(3);
  });

  it('last-wins on duplicate ids (defensive, should not normally happen)', () => {
    const tree = [cat('dup', 'First'), cat('dup', 'Second')];
    const map = buildCategoryNameMap(tree);
    expect(map.get('dup')).toBe('Second');
  });
});
