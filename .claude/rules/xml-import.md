globs: packages/api/src/routes/import.ts,packages/api/src/services/import.service.ts,packages/shared/src/xml/**,packages/web/src/pages/ImportHub.tsx,packages/web/src/api/use-portfolios.ts
---
# XML Import Rules

## Boundary hardening (BUG-09)

Uploads to `POST /api/import/xml` must surface structural failures as
**400 with a machine-readable code**, never 500. Mirrors the CSV surface
(BUG-46) one-for-one; any drift between the two routes is a regression vector.

### Server — ImportError codes and status mapping

All handled errors flow through `handleError` in
`packages/api/src/routes/import.ts`. Only `ImportError` instances reach the
wire; anything else becomes 500 `CONVERSION_FAILED`.

| Code                 | Status | Meaning                                                                          |
|----------------------|--------|----------------------------------------------------------------------------------|
| `NO_FILE`            | 400    | Request reached the handler with no `file` field                                 |
| `INVALID_FILE_FORMAT`| 400    | Multer fileFilter reject (non-`.xml` extension) or any other multer fault        |
| `FILE_TOO_LARGE`     | 400    | Multer `LIMIT_FILE_SIZE` — upload exceeded `UPLOAD_MAX_BYTES` (`IMPORT_MAX_MB`)   |
| `INVALID_XML`        | 400    | `validateXmlFormat` could not read/parse the uploaded file                       |
| `INVALID_FORMAT`     | 400    | XML parsed but root element ≠ `<client>` or no `id` attributes present           |
| `ENCRYPTED_FORMAT`   | 400    | File content does not start with `<` (encrypted export or binary)                |
| `IMPORT_IN_PROGRESS` | 409    | Another import holds the cross-process lock file                                 |
| `CONVERSION_FAILED`  | 500    | ppxml2db subprocess crashed, timed out, or produced no `.db`                     |

### Server — Multer wrapping is mandatory

The XML upload route MUST wrap `upload.single('file')` in the local
`uploadSingle(field)` middleware. The wrapper catches `multer.MulterError` and
fileFilter rejects and routes them through `handleError` as `ImportError`.
Calling `upload.single(field)` directly as middleware drops multer errors into
the global Express error handler, which has no status-code and returns 500 —
that is BUG-09's server leg regressing. The 120-second route timeout middleware
must still wrap `uploadSingle` (ppxml2db caps itself at 110 s internally).

The fileFilter MUST throw `new ImportError('INVALID_FILE_FORMAT', ...)` on a
non-`.xml` extension. The old `new Error('FILE_EXTENSION')` string-message
path has no place here — it can't be discriminated in `handleError` without a
stringly-typed branch, and that branch was the exact shape of BUG-46.

### Client — validate before POST, surface server codes inline

`ImportHub.tsx` is the single boundary for PP XML uploads. It must:

1. Reject locally before POST when the file extension is not `.xml` or when
   the first 4 KB fail `sniffLikelyXml` (null byte → `binary`; no `<` at start
   → `invalidFile`). The browser's `accept=".xml"` attribute is a hint, not a
   check — drag-and-drop, programmatic file setting, and renamed binaries all
   bypass it.
2. Surface server error codes (`INVALID_FILE_FORMAT`, `FILE_TOO_LARGE`,
   `NO_FILE`) inline via an Alert under the drop-zone. Because
   `use-portfolios.ts` throws `new Error(\`${code}: ${details}\`)`, the
   mapper must match with `startsWith`, not equality.
3. Disable Import while `ppUploadError != null`. An accepted filename is not
   a valid filename.

### Shared — sniffLikelyXml contract

`packages/shared/src/xml/xml-sniff.ts` is pure, I/O-free, and the single source
of truth for the client-side heuristic. It accepts a ≤ 4 KB head string and
returns `{ok, reason}`:

- `NOT_TEXT` — a null byte was found in the head (binary masquerading as
  `.xml`).
- `NO_XML_PROLOG_OR_ROOT` — after stripping UTF-8 BOM and leading whitespace,
  the first character is not `<` (plain text, corrupted, or empty file).

The PP-specific structural check (`<client>` root + `id` attributes) is
intentionally NOT duplicated client-side — it lives in `validateXmlFormat` in
`import.service.ts` and is the server's job. Keeping the sniff narrow prevents
the two layers from drifting apart.

### Tests that lock the contract

- `packages/api/src/__tests__/xml-upload-hardening.test.ts` — supertest cases
  for `.exe`, oversize, missing-file, and golden-path (multer boundary cleared).
- `packages/shared/src/xml/xml-sniff.test.ts` — unit cases for each reason
  plus positive cases (BOM, leading whitespace, bare root, full prolog).

Any regression that bypasses `uploadSingle`, rolls back the new error codes,
or removes the client sniff must make one of these suites go red first.
