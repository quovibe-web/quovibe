globs: packages/engine/**/*.test.ts
---
# Rule: engine test conventions

Every public function in `packages/engine/` that implements a financial calculation
MUST have at least one Vitest test that:

1. **Uses concrete numeric values** to verify correctness (ideally from reference documentation)

2. **Describes behavior clearly** in the test name — what the function does, not what external project it matches

3. **NEVER references upstream projects** in test names, comments, or descriptions.
   This is enforced by governance checks.

## Automatic Enforcement (Governance 2.0)

Verified by:
- `scripts/check-governance.ts` → doc↔code consistency, upstream-reference enforcement (checks G2, G3, G6)
- `eslint.config.mjs` → `no-restricted-imports` prevents I/O imports (ADR-003)
- `scripts/check-architecture.ts` → dependency boundaries, import rules (checks A1-A4)

Run by `pnpm preflight` and `pnpm postflight`.
