# ADR-004: decimal.js for financial calculations

**Status:** accepted
**Date:** 2026-03-01
**Supersedes:** —

## Context

JavaScript has known floating point issues (0.1 + 0.2 ≠ 0.3). Financial calculations require exact precision.

## Decision

Use decimal.js for ALL financial calculations. Never use native JavaScript numbers for amounts or percentages in the engine.

## Consequences

- **Positive:** Arbitrary precision. Eliminates floating point drift in financial calculations.
- **Negative / trade-off:** ~100x slower than native float. For performance-critical loops (TTWROR, IRR), use native float internally and convert to Decimal only for the final result.

## References

- `.claude/rules/engine.md`
- `packages/engine/src/`
