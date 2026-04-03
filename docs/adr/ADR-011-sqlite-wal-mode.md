# ADR-011: SQLite WAL mode

**Status:** accepted
**Date:** 2026-03-08
**Supersedes:** —

## Context

Without WAL (Write-Ahead Logging), a background price fetch job blocks all API reads. quovibe needs concurrent reads during writes.

## Decision

At DB connection initialization, before any operation:

```
PRAGMA journal_mode = WAL;
PRAGMA synchronous = FULL;
PRAGMA foreign_keys = ON;
```

`FULL synchronous` in WAL mode fsyncs the WAL file after every commit, guaranteeing durability even on OS crash or hard power-off. The performance cost is negligible for a low-write-frequency portfolio tracker.

## Consequences

- **Positive:** Concurrent reads during writes. Background price fetch doesn't block API responses.
- **Negative / trade-off:** WAL files (`.wal`, `.shm`) appear alongside the database. Backup must use `VACUUM INTO`, not `fs.copyFileSync`.

## References

- `packages/api/src/db/open-db.ts`
- `docs/architecture/operations.md`
