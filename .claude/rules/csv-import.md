globs: packages/api/src/routes/csv-import.*,packages/api/src/services/csv/**,packages/shared/src/csv/**,packages/web/src/components/domain/csv-import/**,packages/web/src/api/use-csv-import.*
---
# CSV Import Rules

## Boundary hardening (BUG-46 / BUG-47)

Uploads to `POST /api/p/:pid/csv-import/trades/parse` and
`/api/p/:pid/csv-import/prices/parse` must surface structural failures as
**400 with a machine-readable code**, never 500. The two failure classes are
invalid file shape and oversize payload.

### Server — CsvImportError codes and status mapping

All handled errors flow through `handleError` in
`packages/api/src/routes/csv-import.ts`. Only `CsvImportError` instances reach
the wire; anything else becomes 500 `INTERNAL_ERROR`.

| Code                 | Status | Meaning                                                                 |
|----------------------|--------|-------------------------------------------------------------------------|
| `NO_FILE`            | 400    | Request reached the handler with no `file` field                        |
| `INVALID_FILE_FORMAT`| 400    | Multer fileFilter reject (non-`.csv` extension) or any other multer fault |
| `FILE_TOO_LARGE`     | 400    | Multer `LIMIT_FILE_SIZE` — upload exceeded `UPLOAD_MAX_BYTES` (100 MB)  |
| `INVALID_SECURITIES_ACCOUNT` | 400 | Preview/execute `targetSecuritiesAccountId` does not resolve to an inner `account.uuid` with `type='portfolio'` |
| `NO_REFERENCE_ACCOUNT`| 400   | Portfolio has no linked deposit account                                 |
| `IMPORT_IN_PROGRESS` | 409    | Another import holds the temp-file lock                                 |
| `TEMP_FILE_EXPIRED`  | 410    | Upload's temp file was cleaned up before the wizard finished            |

### Server — Multer wrapping is mandatory

Routes that accept file uploads MUST wrap `upload.single(field)` in the local
`uploadSingle(field)` middleware (or an equivalent per-route handler). The
wrapper catches `multer.MulterError` and fileFilter rejects and routes them
through `handleError` as `CsvImportError`. Calling `upload.single(field)`
directly as middleware drops multer errors into the global Express error
handler, which has no status-code and returns 500 — that is BUG-46 returning.

### Client — validate before POST, gate Next on the sniff

`CsvUploadStep.tsx` is the single boundary for trade uploads. It must:

1. Reject locally before POST when the file extension is not `.csv` or when
   the first 4 KB contain a null byte (binary sniff). The browser's
   `accept=".csv"` attribute is a hint, not a check.
2. Surface server error codes (`INVALID_FILE_FORMAT`, `FILE_TOO_LARGE`,
   `NO_FILE`) inline via the drop-zone Alert — the global MutationCache toast
   alone is not discoverable enough for this step.
3. Run `sniffLikelyTradeCsv(headers, sampleRows, {dateFormat, decimalSeparator,
   thousandSeparator})` from `@quovibe/shared` after each successful parse
   and block the Next button when `ok === false`. The user's escape hatch is
   the format dropdowns (changing them re-evaluates the sniff in render).

### Shared — sniffLikelyTradeCsv contract

`packages/shared/src/csv/csv-sniff.ts` is pure, I/O-free, and the single source
of truth for the Step-1 heuristic. It accepts the parsed headers + sample rows
and returns `{ok, reason}`:

- `SINGLE_COLUMN` — fewer than 2 columns detected (classic "no delimiter" case)
- `NO_SAMPLE_ROWS` — parse yielded zero data rows
- `NO_DATE_COLUMN` — no column parses as a date with ≥ 50 % sample match ratio
- `NO_AMOUNT_COLUMN` — no column parses as a number with ≥ 50 % sample match ratio

This heuristic is intentionally loose — its only job is to stop obviously-wrong
input from reaching column mapping. Tight per-row validation still happens at
Preview time.

### Tests that lock the contract

- `packages/api/src/__tests__/csv-upload-hardening.test.ts` — supertest cases
  for `.exe`, oversize, missing-file, and golden-path.
- `packages/shared/src/csv/csv-sniff.test.ts` — unit cases for each reason
  plus a locale-specific positive case.

Any regression that bypasses `uploadSingle`, rolls back the new error codes,
or removes the client sniff must make one of these suites go red first.
