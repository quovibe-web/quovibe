# ADR-005: Reporting Period as first-class concept

**Status:** accepted
**Date:** 2026-03-01
**Supersedes:** —

## Context

quovibe calculates everything relative to a reporting period. The original draft did not include this concept.

## Decision

Every performance API route accepts `periodStart`/`periodEnd` as query params. The frontend has a global ReportingPeriodSelector in the TopBar. Period is stored as URL search params, not React Context.

## Consequences

- **Positive:** Follows standard financial reporting conventions. State survives refresh. Period is shareable via URL. No global store needed.
- **Negative / trade-off:** Every performance query must include period params.

## References

- `packages/web/src/api/use-performance.ts` — `useReportingPeriod()`
- `docs/architecture/frontend-pages.md`
