# ADR-003: Pure engine without I/O

**Status:** accepted
**Date:** 2026-03-01
**Supersedes:** —

## Context

The calculation engine needs to implement financial algorithms (FIFO, TTWROR, IRR). Mixing I/O with calculations makes testing harder and creates coupling.

## Decision

The calculation engine (`packages/engine/`) does not access the DB. It receives arrays of transactions and prices, returns results. Zero I/O dependencies.

## Consequences

- **Positive:** Testable in isolation with Vitest. Potentially usable in the browser for previews. Enforced by ESLint `no-restricted-imports` and governance checks.
- **Negative / trade-off:** Service layer must prepare all data before calling the engine.

## References

- `.claude/rules/engine.md`
- `packages/engine/src/`
