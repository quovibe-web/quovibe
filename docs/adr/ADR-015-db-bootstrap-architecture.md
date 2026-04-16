# ADR-015: DB Bootstrap & Portfolio Lifecycle

**Status:** accepted
**Date:** 2026-04-15
**Supersedes:** —
**Companion spec:** `docs/superpowers/specs/2026-04-15-db-bootstrap-architecture-design.md`

## Context

Before this ADR, quovibe's data layer had grown five independent "schema sources" that drifted against each other: the binary `data/schema.db` baseline, the 24 `packages/api/vendor/*.sql` reference files, the Drizzle `schema.ts`, the ad-hoc `applyExtensions()` mutation layer in `verify.ts`, and the inline DDL in `scripts/seed-demo.ts`. Bootstrap copied `schema.db` → `portfolio.db` on first boot; `openDatabase()` then ran a junk drawer of `IF NOT EXISTS` / `try/catch ALTER` mutations on every call, including a destructive `latest_price` rebuild. A `PriceScheduler` worker thread consumed API quota on a cron schedule. A single module-level DB handle meant opening a second browser tab silently started reading/writing whichever portfolio was "active" server-side — correctness bug for any multi-tab usage.

The problem space was also wider than schema hygiene:

- **No way for new users to try the app with sample data** — `scripts/seed-demo.ts` was dev-only.
- **Portfolio = single DB** — no multi-portfolio support, no export/import round-trip.
- **Sidecar held user creative work** (dashboards, chart config) that was logically per-portfolio.
- **Hot-reload + file swap** at import time was fragile (five known failure modes).
- **AlphaVantage / Yahoo** rate quota was silently consumed by a daemon the user never asked for.

## Decision

Ship a coherent multi-portfolio architecture: one self-contained `portfolio-{uuid}.db` per portfolio, URL-scoped routing (`/p/:portfolioId/*` + `/api/p/:portfolioId/*`), a refcounted LRU connection pool resolved per-request by middleware, and a single DDL source of truth (`bootstrap.sql`). No background daemons.

Key decisions, each verifiable in the shipped code:

1. **Single schema source: `packages/api/src/db/bootstrap.sql`.** §1+§2 are verbatim from `packages/api/vendor/ppxml2db_init.py` (baseline 24 tables + indexes) with `IF NOT EXISTS` added to every `CREATE`. §3+§4 are the quovibe-owned `vf_*` tables (`vf_exchange_rate`, `vf_portfolio_meta`, `vf_dashboard`, `vf_chart_config`, `vf_csv_import_config`) plus 6 analytical indexes. `applyBootstrap(db)` (in `packages/api/src/db/apply-bootstrap.ts`) loads the file and `db.exec()`s it on every `openDatabase()` call. Drizzle's `schema.ts` is the ORM view, parity-checked against `bootstrap.sql` by Gate 2.

2. **Per-portfolio DB file; path is derived from `(id, kind)`.** `kind === 'demo'` → `data/portfolio-demo.db`; else → `data/portfolio-{id}.db`. The `dbFile` field is NOT stored in the sidecar — that would reopen a path-traversal attack surface on hand-edited configs. `UUID_V4_RE` (strict RFC 4122 v4, lowercase) is defined **once** in `packages/api/src/config.ts` and imported everywhere a portfolio id is validated.

3. **URL-scoped routing.** `/api/p/:portfolioId/*` (backend) and `/p/:portfolioId/*` (frontend). Every request carries its own portfolio context, so concurrent browser tabs are safe by construction. The sidecar's `defaultPortfolioId` is consulted **only** for the `/` root redirect. `create-app.ts` mounts `portfolioContext` middleware under `/api/p/:portfolioId`; the middleware validates the id, calls `acquirePortfolioDb(id)` from the pool, injects `req.portfolioDb` + `req.portfolioSqlite`, and releases the refcount exactly once on `res.on('finish'|'close')` (guarded).

4. **Refcounted LRU connection pool.** `packages/api/src/services/portfolio-db-pool.ts` caps concurrent handles via `PORTFOLIO_POOL_MAX` (default 5) as a **soft** cap: idle-LRU eviction with `PRAGMA wal_checkpoint(TRUNCATE)` + `closeDb()`; busy handles (`refCount > 0`) are never closed, so the pool may briefly sit above cap while in-flight requests hold handles. Opportunistic trim on each release.

5. **Demo is a portfolio, not a reset button.** `createPortfolio({ source: 'demo' })` copies `DEMO_SOURCE_PATH` (`/app/assets/demo.db` in Docker; repo-relative in dev) → `data/portfolio-demo.db` atomically. The demo portfolio gets a proper UUID like any other. Concurrency is serialized via an in-process **`demo-singleton` mutex** in `portfolio-manager.ts` (a `createLocks` Map keyed `demo-singleton` for demo, `create` for real portfolios): two concurrent "Try Demo" clicks return the same id, with `alreadyExisted: true` on the second. Demo identity is **partially immutable**: rename and delete return `403 DEMO_PORTFOLIO_IMMUTABLE_METADATA`; export is allowed (the exported copy becomes a real portfolio on re-import with a new UUID).

6. **No background daemons.** `PriceScheduler` and `price-worker` are deleted. Prices are fetched on the "Update All Prices" button or — if the user opts in — lazily on first pool-open per portfolio via `app.autoFetchPricesOnFirstOpen`, **default OFF** (`packages/shared/src/schemas/settings.schema.ts:163`). The `PRICE_CRON_SCHEDULE` env is removed.

7. **Sidecar is a thin bootstrap registry.** `data/quovibe.settings.json` carries `schemaVersion: 1` (enforced by `settings.service.ts`), `app.defaultPortfolioId`, `app.autoFetchPricesOnFirstOpen`, `portfolios[]`, user-level `preferences` (language, theme, precisions, `chartStyle` reserved namespace), user-level `reportingPeriods[]` (date-range filter library — applies to any portfolio), and `tableLayouts`. It **no longer** holds dashboards, active-dashboard, or portfolio-level chart content — those moved to per-portfolio `vf_*` tables. Writes go through `atomicSaveSidecar()` (temp + `fsync` + rename).

8. **Portfolio-scoped UI state travels with the `.db` file.** `vf_dashboard` holds the user's dashboards (position-ordered; smallest position = implicit default); `vf_chart_config` holds per-portfolio chart **content** (series refs, visibility toggles, benchmark overlays — **never** user-level aesthetics like line thickness, which are reserved for sidecar `preferences.chartStyle`). Export = download the `.db`. Import = upload the `.db`. No archive format, no manifest.

9. **Server-Sent Events for cross-tab lifecycle.** `GET /api/events` (mounted in `create-app.ts`) broadcasts `portfolio.created` / `portfolio.renamed` / `portfolio.deleted`. Frontend subscribes via `useEventStream()`. Not used for ordinary read/write events — TanStack Query's `refetchOnWindowFocus` covers that.

10. **User-level `/api/settings` exists.** `GET /api/settings` returns `{ preferences, app }`; `PUT /api/settings/preferences` accepts a partial preferences payload. This is the backend for the user-level `/settings` page; portfolio-level settings live under `/api/p/:portfolioId/*` (exposed by the portfolio routes and registry endpoints).

11. **Import ordering invariant (`import-pp-xml`).** `ppxml2db.py` runs **FIRST** against an empty file (vendor DDL lacks `IF NOT EXISTS`), then `applyBootstrap()` runs against the populated file (idempotent fill-in). A load-bearing warning comment at the top of `bootstrap.sql` pins this invariant.

12. **No legacy migration.** Pre-ADR-015 installs (`data/portfolio.db` present, no `portfolios[]` in sidecar) are ignored at boot. The user lands on `/welcome` and picks Import PP XML / Try Demo / Start Fresh.

## Consequences

### Positive

- **Correct multi-tab behavior by construction.** Two browser tabs on different portfolios cannot contaminate each other's data; the URL is authoritative.
- **One DDL truth.** Zero-drift schema: Gate 1 compares `bootstrap.sql` against regenerated `ppxml2db_init.py` output (via `pnpm check:bootstrap`); Gate 2 is a Vitest parity test vs `schema.ts`; Gate 3 asserts `applyBootstrap()` is idempotent against empty, populated, and legacy fixtures.
- **Portfolio round-trip is a file copy.** Each `.db` is self-describing (data + `vf_portfolio_meta` + `vf_dashboard` + `vf_chart_config`). Gate 4 asserts export → import preserves counts across all those tables.
- **No silent API quota drain.** `autoFetchPricesOnFirstOpen` defaults OFF; users opt in from `/settings`.
- **Sidecar is boring.** The durability-sensitive content (dashboards, chart config) moved to per-portfolio DBs; the sidecar is a small, atomic-write index that survives crashes and is rebuildable from disk by scanning `data/portfolio-*.db`.

### Negative / trade-off

- **UUID filenames are not user-facing labels.** Filesystem stability wins; users browsing `data/` see `portfolio-{uuid}.db`, not `portfolio-My-ISA.db`. Export downloads use a friendly `{sanitized-name}-{date}.db`.
- **Pool cap is soft.** Under pathological fan-out, memory may briefly hold a handful of extra 1–2 MB handles; the next release trims opportunistically.
- **SSE requires reverse-proxy configuration.** Default nginx buffers `/api/events`. The release notes and `docs/architecture/operations.md` document the fix (`proxy_buffering off` on that path).

### Accepted technical debt

- **Concurrent-rename race is last-writer-wins.** No `If-Match` ETag on `PATCH /api/portfolios/:id`. Both tabs' SSE subscribers converge on the final name. Tighten later if demand emerges.
- **No audit log for destructive operations.** Delete / rename / import are user-triggered with confirmation dialogs. If multi-seat household installations ever arrive, add a rotating `data/quovibe.audit.log`.
- **No versioned migration runner.** `ALTER TABLE ADD COLUMN IF NOT EXISTS` handles additive changes; only non-additive changes (renames, type changes, drops) would trigger introducing a runner. `bootstrap.sql` + git history is the audit trail until then.

## Implementation entry points

- **Schema:** `packages/api/src/db/bootstrap.sql` (DDL truth), `packages/api/src/db/apply-bootstrap.ts` (`applyBootstrap(db)`), `packages/api/src/db/schema.ts` (Drizzle ORM view), `packages/api/src/db/verify.ts` (kept — `verifySchema`, `verifyColumnTypes`).
- **Pool + middleware:** `packages/api/src/services/portfolio-db-pool.ts` (`acquirePortfolioDb`, `releasePortfolioDb`, `evictIdleOverCap`), `packages/api/src/middleware/portfolio-context.ts` (id validation, refcount guard).
- **Lifecycle:** `packages/api/src/services/portfolio-manager.ts` (`createPortfolio` with `demo-singleton` mutex, `renamePortfolio`, `deletePortfolio`, `exportPortfolio`, `importQuovibeDb`), `packages/api/src/services/portfolio-registry.ts` (sidecar-backed index), `packages/api/src/services/settings.service.ts` (atomic sidecar writes + `schemaVersion` + `fsync`).
- **Routes:** `packages/api/src/routes/portfolios.ts` (registry CRUD + export), `packages/api/src/routes/events.ts` (SSE), `packages/api/src/routes/settings.ts` (`GET /api/settings`, `PUT /api/settings/preferences`, reporting-period endpoints), `packages/api/src/create-app.ts` (mounts).
- **Frontend:** `packages/web/src/router.tsx`, `packages/web/src/layouts/PortfolioLayout.tsx`, `packages/web/src/context/PortfolioContext.tsx`, `packages/web/src/pages/Welcome.tsx`, `packages/web/src/pages/PortfolioSettings.tsx`, `packages/web/src/pages/UserSettings.tsx`, `packages/web/src/components/layout/PortfolioSwitcher.tsx`, `packages/web/src/api/use-scoped-api.ts`, `packages/web/src/api/use-portfolios.ts`, `packages/web/src/api/use-events.ts`.
- **Config:** `packages/api/src/config.ts` (`DATA_DIR`, `SIDECAR_PATH`, `UUID_V4_RE`, `isPortfolioFilename`, `resolvePortfolioPath`, `IMPORT_MAX_MB`, `DEMO_SOURCE_PATH`, `PORTFOLIO_POOL_MAX`).
- **Shared schema:** `packages/shared/src/schemas/settings.schema.ts` (`quovibeSettingsSchema`, `preferencesSchema`, `portfolioEntrySchema`, `UUID_V4_RE`).
- **CI gates:** `packages/api/scripts/check-bootstrap-fresh.sh` + `packages/api/scripts/regen-bootstrap.sh` + `packages/api/scripts/normalize-bootstrap.mjs` (Gate 1); `packages/api/src/db/__tests__/bootstrap-parity.test.ts` (Gate 2); `packages/api/src/db/__tests__/bootstrap-idempotent.test.ts` (Gate 3); `packages/api/src/__tests__/portfolio-roundtrip.test.ts` (Gate 4).
- **Deletions:** `packages/api/src/db/extensions.ts`, `packages/api/src/db/client.ts`, `packages/api/src/workers/price-scheduler.ts`, `packages/api/src/workers/price-worker.ts`, `packages/api/src/workers/` (directory), `data/schema.db`.
- **Retired env vars:** `SCHEMA_PATH`, `PRICE_CRON_SCHEDULE`, `DB_PATH` (module-level constant).
- **New env vars:** `QUOVIBE_DATA_DIR` (default `data/`), `QUOVIBE_DEMO_SOURCE` (default `/app/assets/demo.db`), `PORTFOLIO_POOL_MAX` (default 5), `IMPORT_MAX_MB` (default 50).

## References

- Design spec: `docs/superpowers/specs/2026-04-15-db-bootstrap-architecture-design.md`
- Release notes: `docs/release-notes/2026-04-15-adr-015.md`
- Architecture docs updated: `docs/architecture/database-schema.md`, `docs/architecture/operations.md`
- Supersedes discussion: the April-11 DB-drift audit (plans `2026-04-11-db-drift-01..06`, now retired except `05-shared-types-phantoms`)
- Related ADRs: ADR-011 (WAL), ADR-012 (sidecar), ADR-014 (`vf_*` convention)
