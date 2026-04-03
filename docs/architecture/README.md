# quovibe Architecture

> Web-based portfolio management application, optimized for AI-assisted development,
> modern, containerizable, compatible with the SQLite DB produced by `ppxml2db`.

## How to use this directory

Each file is self-contained and independently readable. Read only the file relevant to your current task — do not load them all at once.

## Index

| File | Content | ~Lines |
|------|---------|--------|
| [stack.md](./stack.md) | Technology stack and rationale | 45 |
| [monorepo-structure.md](./monorepo-structure.md) | Directory tree (packages, files) | 330 |
| [table-architecture.md](./table-architecture.md) | Table system overview (DataTable, sort, export, virtualization) | 120 |
| [table-sort-functions.md](./table-sort-functions.md) | Sort function library and column type factories | 80 |
| [table-persistence.md](./table-persistence.md) | Unified table layout persistence schema and API | 70 |
| [transaction-types.md](./transaction-types.md) | 15 transaction types, effects table, cashflow rules | 60 |
| [database-schema.md](./database-schema.md) | Table descriptions, unit conventions, amount hierarchy | 150 |
| [double-entry.md](./double-entry.md) | BUY/SELL pattern, cross-entry, balance calculation | 100 |
| [cashflow-model.md](./cashflow-model.md) | Cashflow levels, fee/tax treatment | 60 |
| [engine-algorithms.md](./engine-algorithms.md) | FIFO, MA, TTWROR, IRR, PurchaseValue, CapGains, Split | 150 |
| [api-routes.md](./api-routes.md) | Endpoint catalog | 120 |
| [api-services.md](./api-services.md) | Anti-N+1, yahoo-finance2, taxonomy, rebalancing | 80 |
| [frontend-pages.md](./frontend-pages.md) | Route map, feature matrix, TransactionForm mapping | 135 |
| [operations.md](./operations.md) | Date handling, Docker, env vars, backup | 130 |
| [implementation-verified.md](./implementation-verified.md) | Implementation verification status and audit trail | — |
| [table-compliance-matrix.md](./table-compliance-matrix.md) | Table compliance matrix (DataTable patterns) | — |

## Cross-reference with `.claude/rules/`

| `.claude/rules/` file | Purpose (imperative) | Architecture file | Purpose (descriptive) |
|------------------------|----------------------|-------------------|-----------------------|
| `api.md` | "Express conventions, service-layer writes" | `api-routes.md` / `api-services.md` | Endpoint catalog, service patterns |
| `double-entry.md` | "NEVER use cross-entry in WHERE; BUY/SELL = 2 rows" | `double-entry.md` | "Here's how BUY creates 2 xact rows" |
| `latest-price.md` | "Inject latest_price with 5 guards; latest wins at period-end" | `database-schema.md` | price vs latest_price table semantics |
| `db-schema.md` | "Singular table names, unit conventions, no schema changes" | `database-schema.md` | Table descriptions and unit hierarchy |
| `engine.md` | "Use decimal.js, zero I/O, three cashflow levels" | `engine-algorithms.md` | "TTWROR formula, IRR convergence strategy" |
| `engine-tests.md` | "Concrete values, no upstream references" | _(tests live in actual test files)_ | — |
| `engine-governance.md` | "Read pp-reference before any engine work" (gitignored — local dev only) | `engine-algorithms.md` | Calculation formulas |
| `frontend.md` | "Use CurrencyDisplay, respect privacy, React Query patterns" | `frontend-pages.md` | Route map, TransactionForm field config |
| `frontend-i18n.md` | "Never hardcode strings; 13 namespaces; add all 8 languages" | _(i18n lives in src/i18n/)_ | — |
| `shared.md` | "Zero I/O, only zod/decimal.js/date-fns" | _(enforced by check:arch A1)_ | — |
| `audit-engine.md` | "Read fixtures + CURRENT-STATE.md before touching regression suite" | `docs/audit/engine-regression/` | Regression session state |
| `audit-read.md` | "Read spec + fixtures before touching read-audit suite" | `docs/audit/read-path/` | Read-path session state |

## ADRs

See [docs/adr/README.md](../adr/README.md) for the full index of Architecture Decision Records.
