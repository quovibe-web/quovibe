globs: packages/api/src/routes/import.ts,packages/api/src/services/import.service.ts,packages/shared/src/xml/**,packages/web/src/pages/ImportHub.tsx,packages/web/src/api/use-portfolios.ts
---
# XML Import Rules

## Asynchronous conversion — the upload does NOT carry the outcome

`POST /api/import/xml` responds **202 `{ jobId }`** as soon as the upload has
cleared every check that can be made without running the converter. The
conversion runs detached; the client polls
`GET /api/import/jobs/:jobId` until the job settles.

**Why this shape is load-bearing.** A large PP export (hundreds of securities,
hundreds of thousands of price rows) takes minutes end-to-end: ppxml2db, then
`atomicCopy`, then `applyBootstrap` on the destination DB. Every hop between
browser and process has its own idle-read timeout — a reverse proxy's is
commonly 60 s, Cloudflare's 100 s, and this route's own socket timeout was
120 s. When one of them cuts the connection the server keeps working and
completes the import against a socket nobody reads: the log says
`Import completed. New portfolio created: …` while the user is told the import
failed. Making the request short is the only fix that holds regardless of which
hop is the one that cuts. Do NOT reintroduce a synchronous 201.

### Which layer reports what

| Failure class | Reported by |
|---|---|
| multer (extension, size), `NO_FILE`, `IMPORT_IN_PROGRESS` | POST, with its documented status |
| `validateXmlFormat` — `INVALID_XML`, `ENCRYPTED_FORMAT`, `INVALID_FORMAT` | POST, with its documented status |
| Anything needing the converter — `CONVERSION_FAILED`, the ppxml2db user-input classifier's `INVALID_FORMAT`, `DUPLICATE_NAME` | job body |

The structural validators run inline **before** the 202 on purpose: their codes
are documented 400s on this route and they are cheap. `runImport` therefore
takes `{ skipFormatValidation: true }` from the route so a multi-megabyte export
is not cheerio-parsed twice. A caller that passes that flag without having
validated gets no structural check at all.

### Job contract

`packages/api/src/services/import-job.service.ts` owns an in-process registry.

- `GET /api/import/jobs/:jobId` → **200** for any known job regardless of state;
  the HTTP status describes the poll, not the import. **404 `JOB_NOT_FOUND`**
  when the id is unknown or its 30-minute retention window closed.
- Body: `{ id, state: 'running'|'done'|'error', startedAt, finishedAt, result?, error? }`.
- `result` is the same `{entry, summary}` envelope the 201 used to carry
  (`importResponseSchema`).
- `error` is `{ code, status, details? }`. **`status` is the HTTP status the
  synchronous route would have returned for that code** — that is what lets the
  client rebuild an identical `ApiError` and keeps every downstream code→message
  mapping unchanged. `details` carries sanitized extras only (`maxMb`, the
  colliding `name`, a user-actionable validation string); the BUG-96
  info-disclosure posture applies verbatim, so `CONVERSION_FAILED` never carries
  `details`.
- **Single active job.** The slot is claimed synchronously inside
  `startImportJob`, before the 202 is written, so a second POST in the same tick
  sees `hasActiveImportJob() === true` and gets 409. The file lock in
  `import.service.ts` remains the cross-process guard; the registry is the
  in-process one. Both are checked.

### Socket timeouts on the upload route

The 120 s `req/res.setTimeout` now bounds the **upload only** — it is a transfer
budget, not a conversion budget. The explicit `'timeout'` listeners are
mandatory: Node's `socketOnTimeout` destroys a timed-out socket only when
nothing listens for the event, so listener-less `setTimeout` calls killed
connections with **zero server-side trace**, making a Node-side cut
indistinguishable from a proxy-side one. The route also logs
`res.on('close')` when `!res.writableEnded`. Removing either listener removes
the only evidence a future report can be diagnosed from.

### Client

`awaitImportJob` in `packages/web/src/api/import-job.ts` turns the job back into
the promise `useCreatePortfolio`'s `mutationFn` used to return — including
rethrowing the job's failure as the same `ApiError`. Poll interval 1.5 s,
deadline 30 min (`IMPORT_TIMEOUT`), up to 10 consecutive transport failures
tolerated (the server blocks its event loop while SQLite works, so individual
polls can stall without the import being in trouble). A 404 is terminal — a job
the server forgot cannot be recovered by retrying.

`IMPORT_TIMEOUT` and `JOB_NOT_FOUND` both map to the `importInterrupted` inline
alert in `ImportHub`. Neither means the portfolio was NOT created, so the
message sends the user to check rather than asserting failure.

### Tests that lock this contract

- `packages/api/src/__tests__/xml-import-job.test.ts` — 202 shape, job settles
  to the `{entry, summary}` envelope, 409 on a second upload, structural
  validation still rejecting on the POST, 404 `JOB_NOT_FOUND`, and the
  sanitization posture on the job's error body.
- `packages/web/src/api/__tests__/import-job.test.ts` — poll loop, error
  reconstruction, transient-failure tolerance, 404 short-circuit, deadline.
- `packages/api/src/__tests__/_helpers/poll-import-job.ts` — shared helper the
  pre-existing XML suites use to assert on the settled job.

## Boundary hardening (BUG-09)

Uploads to `POST /api/import/xml` must surface structural failures as
**400 with a machine-readable code**, never 500. Mirrors the CSV surface
(BUG-46) one-for-one; any drift between the two routes is a regression vector.

### Server — ImportError codes and status mapping

All handled errors flow through `handleError` in
`packages/api/src/routes/import.ts`. Only `ImportError` instances reach the
wire; anything else becomes 500 `CONVERSION_FAILED`.

The status column below is the contract for the **code**, not for the POST: the
converter-dependent codes now arrive as the job's `error.status` rather than as
the upload's HTTP status (see "Which layer reports what" above). `toJobFailure`
in `routes/import.ts` mirrors `handleError` exactly so the two stay identical —
any change to one must change the other.

| Code                 | Status | Meaning                                                                          |
|----------------------|--------|----------------------------------------------------------------------------------|
| `NO_FILE`            | 400    | Request reached the handler with no `file` field                                 |
| `INVALID_FILE_FORMAT`| 400    | Multer fileFilter reject (non-`.xml` extension) or any other multer fault        |
| `FILE_TOO_LARGE`     | 400    | Multer `LIMIT_FILE_SIZE` — upload exceeded `UPLOAD_MAX_BYTES` (`IMPORT_MAX_MB`)   |
| `INVALID_XML`        | 400    | `validateXmlFormat` could not read/parse the uploaded file                       |
| `INVALID_FORMAT`     | 400    | XML parsed but root element ≠ `<client>` or no `id` attributes present           |
| `ENCRYPTED_FORMAT`   | 400    | File content does not start with `<` (encrypted export or binary)                |
| `IMPORT_IN_PROGRESS` | 409    | Another import holds the in-process job slot or the cross-process lock file      |
| `JOB_NOT_FOUND`      | 404    | `GET /api/import/jobs/:id` — unknown id, or its retention window closed          |
| `UPLOAD_TIMEOUT`     | 408    | The upload socket sat idle for 120 s; the transfer was abandoned                 |
| `DUPLICATE_NAME`     | 409    | Derived portfolio name collides with an existing registry entry (BUG-92). Raised by `PortfolioManagerError`, not `ImportError`; the route catch-block at `import.ts` maps it symmetrically with `POST /api/portfolios`. Client: `ImportHub` translates via `errors.portfolio.duplicateName`. |
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

### Server — multer filename and no-rename posture (BUG-94)

multer's `filename` uses `${Date.now()}-${uuidv4()}-${file.originalname}`.
The uuid is the collision guard for same-millisecond uploads carrying the
same `originalname` — the repro vector for BUG-94 was a `Promise.all` of
two identical uploads from DevTools console, where `Date.now()` tied and
multer overwrote the first upload with the second. The uuid makes the
saved path structurally unique per request.

The route does NOT rename the saved file to add a `.xml` suffix: multer's
`fileFilter` rejects non-`.xml` uploads, so `req.file.path` already ends
in `.xml` and is a valid argument for ppxml2db. The previous
`req.file.path + '.xml'` rename appended a redundant `.xml` (producing
`.xml.xml`) and opened a race window where request A's `renameSync`
moved the source file before request B's `renameSync` ran — B's rename
then threw `ENOENT: no such file or directory, rename '…-probe.xml' -> '…-probe.xml.xml'`,
which the old handleError fallback serialized verbatim to the wire as
the `error` field. **Never re-introduce this rename.** If a future
change genuinely needs a different extension, it must happen inside
`runImport()` AFTER the wx-flag lock is claimed — never in the route
handler between the multer write and the lock.

### Server — info-disclosure posture (BUG-94 / BUG-96)

Error bodies on `POST /api/import/xml` MUST NOT carry raw server strings
— neither via an `ImportError`'s `details` arg (service-layer vector)
nor via `String(err)` (route-layer vector). Four call sites enforce
this; any regression has to unseat the tests in
`xml-upload-hardening.test.ts`,
`xml-conversion-failed-sanitization.test.ts`, and
`xml-unhandled-error-sanitization.test.ts`:

1. **Service-layer `ImportError` construction**
   (`services/import.service.ts`, ppxml2db catch block): log the full
   `execFileAsync` rejection (`err.message` concatenates stdout+stderr
   from the subprocess, including Python traceback + absolute server
   install path + user home tmpdir + internal SQLite constraint names)
   server-side via `console.error`, then throw
   `new ImportError('CONVERSION_FAILED', 'Error during ppxml2db conversion')`
   **with no third `details` arg**. Any new `CONVERSION_FAILED` throw
   site MUST follow the same shape — no stderr, no stdout, no
   stringified exception in the `details` slot.
2. **`handleError` ImportError branch** (`routes/import.ts`): the
   response body MUST NOT include `details` when
   `err.code === 'CONVERSION_FAILED'`, even if a future service-layer
   regression smuggles one in. Other codes (`INVALID_FORMAT`,
   `ENCRYPTED_FORMAT`, `INVALID_XML`, …) MAY include `details` because
   their messages are English, user-actionable validation strings
   built from cheerio-parsed XML — no filesystem paths, no subprocess
   output.
3. **`handleError` non-`ImportError` fallback** (`routes/import.ts`):
   log the raw error via
   `console.error('[xml-import] unhandled:', err)`, respond with
   `{ error: 'CONVERSION_FAILED' }` only. The previous
   `details: String(err)` was the BUG-94 ENOENT vector.
4. **`uploadXml` outer catch** (`routes/import.ts`): same posture as
   #3. Do NOT re-introduce the
   `process.env.NODE_ENV === 'production' ? 'Internal server error' : String(err)`
   gate — packaged-desktop builds run outside `production` and it was
   effectively a leak.

**Non-goal**: `INVALID_FORMAT` details carry the attacker-supplied root
element name back to the attacker (`validateXmlFormat` interpolates
`${rootName}` into the message). Severity: informational — they already
know their own input. This string is the user's actionable hint and is
covered by BUG-95's inline-Alert contract. Do NOT strip it; doing so
would break the BUG-95 surface.

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
  for `.exe`, oversize, missing-file, and golden-path (multer boundary
  cleared) PLUS the BUG-94 concurrent-uploads regression (exactly one 409
  `IMPORT_IN_PROGRESS`, no path/ENOENT/`.xml.xml` leak in either body).
- `packages/api/src/__tests__/xml-conversion-failed-sanitization.test.ts`
  — `vi.mock('child_process')` forces ppxml2db's execFile to reject with
  a traceback-shaped Error; asserts the settled job's error is exactly
  `{code:'CONVERSION_FAILED', status:500}` with no `details` and no fragments
  of the Python traceback, absolute paths, or internal SQLite error text
  (BUG-96).
- `packages/api/src/__tests__/xml-unhandled-error-sanitization.test.ts`
  — `vi.mock('../services/import.service')` forces `runImport` to throw
  a non-`ImportError` carrying a Windows-style absolute path; asserts
  `toJobFailure`'s catch-all yields a bare
  `{code:'CONVERSION_FAILED', status:500}` with no path leak (BUG-94 class).
- `packages/shared/src/xml/xml-sniff.test.ts` — unit cases for each reason
  plus positive cases (BOM, leading whitespace, bare root, full prolog).

Any regression that bypasses `uploadSingle`, rolls back the new error codes,
re-adds `details` to the `CONVERSION_FAILED` wire body, re-introduces the
rename step, or removes the client sniff must make one of these suites go
red first.

## Server response shape — success

The import's success envelope now arrives as the settled job's `result` (see
"Asynchronous conversion" above); `POST /api/import/xml` itself answers
202 `{ jobId }`. The envelope's shape is unchanged:

```json
{
  "entry": { "id": "...", "name": "...", "kind": "real",
             "source": "import-pp-xml", "createdAt": "...", "lastOpenedAt": null },
  "summary": { "accounts": 2, "securities": 14, "transactions": 847 }
}
```

`summary` is the inferred type of `importSummarySchema` from
`@quovibe/shared`. Counts come from the freshly-bootstrapped portfolio
DB inside `createImportedPpxmlImpl` (see `portfolio-manager.ts >
computeImportSummary`):

- `accounts` — `SELECT COUNT(*) FROM account WHERE type='account'`
  (deposit accounts only; securities-account rows are NOT counted).
- `securities` — `SELECT COUNT(*) FROM security`.
- `transactions` — `SELECT COUNT(*) FROM xact WHERE NOT (type IN
  ('BUY','SELL') AND shares=0)` — excludes the BUY/SELL cash-side row to
  match the user-visible filter (`.claude/rules/double-entry.md`
  "Per-account Query").

The legacy flat shape (`{status, id, name, accounts, securities}`) is
gone. Any new code that re-introduces it must make
`packages/api/src/__tests__/import-response-shape.test.ts` go red first.
