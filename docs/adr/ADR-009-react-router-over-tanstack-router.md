# ADR-009: React Router v7 instead of TanStack Router

**Status:** accepted
**Date:** 2026-03-01
**Supersedes:** —

## Context

TanStack Router offers superior type-safety, but has less training data for AI-assisted generation.

## Decision

Use React Router v7. It is the router with the most generation experience for AI models. Speed of AI-assisted development is the decisive factor.

## Consequences

- **Positive:** Fewer generation errors. Stable, well-documented.
- **Negative / trade-off:** Less type-safe than TanStack Router.

## References

- `packages/web/src/router.tsx`
