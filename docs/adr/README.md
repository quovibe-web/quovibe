# Architecture Decision Records (ADR)

Register of architectural decisions for the quovibe project.

## Process

Every architectural change must be accompanied by a new ADR or by updating an existing one.
If you are working with Claude Code, the ADR should be proposed in the same session in which
the change is proposed.

### ADR Status
- **accepted** — active and respected decision
- **superseded** — replaced by a subsequent ADR (indicate which one)
- **deprecated** — no longer relevant

### Numbering
Incremental. Never renumber existing ADRs.

### Template

Each file follows the naming convention `ADR-NNN-slug.md`:

    # ADR-NNN: Title

    **Status:** accepted
    **Date:** YYYY-MM-DD
    **Supersedes:** —

    ## Context
    Why this decision was necessary.

    ## Decision
    What was decided.

    ## Consequences
    - **Positive:** ...
    - **Negative / trade-off:** ...
    - **Accepted technical debt:** ... (if applicable)

    ## References
    - Architecture docs (if applicable)
    - References to architecture docs or quovibe code

## Index

| # | File | Title | Status | Date |
|---|------|--------|--------|------|
| 001 | [ADR-001-drizzle-id-rowid.md](./ADR-001-drizzle-id-rowid.md) | Do not expose `_id` (rowid) in Drizzle models for tables with `uuid` PK | accepted | 2026-03-15 |
| 002 | [ADR-002-sqlite-only-database.md](./ADR-002-sqlite-only-database.md) | SQLite as the only database | accepted | 2026-03-01 |
| 003 | [ADR-003-pure-engine-no-io.md](./ADR-003-pure-engine-no-io.md) | Pure engine without I/O | accepted | 2026-03-01 |
| 004 | [ADR-004-decimal-js-financial-math.md](./ADR-004-decimal-js-financial-math.md) | decimal.js for financial calculations | accepted | 2026-03-01 |
| 005 | [ADR-005-reporting-period-first-class.md](./ADR-005-reporting-period-first-class.md) | Reporting Period as first-class concept | accepted | 2026-03-01 |
| 006 | [ADR-006-all-15-transaction-types.md](./ADR-006-all-15-transaction-types.md) | All 15 transaction types complete | accepted | 2026-03-01 |
| 007 | [ADR-007-double-entry-transactions.md](./ADR-007-double-entry-transactions.md) | Double-entry for transactions | accepted | 2026-03-01 |
| 008 | [ADR-008-express5-over-hono.md](./ADR-008-express5-over-hono.md) | Express 5 instead of Hono | accepted | 2026-03-01 |
| 009 | [ADR-009-react-router-over-tanstack-router.md](./ADR-009-react-router-over-tanstack-router.md) | React Router v7 instead of TanStack Router | accepted | 2026-03-01 |
| 010 | [ADR-010-db-transaction-atomicity.md](./ADR-010-db-transaction-atomicity.md) | DB transaction atomicity | accepted | 2026-03-08 |
| 011 | [ADR-011-sqlite-wal-mode.md](./ADR-011-sqlite-wal-mode.md) | SQLite WAL mode | accepted | 2026-03-08 |
| 012 | [ADR-012-sidecar-settings-file.md](./ADR-012-sidecar-settings-file.md) | Sidecar settings file for quovibe-only state | accepted | 2026-03-19 |
