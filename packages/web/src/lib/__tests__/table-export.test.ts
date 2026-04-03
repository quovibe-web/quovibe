import { describe, it, expect } from 'vitest';
import { buildCsvContent } from '../table-export';
import type { Table } from '@tanstack/react-table';

// ---------------------------------------------------------------------------
// Mock table factory — no DOM, no hooks, just the Table interface shape
// ---------------------------------------------------------------------------

interface TestRow {
  name: string;
  amount: number | null;
  date: string | null;
  active: boolean;
  notes: string | null;
}

const testData: TestRow[] = [
  { name: 'Alpha', amount: 1234.56, date: '2026-01-15', active: true, notes: 'First entry' },
  { name: 'Beta', amount: -789.01, date: '2026-02-20', active: false, notes: null },
  { name: 'Gamma', amount: null, date: null, active: true, notes: 'Has, comma' },
  { name: 'Delta', amount: 0, date: '2026-03-10', active: false, notes: 'Has "quotes"' },
  { name: 'Epsilon', amount: 999999.99, date: '2026-03-28', active: true, notes: 'Line\nbreak' },
];

type ColumnSpec = {
  id: string;
  header: string;
  locked?: boolean;
  getValue: (row: TestRow) => unknown;
};

const allColumnSpecs: ColumnSpec[] = [
  { id: 'name', header: 'Name', getValue: (r) => r.name },
  { id: 'amount', header: 'Amount', getValue: (r) => r.amount },
  { id: 'date', header: 'Date', getValue: (r) => r.date },
  { id: 'active', header: 'Active', getValue: (r) => r.active },
  { id: 'notes', header: 'Notes', getValue: (r) => r.notes },
  { id: 'actions', header: '', locked: true, getValue: () => null },
];

function createMockTable(opts?: {
  hiddenColumns?: string[];
  sortedData?: TestRow[];
  columnOrder?: string[];
}): Table<TestRow> {
  const hidden = new Set(opts?.hiddenColumns ?? []);
  const data = opts?.sortedData ?? testData;
  const order = opts?.columnOrder;

  let specs = allColumnSpecs.filter((c) => !hidden.has(c.id));

  // Reorder if custom order specified
  if (order) {
    const ordered: ColumnSpec[] = [];
    for (const id of order) {
      const spec = specs.find((s) => s.id === id);
      if (spec) ordered.push(spec);
    }
    // Add any specs not in the order at the end
    for (const spec of specs) {
      if (!ordered.includes(spec)) ordered.push(spec);
    }
    specs = ordered;
  }

  const visibleColumns = specs.map((spec) => ({
    id: spec.id,
    columnDef: {
      header: spec.header,
      meta: spec.locked ? { locked: true } : undefined,
    },
  }));

  const rows = data.map((row, idx) => ({
    id: String(idx),
    original: row,
    getValue: (colId: string) => {
      const spec = allColumnSpecs.find((c) => c.id === colId);
      return spec ? spec.getValue(row) : undefined;
    },
  }));

  return {
    getVisibleLeafColumns: () => visibleColumns,
    getSortedRowModel: () => ({ rows, flatRows: rows, rowsById: {} }),
  } as unknown as Table<TestRow>;
}

/** Parse CSV content: skip BOM, split on CRLF */
function parseLines(csv: string): string[] {
  return csv.slice(1).split('\r\n'); // skip BOM
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildCsvContent', () => {
  it('exports basic table with 5 data columns and 5 rows', () => {
    const csv = buildCsvContent(createMockTable())!;
    const lines = parseLines(csv);

    expect(lines).toHaveLength(6); // header + 5 rows
    expect(lines[0]).toBe('Name,Amount,Date,Active,Notes');
    expect(lines[1]).toBe('Alpha,1234.56,2026-01-15,true,First entry');
    expect(lines[2]).toBe('Beta,-789.01,2026-02-20,false,');
  });

  it('excludes locked/action columns', () => {
    const csv = buildCsvContent(createMockTable())!;
    const headers = parseLines(csv)[0].split(',');

    expect(headers).not.toContain('actions');
    expect(headers).not.toContain('');
    expect(headers).toHaveLength(5);
  });

  it('respects column visibility (hidden columns excluded)', () => {
    const csv = buildCsvContent(createMockTable({ hiddenColumns: ['amount', 'active'] }))!;
    const headers = parseLines(csv)[0].split(',');

    expect(headers).toEqual(['Name', 'Date', 'Notes']);
  });

  it('respects column order', () => {
    const csv = buildCsvContent(createMockTable({
      columnOrder: ['date', 'name', 'notes', 'amount', 'active', 'actions'],
    }))!;
    const headers = parseLines(csv)[0].split(',');

    expect(headers).toEqual(['Date', 'Name', 'Notes', 'Amount', 'Active']);
  });

  it('handles null/undefined values as empty strings', () => {
    const csv = buildCsvContent(createMockTable())!;
    const lines = parseLines(csv);
    // Row 3 (Gamma): amount=null, date=null → empty
    expect(lines[3]).toBe('Gamma,,,true,"Has, comma"');
  });

  it('escapes commas in values with double-quotes', () => {
    const csv = buildCsvContent(createMockTable())!;
    const lines = parseLines(csv);
    expect(lines[3]).toContain('"Has, comma"');
  });

  it('escapes double-quotes by doubling them', () => {
    const csv = buildCsvContent(createMockTable())!;
    const lines = parseLines(csv);
    expect(lines[4]).toContain('"Has ""quotes"""');
  });

  it('has UTF-8 BOM as first character', () => {
    const csv = buildCsvContent(createMockTable())!;
    expect(csv.charCodeAt(0)).toBe(0xFEFF);
  });

  it('respects current sort order (pre-sorted data)', () => {
    const sortedData = [testData[4], testData[0], testData[3], testData[1], testData[2]];
    const csv = buildCsvContent(createMockTable({ sortedData }))!;
    const lines = parseLines(csv);

    expect(lines[1]).toContain('Epsilon');
    expect(lines[2]).toContain('Alpha');
    expect(lines[3]).toContain('Delta');
    expect(lines[4]).toContain('Beta');
    expect(lines[5]).toContain('Gamma');
  });

  it('formats zero correctly (not empty)', () => {
    const csv = buildCsvContent(createMockTable())!;
    const lines = parseLines(csv);
    // Row 4 (Delta): amount=0
    expect(lines[4]).toContain(',0,');
  });

  it('returns null when no visible non-locked columns', () => {
    const result = buildCsvContent(createMockTable({
      hiddenColumns: ['name', 'amount', 'date', 'active', 'notes'],
    }));
    expect(result).toBeNull();
  });

  it('uses CRLF line endings', () => {
    const csv = buildCsvContent(createMockTable())!;
    // Every line ending should be \r\n
    const withoutBom = csv.slice(1);
    expect(withoutBom).toContain('\r\n');
    expect(withoutBom.split('\r\n').length).toBeGreaterThan(1);
  });
});
