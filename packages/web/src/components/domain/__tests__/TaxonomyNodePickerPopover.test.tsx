/**
 * TaxonomyNodePickerPopover unit tests
 *
 * Tests the behavioral contracts of TaxonomyNodePickerPopover via its exported pure helpers:
 *   - flattenCategories: depth-tagging, parentIds chain, ordering
 *   - filterNodes: empty-query passthrough, case-insensitive substring match, no-match
 *   - buildBreadcrumbPath: null on no selection / unknown id, full ancestor path
 *   - highlightMatchSegments: segment splitting for bold-match rendering
 *
 * No @testing-library/react — vitest runs in node env for this package.
 */

import { describe, it, expect } from 'vitest';
import {
  flattenCategories,
  filterNodes,
  buildBreadcrumbPath,
  highlightMatchSegments,
} from '../TaxonomyNodePickerPopover';
import type { TaxonomyTreeCategory } from '@/api/types';

// Sample tree fixture
const fixture: TaxonomyTreeCategory[] = [
  {
    id: 'equity',
    name: 'Equity',
    color: '#8fb4e0',
    parentId: null,
    weight: 6000,
    children: [
      {
        id: 'tech',
        name: 'Tech',
        color: '#8fb4e0',
        parentId: 'equity',
        weight: 4000,
        children: [],
        assignments: [],
      },
      {
        id: 'healthcare',
        name: 'Healthcare',
        color: '#e0a08f',
        parentId: 'equity',
        weight: 2000,
        children: [
          {
            id: 'biotech',
            name: 'Biotech',
            color: '#e0a08f',
            parentId: 'healthcare',
            weight: 1000,
            children: [],
            assignments: [],
          },
        ],
        assignments: [],
      },
    ],
    assignments: [],
  },
  {
    id: 'debt',
    name: 'Debt',
    color: '#a8c478',
    parentId: null,
    weight: 4000,
    children: [],
    assignments: [],
  },
];

describe('flattenCategories', () => {
  it('flattens the tree into depth-tagged nodes', () => {
    const flat = flattenCategories(fixture);
    expect(flat.map((n) => n.name)).toEqual([
      'Equity',
      'Tech',
      'Healthcare',
      'Biotech',
      'Debt',
    ]);
    expect(flat.find((n) => n.id === 'tech')?.depth).toBe(1);
    expect(flat.find((n) => n.id === 'biotech')?.depth).toBe(2);
    expect(flat.find((n) => n.id === 'biotech')?.parentIds).toEqual([
      'equity',
      'healthcare',
    ]);
  });

  it('sets depth=0 and parentIds=[] for root nodes', () => {
    const flat = flattenCategories(fixture);
    const equity = flat.find((n) => n.id === 'equity');
    expect(equity?.depth).toBe(0);
    expect(equity?.parentIds).toEqual([]);
    const debt = flat.find((n) => n.id === 'debt');
    expect(debt?.depth).toBe(0);
    expect(debt?.parentIds).toEqual([]);
  });

  it('sets depth=1 and parentIds=[rootId] for direct children', () => {
    const flat = flattenCategories(fixture);
    const healthcare = flat.find((n) => n.id === 'healthcare');
    expect(healthcare?.depth).toBe(1);
    expect(healthcare?.parentIds).toEqual(['equity']);
  });

  it('preserves color from the source category', () => {
    const flat = flattenCategories(fixture);
    expect(flat.find((n) => n.id === 'equity')?.color).toBe('#8fb4e0');
    expect(flat.find((n) => n.id === 'debt')?.color).toBe('#a8c478');
  });

  it('returns empty array for empty input', () => {
    expect(flattenCategories([])).toEqual([]);
  });
});

describe('filterNodes', () => {
  it('returns all nodes when query is empty', () => {
    const flat = flattenCategories(fixture);
    expect(filterNodes(flat, '').length).toBe(flat.length);
  });

  it('filters to nodes whose name contains the query (case-insensitive)', () => {
    const flat = flattenCategories(fixture);
    expect(filterNodes(flat, 'heal').map((n) => n.id)).toEqual(['healthcare']);
    expect(filterNodes(flat, 'TECH').map((n) => n.id)).toEqual(['tech', 'biotech']);
  });

  it('returns empty when no match', () => {
    const flat = flattenCategories(fixture);
    expect(filterNodes(flat, 'xyz')).toEqual([]);
  });

  it('matches partial substrings', () => {
    const flat = flattenCategories(fixture);
    expect(filterNodes(flat, 'eq').map((n) => n.id)).toEqual(['equity']);
    expect(filterNodes(flat, 'io').map((n) => n.id)).toEqual(['biotech']);
  });
});

describe('buildBreadcrumbPath', () => {
  it('returns null when no selection', () => {
    const flat = flattenCategories(fixture);
    expect(buildBreadcrumbPath(flat, null, new Map(), ' › ')).toBeNull();
  });

  it('returns null when selectedId not in the flat list', () => {
    const flat = flattenCategories(fixture);
    expect(buildBreadcrumbPath(flat, 'ghost', new Map(), ' › ')).toBeNull();
  });

  it('returns a path of ancestor names + self joined by the separator', () => {
    const flat = flattenCategories(fixture);
    const nameLookup = new Map(flat.map((n) => [n.id, n.name]));
    expect(buildBreadcrumbPath(flat, 'biotech', nameLookup, ' › ')).toBe(
      'Equity › Healthcare › Biotech',
    );
    expect(buildBreadcrumbPath(flat, 'tech', nameLookup, ' › ')).toBe('Equity › Tech');
    expect(buildBreadcrumbPath(flat, 'debt', nameLookup, ' › ')).toBe('Debt');
  });

  it('uses the custom separator in the path', () => {
    const flat = flattenCategories(fixture);
    const nameLookup = new Map(flat.map((n) => [n.id, n.name]));
    expect(buildBreadcrumbPath(flat, 'biotech', nameLookup, ' / ')).toBe(
      'Equity / Healthcare / Biotech',
    );
  });

  it('substitutes "?" for ancestor ids missing from the nameLookup', () => {
    const flat = flattenCategories(fixture);
    // Deliberately empty lookup — ancestors are unknown
    expect(buildBreadcrumbPath(flat, 'biotech', new Map(), ' › ')).toBe('? › ? › Biotech');
  });
});

describe('highlightMatchSegments', () => {
  it('returns a single non-highlighted segment when query is empty', () => {
    expect(highlightMatchSegments('Tech', '')).toEqual([
      { text: 'Tech', highlighted: false },
    ]);
  });

  it('returns a single non-highlighted segment when no match', () => {
    expect(highlightMatchSegments('Tech', 'xyz')).toEqual([
      { text: 'Tech', highlighted: false },
    ]);
  });

  it('splits around a leading match', () => {
    expect(highlightMatchSegments('Tech', 'te')).toEqual([
      { text: 'Te', highlighted: true },
      { text: 'ch', highlighted: false },
    ]);
  });

  it('splits around a middle match', () => {
    expect(highlightMatchSegments('Healthcare', 'alt')).toEqual([
      { text: 'He', highlighted: false },
      { text: 'alt', highlighted: true },
      { text: 'hcare', highlighted: false },
    ]);
  });

  it('is case-insensitive', () => {
    expect(highlightMatchSegments('Tech', 'TECH')).toEqual([
      { text: 'Tech', highlighted: true },
    ]);
  });

  it('returns a single highlighted segment when the entire name matches', () => {
    expect(highlightMatchSegments('Equity', 'equity')).toEqual([
      { text: 'Equity', highlighted: true },
    ]);
  });

  it('highlights only the first occurrence of the query', () => {
    // "abab" with query "ab" — only the first "ab" is highlighted
    const segs = highlightMatchSegments('abab', 'ab');
    expect(segs).toEqual([
      { text: 'ab', highlighted: true },
      { text: 'ab', highlighted: false },
    ]);
  });
});
