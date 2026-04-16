# Skill Model Overrides

- When invoking the `simplify` skill, always pass `model: "opus"` to every Agent tool call spawned by that skill.

# Language Convention

- The user writes in English — always respond in English.
- All documentation, comments, and file content must be written in English.

# IMPORTANT # Reference Documentation

- Architecture docs are in `docs/architecture/`. Read only the file relevant to your task:

  | Package touched | Read first |
  |----------------|------------|
  | `packages/engine` | `engine-algorithms.md` + `cashflow-model.md` |
  | `packages/api` | `api-routes.md` + `api-services.md` |
  | `packages/web` | `frontend-pages.md` |
  | `packages/shared` | `transaction-types.md` + `cashflow-model.md` |
  | DB/schema work | `database-schema.md` + `double-entry.md` |
  | DevOps/Docker | `operations.md` |

- Before implementing business logic or math, consult the reference docs (gitignored, local dev only). Do not hallucinate formulas.
- NEVER modify the database schema without explicit permission.

## pp-reference Lookup (All Packages)

When modifying **any** business logic — regardless of package — that involves accounts, transactions,
cashflows, pricing, performance, or data structures:

1. **Search first, read surgically:** use keyword search in `docs/pp-reference/` to find the 2-3
   most relevant files. Never bulk-load the folder.
2. **Topic hints:**
   - Account structure / deposit accounts → `account`, `deposit-account`, `security-account`
   - Transactions / fees / taxes / dividends → `transaction`, `taxes`, `fees`, `dividend`
   - Performance / returns → `performance`, `ttwror`, `irr`, `calculation`
   - Valuation / cost basis → `cost-methodology`, `fifo`, `average`, `purchase-value`
   - Currencies → `currency`, `exchange`
   - Transfers → `transfer`, `neutral-transfer`
3. **Zero hallucinations:** if the rule is not found in pp-reference, ask before inventing behavior.
4. **No upstream references:** never mention upstream projects in code, comments, or tests.

## Stack

- TypeScript 5.9 monorepo (pnpm 9 workspaces)
- Backend: Express 5.2 + Drizzle ORM 0.45 + better-sqlite3 12.8
- Frontend: React 19.2 + Vite 8.0 + React Router 7.13 + shadcn/ui + Tailwind 4.2
- Tables: TanStack Table 8.21, State: TanStack Query 5.95, Charts: Recharts 3.8
- Math: decimal.js 10.6 (never native floating point for financial calculations)
- Date: date-fns 4.1
- Test: Vitest 4.1
- Validation: Zod 3.25 (schemas shared front/back)
- i18n: i18next 25.10 + react-i18next 16.6
- Forms: react-hook-form 7.72

## Monorepo Structure

- packages/shared — types, enums, Zod schemas, cashflow rules
- packages/engine — pure financial logic (zero I/O dependencies)
- packages/api — Express 5 REST API + Drizzle ORM
- packages/web — React SPA
- data/ — portfolio.db (SQLite from ppxml2db)

## Commands

- Build: `pnpm build`
- Dev: `pnpm dev`
- Test: `pnpm test`
- Test engine: `pnpm test --filter @quovibe/engine`
- Lint: `pnpm lint`

## Git Flow

- Branch strategy: `feature/*` → `development` → `main` (public, squash-merged)
- Never commit or push directly to `main` or `development`
- `main` is the **public branch**: every merge from `development` must be a **squash merge** — one clean commit per feature/release. This keeps the public history readable and free of internal development noise.
- `development` accumulates feature branches freely; its history does not need to be clean.
- Version tags (e.g. `v1.0.0`) are applied on `main` after the squash merge. Tags trigger the Docker image build and push to GHCR via GitHub Actions.
- Squash merge command: `git checkout main && git merge --squash development && git commit -m "feat: ..."`

## Core Rules

- Financial calculations follow standard formulas (TTWROR, IRR, FIFO, Moving Average)
- Use decimal.js for ALL financial calculations
- The engine (packages/engine) does not access the DB — it receives data and returns results
- Explicit types everywhere, never `any`
- DB schema, unit conventions, and double-entry details: see `.claude/rules/db-schema.md` and `.claude/rules/double-entry.md`

## Quality Checks

| Command | Description |
|---------|-------------|
| `pnpm build` | Build all packages |
| `pnpm test` | Run all tests (Vitest) |
| `pnpm lint` | Lint all packages (max 50 warnings) |
| `pnpm lint:engine` | ESLint zero tolerance: no I/O imports in the engine |
| `pnpm check:governance` | 14 governance checks (doc alignment, upstream ban, service rules, no direct DB writes in routes) |
| `pnpm check:arch` | 9 architecture checks (dependency boundaries, import rules) |
| `pnpm check:all` | test + lint:engine + governance + architecture |
| `pnpm preflight` | Pre-session gate: build → test → lint → governance → arch |
| `pnpm postflight` | Post-session gate: same checks + changelog draft |
| `pnpm ci` | Full CI pipeline: typecheck → lint → governance → arch → vitest |

## Governance

The project uses a 3-tier governance system to prevent drift between documentation and code:

1. **Claude Code rules** (`.claude/rules/*.md`) — 12 rule files scoped by glob pattern, loaded automatically by context. See `docs/architecture/README.md` for the full inventory.
2. **Automated scripts** — `scripts/check-governance.ts` (14 checks: doc↔filesystem alignment, upstream reference ban, service-layer rules, no direct DB writes in routes) and `scripts/check-architecture.ts` (10 checks: dependency whitelists, import boundary enforcement, Zod schema usage). Run via `pnpm check:governance` and `pnpm check:arch`.
3. **Session lifecycle** — `scripts/preflight.sh` must pass before starting work; `scripts/postflight.sh` must pass before closing a session. Both run the full check suite.

ESLint provides an additional enforcement layer for engine I/O isolation (ADR-003): `no-restricted-imports` is set to **error** for all `packages/engine/src/**` files.

Architecture docs index and ADRs: `docs/architecture/README.md` — `docs/adr/README.md`
