# ADR-006: All 15 transaction types complete

**Status:** accepted
**Date:** 2026-03-01
**Supersedes:** —

## Context

An MVP could work with fewer transaction types. However, imported data may contain any of the 15 types.

## Decision

Implement all 15 transaction types from day 1 to ensure compatibility with imported data. The form is adaptive and shows/hides fields based on type.

## Consequences

- **Positive:** Full data compatibility. No "unsupported transaction" errors on import.
- **Negative / trade-off:** Higher initial implementation effort.

## References

- `docs/architecture/transaction-types.md`
- `packages/web/src/components/domain/TransactionForm.tsx`
