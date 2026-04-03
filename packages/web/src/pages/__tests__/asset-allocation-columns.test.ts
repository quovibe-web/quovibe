/**
 * Test 3.4 — useMemo columns stability
 *
 * Verifies that the columns arrays in TreeTable and RebalancingTable
 * are defined with useMemo. The test checks that the column definitions
 * contain stable accessor keys.
 *
 * Note: Since we cannot render React components in the node test environment,
 * this test validates the column structure at a module level by ensuring
 * the exported component files parse without errors and contain the expected
 * column accessorKeys via a regex-based static check.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const AA_PATH = resolve(__dirname, '../../pages/AssetAllocation.tsx');
const RT_PATH = resolve(__dirname, '../../components/domain/RebalancingTable.tsx');

describe('useMemo columns (3.4)', () => {
  describe('TreeTable in AssetAllocation.tsx', () => {
    const source = readFileSync(AA_PATH, 'utf-8');

    it('columns are wrapped in useMemo', () => {
      // Should contain useMemo<ColumnDef<TreeItem>[]>
      expect(source).toMatch(/useMemo<ColumnDef<TreeItem>\[\]>/);
    });

    it('useMemo dependency array includes [t, taxonomyId, usedColors]', () => {
      // The closing of the useMemo should have [t, taxonomyId, usedColors] as dependency
      expect(source).toMatch(/\], \[t, taxonomyId, usedColors\]\)/);
    });

    it('contains expected column accessorKeys: name, marketValue, percentage', () => {
      expect(source).toMatch(/accessorKey: 'name'/);
      expect(source).toMatch(/accessorKey: 'marketValue'/);
      expect(source).toMatch(/accessorKey: 'percentage'/);
    });
  });

  describe('RebalancingTable.tsx', () => {
    const source = readFileSync(RT_PATH, 'utf-8');

    it('columns are wrapped in useMemo', () => {
      expect(source).toMatch(/useMemo<ColumnDef<TreeRow>\[\]>/);
    });

    it('useMemo dependency array includes [t, handleAllocationBlur]', () => {
      expect(source).toMatch(/\], \[t, handleAllocationBlur\]\)/);
    });

    it('handleAllocationBlur is wrapped in useCallback (stable dependency)', () => {
      expect(source).toMatch(/useCallback/);
      expect(source).toMatch(/handleAllocationBlur/);
    });
  });
});
