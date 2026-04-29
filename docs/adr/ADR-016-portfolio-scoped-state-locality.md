# ADR-016: Portfolio-Scoped State Locality

**Status:** accepted
**Date:** 2026-04-16
**Supersedes:** —

## Context

ADR-015 established URL-scoped multi-portfolio routing: every HTTP request
carries a `/api/p/:portfolioId/*` prefix, middleware resolves the
appropriate DB handle via the `portfolio-db-pool`, and services take that
handle as a parameter. The invariant: *"the active portfolio is determined
by the URL of the request; the backend carries no global 'active' state."*

In practice this invariant was silently violated by
`packages/api/src/services/statement-cache.ts`. It held two module-scope
mutable caches — `statementCache` keyed only by date (30 s TTL) and
`refCache` not keyed at all (60 s TTL). In a multi-tab browser session
with two different portfolios open, the second request within the TTL
window received a byte-identical copy of the first request's response,
regardless of which portfolio it was addressed to.

Reproduced deterministically with Playwright (Demo tab displayed PP's
Total Market Value, cash balance, treemap, and largest position) and
directly at the API layer (`sameBodies: true` when the two endpoints are
called sequentially for different portfolio ids within 30 s).

The root cause is a class of bug, not a single instance: *module-scope
mutable state anywhere in the backend (or frontend) that can accumulate
portfolio-specific data and be read by a subsequent request from another
portfolio*. Any future service that declares `let cache = ...` with the
same intent reintroduces the bug. Preventing the class — not only
patching the instance — is the goal of this ADR.

Empirical grounding:

- Profiling (`curl` against live dev server, four portfolios):
  `getStatementOfAssets` cold 3.9–17.7 ms; warm (cache hit) 1.5–19.1 ms
  (PP2 within measurement noise). The 30 s TTL saved 2–6 ms per call on
  realistic portfolios — below perceptible at the page-render budget.
  Deleting the cache is not a meaningful perf regression.
- A separate suspected leak on the frontend (`_cachedStart`/`_cachedEnd`
  in `packages/web/src/api/use-performance.ts`) was empirically disproved:
  each browser tab runs in its own JavaScript realm, so module-scope state
  is per-tab by browser semantics. Holds only date strings, not portfolio
  data.

## Decision

**Portfolio-scoped state flows only through function parameters and
per-request scopes. No module-scope mutable state may hold portfolio
data.**

### Sanctioned patterns

1. **Function parameters** — services take `sqlite: BetterSqlite3.Database`
   (per-request handle from the pool) as an argument. This is the default.
2. **Per-request memoization** — for the rare "same computation reused
   within one request" case (e.g. a service calling `getStatementOfAssets`
   twice in one handler), attach a `Map` to `req`. No such caller exists
   in-tree at the time of writing; add this pattern if a profiler reveals
   the need.
3. **`PortfolioCache<T>`** — a typed utility class
   (`packages/api/src/helpers/portfolio-cache.ts`) wrapping
   `WeakMap<BetterSqlite3.Database, T>`. Module-scope
   `const cache = new PortfolioCache<Result>()` is **correct**: keyed by
   sqlite-handle identity (the pool returns a distinct handle per
   portfolio), and entries are garbage-collected when a portfolio is
   evicted from the pool and its handle closed. Reserved for hotspots
   that profiling proves need server-side memoization; no in-tree caller
   yet.

### Frontend

- **URL searchParams** — the authoritative source for tab-level UI state
  (e.g. `periodStart`, `periodEnd`).
- **React context scoped to `PortfolioLayout`** — with a
  `useEffect([portfolioId])` reset — when per-portfolio UI state needs
  to persist across in-layout navigation.
- **`sessionStorage` with portfolio-keyed keys** — acceptable for
  tab-local per-portfolio state that survives a refresh but must not
  cross tabs.
- **Not** `localStorage` (shared across tabs) or module-scope `let`
  holding portfolio data.

### Enforcement

- **Custom ESLint rule** `quovibe/no-portfolio-scope-module-state` — see
  `eslint-rules/no-portfolio-scope-module-state.mjs`. Applied to
  `packages/api/src/**` and `packages/web/src/**` (excluding test files).
  Forbids module-scope `let`/`var`, and empty `new Map()/Set()/WeakMap()/
  WeakSet()` at module scope. Legitimate exceptions are whitelisted via
  a preceding line-comment
  `// quovibe:allow-module-state — <justification>`. The rule has 17
  RuleTester unit tests.
- **Integration regression harness**
  `packages/api/src/__tests__/cross-portfolio-isolation.test.ts` — seeds
  two portfolios with distinct data and asserts
  `/reports/statement-of-assets` returns per-portfolio results, not the
  cached body from the other portfolio. Fails on `main` before the fix,
  passes after. Catches any future endpoint that reintroduces the bug
  class by observable outcome — regardless of the underlying mechanism.

## Consequences

- **Positive:** the cross-portfolio data leak is eliminated by
  construction on the two affected paths (statement-of-assets, holdings,
  rebalancing). Future pages cannot silently reintroduce the class —
  ESLint catches module-scope declarations at commit time, the harness
  catches observable leaks at merge time.
- **Positive:** typed `PortfolioCache<T>` + the ESLint whitelist make the
  right way ergonomic and the wrong way impossible. No more ad-hoc
  `let cache = ...` caches in services.
- **Negative / trade-off:** cross-endpoint same-portfolio requests within
  30 s (e.g. reports → rebalancing navigation) recompute
  `getStatementOfAssets` instead of hitting the TTL cache. Profiling
  shows the real cost is 2–6 ms per call; no user-perceivable regression.
- **Accepted technical debt:** no cross-request server-side cache exists
  after this change. If profiling later demonstrates a hotspot,
  re-introduce via `PortfolioCache<T>` (pattern is reserved, no
  re-litigation needed).
- **Supersedes:** the 30 s / 60 s TTL in the deleted
  `services/statement-cache.ts` — not a valid optimization given its
  measured cost and leak risk.

## References

- `packages/api/src/helpers/portfolio-cache.ts` — typed utility.
- `packages/api/src/services/reference-data.ts` — replaces
  `getCachedReferenceData`; pure per-handle read.
- `packages/api/src/__tests__/cross-portfolio-isolation.test.ts` —
  regression harness.
- `eslint-rules/no-portfolio-scope-module-state.mjs` — commit-time
  enforcement.
- ADR-015 — URL-scoped routing and the pool invariant this ADR extends.
