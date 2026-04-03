// packages/api/src/services/csv/csv-reader.test.ts
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { parseCsvFile, parseCsvRows } from './csv-reader';

const tmpDir = os.tmpdir();

function writeTmpCsv(name: string, content: string): string {
  const filePath = path.join(tmpDir, `csv-reader-test-${Date.now()}-${name}`);
  fs.writeFileSync(filePath, content, 'utf-8');
  return filePath;
}

describe('parseCsvFile', () => {
  it('parses simple semicolon-delimited CSV', async () => {
    const filePath = writeTmpCsv('simple.csv', 'Date;Price\n2024-01-01;100\n2024-01-02;200\n');
    try {
      const result = await parseCsvFile(filePath, { delimiter: ';' });
      expect(result.headers).toEqual(['Date', 'Price']);
      expect(result.sampleRows).toEqual([
        ['2024-01-01', '100'],
        ['2024-01-02', '200'],
      ]);
      expect(result.totalRows).toBe(2);
      expect(result.detectedDelimiter).toBe(';');
    } finally {
      fs.unlinkSync(filePath);
    }
  });

  it('auto-detects delimiter when not provided', async () => {
    const filePath = writeTmpCsv('auto.csv', 'A,B,C\n1,2,3\n');
    try {
      const result = await parseCsvFile(filePath, {});
      expect(result.detectedDelimiter).toBe(',');
      expect(result.headers).toEqual(['A', 'B', 'C']);
    } finally {
      fs.unlinkSync(filePath);
    }
  });

  it('handles quoted fields with embedded delimiter', async () => {
    const filePath = writeTmpCsv('quoted.csv', 'Name;Value\n"Smith; John";100\n');
    try {
      const result = await parseCsvFile(filePath, { delimiter: ';' });
      expect(result.sampleRows[0]).toEqual(['Smith; John', '100']);
    } finally {
      fs.unlinkSync(filePath);
    }
  });

  it('handles quoted fields with embedded newline', async () => {
    const filePath = writeTmpCsv('newline.csv', 'Name;Note\nAlice;"Line1\nLine2"\n');
    try {
      const result = await parseCsvFile(filePath, { delimiter: ';' });
      expect(result.sampleRows[0]).toEqual(['Alice', 'Line1\nLine2']);
    } finally {
      fs.unlinkSync(filePath);
    }
  });

  it('strips UTF-8 BOM', async () => {
    const bom = '\uFEFF';
    const filePath = writeTmpCsv('bom.csv', `${bom}Date;Price\n2024-01-01;100\n`);
    try {
      const result = await parseCsvFile(filePath, { delimiter: ';' });
      expect(result.headers[0]).toBe('Date');
    } finally {
      fs.unlinkSync(filePath);
    }
  });

  it('skips lines when configured', async () => {
    const filePath = writeTmpCsv('skip.csv', 'Garbage line\nDate;Price\n2024-01-01;100\n');
    try {
      const result = await parseCsvFile(filePath, { delimiter: ';', skipLines: 1 });
      expect(result.headers).toEqual(['Date', 'Price']);
      expect(result.totalRows).toBe(1);
    } finally {
      fs.unlinkSync(filePath);
    }
  });

  it('limits sample rows to 10', async () => {
    const rows = Array.from({ length: 50 }, (_, i) => `2024-01-${String(i + 1).padStart(2, '0')};${i}`).join('\n');
    const filePath = writeTmpCsv('many.csv', `Date;Price\n${rows}\n`);
    try {
      const result = await parseCsvFile(filePath, { delimiter: ';' });
      expect(result.sampleRows.length).toBe(10);
      expect(result.totalRows).toBe(50);
    } finally {
      fs.unlinkSync(filePath);
    }
  });
});

describe('parseCsvRows', () => {
  it('yields all data rows as arrays', async () => {
    const filePath = writeTmpCsv('rows.csv', 'A;B\n1;2\n3;4\n5;6\n');
    try {
      const rows: string[][] = [];
      for await (const row of parseCsvRows(filePath, { delimiter: ';', skipLines: 0 })) {
        rows.push(row);
      }
      // First row is header, rest are data — parseCsvRows skips header
      expect(rows).toEqual([['1', '2'], ['3', '4'], ['5', '6']]);
    } finally {
      fs.unlinkSync(filePath);
    }
  });
});
