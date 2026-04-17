globs: packages/api/**
---
# API Rules

- Express 5 with native async handlers.
- Every write route (POST/PUT/DELETE) validates input with a Zod schema (from @quovibe/shared). Read routes should validate query params with Zod where feasible.
- Performance routes always accept periodStart and periodEnd as query params.
- Unit conversion in the service layer: shares / 10^8, prices / 10^8, amount / 10^2.
- Tests with Supertest + SQLite :memory:.
- Structured errors: { error: string, details?: object }.
- Every DB write MUST go through a service method. Route handlers NEVER call db.insert/db.update/db.delete directly.
  The governance script enforces this.
- For transaction and account routing rules see `.claude/rules/double-entry.md`.
- For market value and latest_price injection rules see `.claude/rules/latest-price.md`.
- For DB schema conventions see `.claude/rules/db-schema.md`.
- For CSV upload boundary conventions (error codes, multer wrapping, Step-1 sniff) see `.claude/rules/csv-import.md`.

## Portfolio-scoped state (ADR-016)

Portfolio data flows only through function parameters (`sqlite`, `req`) and
per-request scopes. **No module-scope mutable state may hold portfolio
data.** The sanctioned patterns are: function parameters (default), a `Map`
attached to `req` for intra-request memoization, or
`PortfolioCache<T>` (typed `WeakMap<Database, T>` in
`packages/api/src/helpers/portfolio-cache.ts`) for profiling-justified
cross-request caches. Enforced at commit-time by the
`quovibe/no-portfolio-scope-module-state` ESLint rule and at merge-time
by `packages/api/src/__tests__/cross-portfolio-isolation.test.ts`. See
ADR-016 for rationale.
