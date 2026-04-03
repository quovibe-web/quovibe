# ADR-007: Double-entry for transactions

**Status:** accepted
**Date:** 2026-03-01
**Supersedes:** —

## Context

quovibe uses a double-entry system where BUY/SELL create two xact rows (securities-side + cash-side) linked by xact_cross_entry. This matches the ppxml2db schema structure.

## Decision

Use a double-entry structure. Every BUY/SELL creates 2 xact rows + 1 xact_cross_entry row. Transaction units (xact_unit) store fees, taxes, and forex components.

## Consequences

- **Positive:** Deposit account balance is calculated with a simple `WHERE account = deposit_uuid` query. Full compatibility with ppxml2db data.
- **Negative / trade-off:** Write operations are more complex. Must always create/delete both rows atomically.

## References

- `.claude/rules/api.md`
- `docs/architecture/double-entry.md`
