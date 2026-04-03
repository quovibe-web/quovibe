globs: packages/shared/**
---
# Shared Package Rules

## Purpose
`packages/shared` exports types, enums, Zod schemas, cashflow rules, market calendars, CSV
normalization, and reporting period resolution — consumed by all other packages. It must remain
free of I/O, framework, and runtime dependencies.

## Allowed Dependencies
Only these three packages are permitted in `package.json > dependencies`:
- `zod` — schema validation and shared type inference
- `decimal.js` — financial types and utilities shared with the engine
- `date-fns` — date helpers for the reporting period resolver

Any other dependency requires explicit approval. The governance tests and `pnpm check:arch`
enforce this boundary automatically.

## Rules
- Zero I/O: no `fs`, `path`, `http`, database drivers, or framework imports.
- Explicit types everywhere — never `any`.
- Zod schemas are the single source of truth for validation; derive TypeScript types from them
  (`z.infer<typeof Schema>`), never the other way around. Legacy hand-written interfaces exist
  in `types/` — new types must use `z.infer<>` from schemas.
- Enums must be plain `const` objects or TypeScript `enum` — no runtime framework dependencies.
- Cashflow rules must be pure functions: input data in, result out, no side effects.
- Never import from `@quovibe/api`, `@quovibe/engine`, or `@quovibe/web`.
