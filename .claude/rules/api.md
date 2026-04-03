globs: packages/api/**
---
# API Rules

- Express 5 with native async handlers.
- Every write route (POST/PUT/DELETE) validates input with a Zod schema (from @quovibe/shared). Read routes should validate query params with Zod where feasible.
- Performance routes always accept periodStart and periodEnd as query params.
- Unit conversion in the service layer: shares / 10^8, prices / 10^8, amount / 10^2.
- Tests with Supertest + SQLite :memory:.
- Structured errors: { error: string, details?: object }.
- Every DB write MUST go through a service method. Route handlers NEVER call db.insert/db.update/db.delete directly.
  The governance script enforces this.
- For transaction and account routing rules see `.claude/rules/double-entry.md`.
- For market value and latest_price injection rules see `.claude/rules/latest-price.md`.
- For DB schema conventions see `.claude/rules/db-schema.md`.
