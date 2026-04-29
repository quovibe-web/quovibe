globs: packages/api/src/services/portfolio-manager.*,packages/api/src/routes/setup.*,packages/api/src/routes/portfolios.*,packages/shared/src/schemas/portfolio.schema.*,packages/web/src/components/domain/portfolio/**,packages/web/src/pages/PortfolioSetupPage.*,packages/web/src/layouts/PortfolioLayout.*
---
# Portfolio Creation & Setup Rules (BUG-54 / BUG-55)

Closes the bug pair where (a) fresh portfolios were created with zero `account`
rows so every downstream flow failed with `INVALID_PORTFOLIO`, and (b) the CSV
import wire field `targetPortfolioId` was typed by the client as the *outer*
metadata UUID but treated by the service as an *inner* `account.uuid`. The
solution rewires the contract end-to-end and seeds at least one securities
account on every usable portfolio.

## Invariants

1. **Every portfolio the user can *use*** (transactions, CSV import, transfers)
   **has N≥1 `type='portfolio'` rows.** The `/p/:portfolioId/setup` redirect
   in `PortfolioLayout.tsx` is the universal safety net; any source that
   lands the user on a dashboard with N=0 is a bug.
2. **The CSV-import wire field is `targetSecuritiesAccountId`** (inner
   `account.uuid`). Anything called `*PortfolioId` strictly refers to the
   outer metadata UUID. Confusing the two is the bug class this rule closes —
   the rename is the architectural guardrail.
3. **All account seeding** — `createFreshImpl`, `setupPortfolio` — **goes
   through `accounts.service.createAccount()`**. `portfolio-manager.ts` never
   INSERTs into `account` directly (per `.claude/rules/api.md`).
4. **Order at seeding:** primary deposit → extra deposits → securities account
   (with `referenceAccount` → primary deposit's UUID). The securities row's
   FK requires the primary deposit to exist first.
5. **Atomic seeding.** `seedFreshAccounts` runs all inserts inside a single
   `db.transaction(() => {…})()`. A `DUPLICATE_NAME` mid-seed rolls back the
   whole batch — the portfolio is left in the state it was in pre-call.

## Source matrix

| `CreatePortfolioSource` | N securities accounts after creation | Notes |
|---|---|---|
| `fresh` | 1 + N≥0 user-supplied extras | Seeded by `createFreshImpl` from the M3 dialog payload. Registry-name guard runs (409 `DUPLICATE_NAME` on collision with any real or demo entry). |
| `demo` | 2 (Interactive Brokers + Scalable Capital) | Comes from the seeded `data/demo.db` template. Unchanged. |
| `import-pp-xml` | N≥1 from PP's wizard | PP enforces the N≥1 invariant. **Registry-name guard runs (BUG-92): a re-import whose derived name collides with any existing entry returns 409 `DUPLICATE_NAME`, and the ImportHub dialog lets the user rename and retry.** |
| `import-quovibe-db` | N from the source DB (N=0 possible for backups taken pre-fix) | `PortfolioLayout` setup-redirect catches the N=0 case. Registry-name guard is **intentionally bypassed**: restoring a backup over an existing same-named portfolio is a legitimate overwrite flow. |

`demo` is not touched by the BUG-54 fix. `import-pp-xml` gained the
registry-name guard under BUG-92 (see `createImportedPpxmlImpl` comment) so the
UX matches fresh/rename; `.db` restore keeps the bypass.

## Duplicate-name invariant (BUG-05 / BUG-102 / BUG-92)

`assertUniquePortfolioName` in `portfolio-manager.ts` is the single source of
truth for registry-name uniqueness. Invoked by `createFreshImpl`,
`renamePortfolio`, and `createImportedPpxmlImpl`. Comparison is trimmed +
case-insensitive and runs against **all** entries (real and demo) — two rows
rendering as the same label in the switcher are indistinguishable regardless
of `kind`. `selfId` lets `renamePortfolio` skip its own entry so a same-name
PATCH is a no-op 200 instead of a self-collision 409. Client surfaces of the
409 translate the raw `DUPLICATE_NAME` code via `errors.portfolio.duplicateName`
(BUG-70); see `NewPortfolioDialog`, `RenamePortfolioDialog`, `ImportHub`.

## Server — schemas, services, routes

### Shared schemas (`packages/shared/src/schemas/portfolio.schema.ts`)

- `createPortfolioSchema` — `z.discriminatedUnion('source', […])` with three
  *strict* branches: `fresh` (M3 payload), `demo`, `import-quovibe-db`. The
  PP-XML branch is server-only (it flows through `/api/import/xml`, not this
  wire schema).
- `setupPortfolioSchema` — same shape as the fresh branch minus `source` and
  `name`. `.strict()`. Drives `POST /api/p/:pid/setup`.
- Inferred types: `CreatePortfolioInput`, `SetupPortfolioInput`,
  `FreshPortfolioInput` (extracted via `Extract<…, { source: 'fresh' }>`).

The server-internal `CreatePortfolioInput` type in
`packages/api/src/services/portfolio-manager.ts` is intentionally a SUPERSET
of the wire schema (adds `import-pp-xml`). Both files document the
divergence at the point of declaration; do not converge them.

### Services (`packages/api/src/services/`)

- `accounts.service.listSecuritiesAccounts(sqlite)` — returns rows where
  `type='portfolio' AND isRetired=0`, ordered by `_order`. Drives the CSV
  picker, the `PortfolioLayout` redirect, and `setupPortfolio`'s ALREADY_SETUP
  guard.
- `portfolio-manager.createFreshImpl(input: FreshPortfolioInput)` — applies
  bootstrap, seeds meta + dashboard, then runs the file-local
  `seedFreshAccounts(db, input)` transactional helper.
- `portfolio-manager.setupPortfolio(id, input: Omit<FreshPortfolioInput, 'name'>)` —
  guards against `PORTFOLIO_NOT_FOUND` and `ALREADY_SETUP`, then reuses
  `seedFreshAccounts` with `{ name: entry.name, ...input }`. Lets
  `AccountServiceError('DUPLICATE_NAME')` propagate unchanged so the route
  layer can map it.

**TOCTOU invariant** — the `listSecuritiesAccounts` → `seedFreshAccounts`
sequence in `setupPortfolio` is atomic only because the entire call graph
is synchronous. Inline comment in `portfolio-manager.ts` pins this; if any
link becomes async, move the read inside the transaction.

### Routes

| Route | Schema | Calls | Notes |
|---|---|---|---|
| `POST /api/portfolios` (json body) | `createPortfolioSchema` | `createPortfolio(parsed.data)` | The fresh branch passes `parsed.data` straight through — type-narrowed by the discriminated union. |
| `POST /api/portfolios` (multipart) | (file-handling, unchanged) | `createPortfolio({source:'import-quovibe-db', uploadedDbPath})` | `name: ''` hack removed. |
| `GET /api/p/:pid/securities-accounts` | none | `listSecuritiesAccounts(sqlite)` | Inherits `portfolioContext` middleware (404 on unknown portfolio). |
| `POST /api/p/:pid/setup` | `setupPortfolioSchema` | `setupPortfolio(pid, parsed.data)` | New. |

Both `setup.ts` routes mount at `/api/p/:portfolioId` (not under a sub-prefix)
because they are portfolio-level. Keep new handlers in `setup.ts` scoped to
`/securities-accounts` and `/setup` so they never shadow a sibling router.

### Error codes

| Code | Status | Raised by |
|---|---|---|
| `INVALID_INPUT` | 400 | Zod failure on create or setup payload |
| `INVALID_SECURITIES_ACCOUNT` | 400 | CSV routes when `targetSecuritiesAccountId` doesn't resolve to a `type='portfolio'` row |
| `ALREADY_SETUP` | 409 | `POST /api/p/:pid/setup` when N≥1 |
| `DUPLICATE_NAME` | 409 | Portfolio name guard (registry) OR account name guard (`accounts.service.assertUniqueAccountName` invoked during seeding) |
| `PORTFOLIO_NOT_FOUND` | 404 | Setup route when the registry has no entry |

**Symmetric handling**: both `routes/portfolios.ts` (`postCreate`) and
`routes/setup.ts` (`postSetup`) catch `AccountServiceError('DUPLICATE_NAME')`
and map to 409. Both routes call `seedFreshAccounts` (directly or via
`setupPortfolio`), both can throw the same error class, so the mapping is
duplicated rather than extracted (only two call sites; the surrounding
catch-clause shapes differ).

## Client — flow + components

### Welcome → NewPortfolioDialog

`Welcome.tsx`'s "Start fresh" `ActionCard` opens
`NewPortfolioDialog.tsx`. The dialog hosts the portfolio *name* field above
`PortfolioSetupForm` (the form deliberately excludes `name` so the same
component can drive the setup-page flow). On submit, the dialog composes
`{ source: 'fresh', name, ...setupInput }` and posts via `useCreatePortfolio`.

### PortfolioLayout N=0 redirect

`PortfolioLayout.tsx` fetches `useSecuritiesAccounts(portfolioId)` alongside
the registry. When `data.length === 0`, it redirects to
`/p/:portfolioId/setup` preserving `location.search` via `appendSearch`
(`.claude/rules/frontend.md` redirect-with-search rule).

### `/p/:portfolioId/setup` route

`PortfolioSetupPage` is a SIBLING route of `/p/:portfolioId` in `router.tsx`
— NOT a child of `PortfolioLayout`. Sibling placement is mandatory: nesting
under `PortfolioLayout` would infinite-loop the N=0 redirect. The page
reuses `WelcomeBackground` + `WelcomeTopBar` for chrome (no Shell, no
sidebar), reads portfolio metadata from the registry (no `PortfolioContext`
dependency), and renders `PortfolioSetupForm` with `submitLabel =
t('submit.finishSetup')`. Self-guards on N≥1 by navigating to the dashboard.

### CSV wizard inner-securities-account picker

`CsvSecurityMatchStep.tsx` resolves the inner UUID before invoking preview:

- N=0 → `navigate('/p/:id/setup')` (defence in depth — `PortfolioLayout`
  catches this first under normal flow).
- N=1 → auto-pick + fire preview.
- N>1 → render shadcn `Select` picker; gate Next + the preview re-fire until
  the user selects.

`WizardState` carries `targetSecuritiesAccountId: string | null` populated
here and read by `CsvPreviewStep` on execute.

### Pure helpers (`portfolio-setup-form.utils.ts`)

The form's invariants are extracted as pure functions so they're testable
under the web package's node-env vitest setup (no DOM testing library —
project convention; rendered behaviour is covered by Playwright):

- `findDuplicateDepositNames(names)` — case-insensitive duplicate detector.
- `buildSetupInput(formValues)` — form-state → wire-payload normalizer.

## Tests that lock the contract

- `packages/api/src/__tests__/csv-upload-hardening.test.ts` — BUG-55
  regression: passing the outer metadata UUID as `targetSecuritiesAccountId`
  must produce 400 `INVALID_SECURITIES_ACCOUNT`.
- `packages/api/src/__tests__/portfolio-fresh-seeding.test.ts` — minimal +
  multi-deposit seeding, `referenceAccount` wiring assertion.
- `packages/api/src/__tests__/setup-endpoint.test.ts` — supertest 200 / 409
  ALREADY_SETUP / 400 INVALID_INPUT / 409 DUPLICATE_NAME (with rollback
  assertion).
- `packages/api/src/__tests__/securities-accounts-endpoint.test.ts` — N=1
  freshly-seeded shape + N=2 ordering + 404.
- `packages/api/src/__tests__/accounts-list-securities.test.ts` — type filter
  + retired filter unit tests.
- `packages/api/src/services/__tests__/portfolio-manager.test.ts` —
  `setupPortfolio` unit cases including the `AccountServiceError` class
  identity assertion that locks the route's `instanceof` dispatch.
- `packages/shared/src/__tests__/portfolio.schema.test.ts` — strict-mode
  rejection cases for both schemas.
- `packages/web/src/components/domain/portfolio/__tests__/portfolio-setup-form.utils.test.ts` —
  pure-helper coverage for the duplicate-name detector + form-state
  normalizer.
- Phase 7 Playwright scenarios in `.playwright-mcp/` cover the rendered
  end-to-end flows (fresh basic + advanced; legacy N=0 redirect; CSV on N=2
  Demo; CSV on N=1 fresh).

Any regression that re-introduces the wire-name conflation, lets a usable
portfolio reach N=0, or bypasses the `accounts.service.createAccount`
seeding rule must make one of these suites go red first.
