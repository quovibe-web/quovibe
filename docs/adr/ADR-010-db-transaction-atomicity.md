# ADR-010: DB transaction atomicity

**Status:** accepted
**Date:** 2026-03-08
**Supersedes:** —

## Context

Write operations for transactions touch multiple tables (xact, xact_cross_entry, xact_unit). Partial writes leave the database in an inconsistent state.

## Decision

EVERY write operation touching more than one table must be wrapped in `db.transaction()`. If any insert fails, the entire group is rolled back. `better-sqlite3` supports synchronous transactions natively.

Applies to: create, update, delete of every TransactionType, taxonomy operations, and any multi-table write.

## Consequences

- **Positive:** Guaranteed data consistency. No partial writes.
- **Negative / trade-off:** Slightly more verbose service layer code.

## References

- `packages/api/src/services/transaction.service.ts`
- `packages/api/src/services/taxonomy.service.ts`
