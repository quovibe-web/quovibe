# ADR-002: SQLite as the only database

**Status:** accepted
**Date:** 2026-03-01
**Supersedes:** —

## Context

The original portfolio data is stored as XML. ppxml2db converts it to SQLite. quovibe needs to read and write financial data.

## Decision

Use a single SQLite file as the only database. No database server needed. quovibe reads and writes on the same SQLite file produced by ppxml2db.

## Consequences

- **Positive:** Zero infrastructure. Single file, portable, synchronous API via better-sqlite3.
- **Negative / trade-off:** No concurrent multi-process writes. Single-machine deployment only.

## References

- ppxml2db output format
- `packages/api/src/db/client.ts`
