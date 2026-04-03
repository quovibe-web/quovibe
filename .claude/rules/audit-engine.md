globs: packages/engine/src/__tests__/regression/**
---
# Calculation Regression — Session Protocol

MANDATORY: Before doing ANYTHING, read:
  docs/audit/engine-regression/CURRENT-STATE.md
  docs/audit/fixtures/                  ← write-audit fixtures (source of truth)
  docs/audit/read-path/CURRENT-STATE.md ← read-audit findings (already verified)
  packages/engine/src/                  ← pure engine, no I/O

The regression suite pins every formula output to the real migrated DB fixture data.
Any future engine refactor that drifts from PP breaks these tests immediately.