# ADR-008: Express 5 instead of Hono

**Status:** accepted
**Date:** 2026-03-01
**Supersedes:** —

## Context

Hono is more modern and lightweight, but Express has orders of magnitude more training data in LLM models.

## Decision

Use Express 5.2 as the backend framework. Express 5 closes the technical gap with native async handlers and better error handling. Supertest allows ergonomic route testing.

## Consequences

- **Positive:** Working code on first attempt in 95%+ of AI-assisted generation. Huge middleware ecosystem.
- **Negative / trade-off:** Slightly heavier than Hono. Less modern API design.

## References

- `packages/api/src/create-app.ts`
