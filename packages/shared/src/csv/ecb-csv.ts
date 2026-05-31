// ECB eurofxref-hist.csv parser. Pure, I/O-free.
// Format: header "Date,USD,JPY,GBP,..." (base = EUR implicit).
// Rows: "2026-01-02,1.0345,162.91,0.8612,"
// Trailing comma is part of ECB's published format; treat as no-op.

export class EcbCsvError extends Error {
  constructor(public readonly code: string, message?: string) {
    super(message ?? code);
    this.name = 'EcbCsvError';
  }
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface EcbRateRow {
  date: string;
  from: string;
  to: string;
  rate: string;
}

export function parseEcbCsv(csv: string): EcbRateRow[] {
  const lines = csv.trim().split(/\r?\n/);
  if (lines.length < 2) throw new EcbCsvError('EMPTY_CSV');

  const header = lines[0].split(',').map((c) => c.trim());
  if (header[0] !== 'Date') throw new EcbCsvError('MISSING_DATE_COLUMN');

  const currencies = header.slice(1).filter((c) => c.length > 0);
  const rows: EcbRateRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(',').map((c) => c.trim());
    const date = cells[0];
    if (!date) continue;
    if (!ISO_DATE.test(date)) throw new EcbCsvError('INVALID_DATE_FORMAT', `bad date "${date}"`);

    for (let j = 0; j < currencies.length; j++) {
      const cell = cells[j + 1]; // native-ok
      if (!cell || cell === '' || cell === 'N/A') continue;
      const rate = Number(cell);
      if (!Number.isFinite(rate) || rate <= 0) continue;
      rows.push({
        date,
        from: 'EUR',
        to: currencies[j], // native-ok
        rate: cell,
      });
    }
  }

  return rows;
}
