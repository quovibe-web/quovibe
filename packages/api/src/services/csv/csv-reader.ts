// packages/api/src/services/csv/csv-reader.ts
import fs from 'fs';
import readline from 'readline';
import { detectDelimiter } from '@quovibe/shared';
import type { CsvDelimiter } from '@quovibe/shared';

const BOM = '\uFEFF';

interface ParseOptions {
  delimiter?: CsvDelimiter;
  encoding?: BufferEncoding;
  skipLines?: number;
}

interface ParseResult {
  headers: string[];
  sampleRows: string[][];
  totalRows: number;
  detectedDelimiter: CsvDelimiter;
}

/**
 * Parse a CSV row respecting quoted fields (RFC 4180).
 * Handles embedded delimiters and newlines within quotes.
 * Pass initialInQuotes=true when continuing a multi-line quoted field.
 */
function splitRow(
  line: string,
  delimiter: string,
  initialInQuotes = false,
): { fields: string[]; complete: boolean } {
  const fields: string[] = [];
  let current = '';
  let inQuotes = initialInQuotes;

  for (let i = 0; i < line.length; i++) { // native-ok
    const ch = line[i];

    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') { // native-ok
          current += '"';
          i++; // native-ok
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      fields.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }

  if (inQuotes) {
    // Unterminated quote — field continues on next line
    fields.push(current);
    return { fields, complete: false };
  }

  fields.push(current.trim());
  return { fields, complete: true };
}

/**
 * Parses a CSV file and returns headers, sample rows (up to 10), total row count,
 * and detected delimiter.
 */
export async function parseCsvFile(
  filePath: string,
  opts: ParseOptions,
): Promise<ParseResult> {
  const encoding = opts.encoding ?? 'utf-8';
  const skipLines = opts.skipLines ?? 0; // native-ok

  const stream = fs.createReadStream(filePath, { encoding });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  let lineIndex = 0; // native-ok
  let headers: string[] = [];
  const sampleRows: string[][] = [];
  let totalRows = 0; // native-ok
  let detectedDelimiter: CsvDelimiter = opts.delimiter ?? ',';
  let pendingFields: string[] | null = null;

  for await (let line of rl) {
    // Strip BOM from the very first line
    if (lineIndex === 0 && line.startsWith(BOM)) { // native-ok
      line = line.slice(BOM.length);
    }

    // Skip configured lines
    if (lineIndex < skipLines) { // native-ok
      lineIndex++; // native-ok
      continue;
    }

    // Handle continuation of quoted fields spanning multiple lines
    if (pendingFields !== null) {
      const continuation = splitRow(line, detectedDelimiter, true);
      // Append to the last field (the one that was unterminated)
      pendingFields[pendingFields.length - 1] += '\n' + continuation.fields[0]; // native-ok
      if (continuation.fields.length > 1) { // native-ok
        pendingFields.push(...continuation.fields.slice(1));
      }
      if (continuation.complete) {
        if (headers.length === 0) { // native-ok
          headers = pendingFields;
        } else {
          totalRows++; // native-ok
          if (sampleRows.length < 10) { // native-ok
            sampleRows.push(pendingFields);
          }
        }
        pendingFields = null;
      }
      lineIndex++; // native-ok
      continue;
    }

    // Header line — detect delimiter if not provided
    if (lineIndex === skipLines) { // native-ok
      if (!opts.delimiter) {
        detectedDelimiter = detectDelimiter(line);
      }
    }

    const { fields, complete } = splitRow(line, detectedDelimiter);

    if (!complete) {
      pendingFields = fields;
      lineIndex++; // native-ok
      continue;
    }

    if (headers.length === 0) { // native-ok
      headers = fields;
    } else {
      totalRows++; // native-ok
      if (sampleRows.length < 10) { // native-ok
        sampleRows.push(fields);
      }
    }

    lineIndex++; // native-ok
  }

  return { headers, sampleRows, totalRows, detectedDelimiter };
}

/**
 * Async generator that yields data rows (skipping header) from a CSV file.
 * Used for the full import flow where all rows must be processed.
 */
export async function* parseCsvRows(
  filePath: string,
  opts: ParseOptions & { skipLines: number },
): AsyncGenerator<string[]> {
  const encoding = opts.encoding ?? 'utf-8';
  const delimiter = opts.delimiter ?? ',';

  const stream = fs.createReadStream(filePath, { encoding });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  let lineIndex = 0; // native-ok
  let headerSeen = false;
  let pendingFields: string[] | null = null;

  for await (let line of rl) {
    if (lineIndex === 0 && line.startsWith(BOM)) { // native-ok
      line = line.slice(BOM.length);
    }

    if (lineIndex < opts.skipLines) { // native-ok
      lineIndex++; // native-ok
      continue;
    }

    if (pendingFields !== null) {
      const continuation = splitRow(line, delimiter, true);
      pendingFields[pendingFields.length - 1] += '\n' + continuation.fields[0]; // native-ok
      if (continuation.fields.length > 1) { // native-ok
        pendingFields.push(...continuation.fields.slice(1));
      }
      if (continuation.complete) {
        if (!headerSeen) {
          headerSeen = true;
        } else {
          yield pendingFields;
        }
        pendingFields = null;
      }
      lineIndex++; // native-ok
      continue;
    }

    const { fields, complete } = splitRow(line, delimiter);

    if (!complete) {
      pendingFields = fields;
      lineIndex++; // native-ok
      continue;
    }

    if (!headerSeen) {
      headerSeen = true;
    } else {
      yield fields;
    }

    lineIndex++; // native-ok
  }
}
