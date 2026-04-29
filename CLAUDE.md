# Quovibe — Claude Code instructions

Lean root memory. Per-package detail lives in `.claude/rules/*.md` (auto-loaded by glob) and `docs/architecture/*.md`. Do not duplicate those here.

## Conventions

- Respond in English. All code, comments, and docs in English.
- When invoking the `simplify` skill, pass `model: "opus"` to every Agent call it spawns.

## IMPORTANT — Reference docs to read first

Read only the file relevant to the package you touch.

| Package / area | Read first |
|---|---|
| `packages/engine` | `docs/architecture/engine-algorithms.md` + `cashflow-model.md` |
| `packages/api` | `api-routes.md` + `api-services.md` |
| `packages/web` | `frontend-pages.md` + `table-architecture.md` |
| `packages/shared` | `transaction-types.md` + `cashflow-model.md` |
| DB / schema | `database-schema.md` + `double-entry.md` |
| DevOps / Docker | `operations.md` |
| Stack details | `stack.md` |
| Monorepo layout | `monorepo-structure.md` |

ADR index: `docs/adr/README.md`. Architecture index: `docs/architecture/README.md`.

**NEVER modify the database schema without explicit permission.** Schema source of truth is `packages/api/src/db/bootstrap.sql` (ADR-015) — see `.claude/rules/db-schema.md`.

## pp-reference lookup (gitignored, business-logic only)

Before writing logic that touches accounts, transactions, cashflows, pricing, performance, valuation, currencies, or transfers:

1. Search `docs/pp-reference/` by keyword — never bulk-load the folder.
2. Topic hints: `account`/`deposit-account`/`security-account`, `transaction`/`taxes`/`fees`/`dividend`, `performance`/`ttwror`/`irr`, `cost-methodology`/`fifo`/`average`, `currency`/`exchange`, `transfer`/`neutral-transfer`.
3. If a rule is not found in pp-reference, ask before inventing behavior.
4. Never mention upstream projects in code, comments, or tests (enforced by G3, G10).

## Load-bearing invariants

- Use `decimal.js` for ALL financial math. Native floats only with `// native-ok` (loop counters, indices).
- Engine (`packages/engine`) has zero I/O. ESLint enforces; ADR-003.
- Explicit types everywhere. No `any`.
- **No module-scope DB handles** (ADR-015). Prepare statements inside the function that receives `sqlite`.
- **No module-scope mutable state holding portfolio data** (ADR-016). Flow via params, `req`, or `PortfolioCache<T>`. Enforced by `quovibe/no-portfolio-scope-module-state` ESLint rule + `cross-portfolio-isolation.test.ts`.
- Every API write goes through a service method — routes never call `db.insert/update/delete` directly (G14).

Per-package detail: `.claude/rules/{api,engine,frontend,shared,db-schema,double-entry,latest-price,csv-import,xml-import,portfolio-creation}.md` — these auto-load by glob.

## Commands

| Command | What it does |
|---|---|
| `pnpm build` | Build all packages |
| `pnpm dev` | Run dev servers (parallel) |
| `pnpm test` | Vitest, all packages |
| `pnpm lint` | ESLint (max 50 warnings) |
| `pnpm lint:engine` | Zero-tolerance engine I/O lint |
| `pnpm check:governance` | 14 governance checks (G1–G14) |
| `pnpm check:arch` | 9 architecture checks (A1–A9; A10 retired in ADR-015) |
| `pnpm check:bootstrap` | Gate 1 — `bootstrap.sql` parity vs ppxml2db |
| `pnpm regen-bootstrap` | Regenerate `bootstrap.sql` §1+§2 from `ppxml2db_init.py` |
| `pnpm check:all` | build + test + lint:engine + governance + arch + bootstrap |
| `pnpm preflight` | Pre-session gate (full check suite) |
| `pnpm postflight` | Post-session gate + changelog draft |
| `pnpm ci` | Full CI pipeline |

## Git flow

- `feature/*` → `development` → `main`. Never commit or push directly to `main` or `development`.
- `main` is public; merges from `development` MUST be **squash merges** — one commit per feature/release.
- Tags (`vX.Y.Z`) on `main` trigger Docker image build + GHCR push via GitHub Actions.
- Squash command: `git checkout main && git merge --squash development && git commit -m "feat: ..."`

## Governance

- 15 glob-scoped rule files in `.claude/rules/` auto-load by context.
- `scripts/check-governance.ts` (G1–G14) and `scripts/check-architecture.ts` (A1–A9) gate doc↔code drift, dependency boundaries, upstream-reference ban, service-layer rules, no direct DB writes in routes.
- `pnpm preflight` before starting work, `pnpm postflight` before closing a session.
