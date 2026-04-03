# ADR-012: Sidecar settings file for quovibe-only state

**Status:** accepted
**Date:** 2026-03-19
**Supersedes:** —

## Context

quovibe stores application state (e.g., `lastImport` timestamp) and user preferences (theme, language, privacy mode) alongside financial data in the SQLite database's `property` table. When an XML re-import replaces the entire DB via `reloadApp()`, any quovibe-only data in the old DB is lost. Browser localStorage values are invisible to the backend.

## Decision

Introduce a `quovibe.settings.json` sidecar file in the same `data/` directory as the SQLite database:

- **Separation rule:** "If I re-import the DB tomorrow and this value disappears, does that make sense?" If no, it belongs in the sidecar.
- **Schema:** Zod-validated, versioned (for future migrations). Three sections: `app` (lifecycle state), `preferences` (user display prefs), `reportingPeriods` (custom period definitions).
- **Service layer:** In-memory cache with atomic file writes (`.tmp` → `renameSync`). Falls back to defaults on missing/corrupt file.
- **API integration:** `GET/PUT /api/portfolio` merges DB config + sidecar preferences into a unified response. The frontend doesn't know which backend stores which field.

## Consequences

- quovibe-only state survives DB re-imports and Docker rebuilds (volume-mounted)
- Clear boundary: imported financial data stays in DB, quovibe state goes to sidecar
- No new SQLite tables or schema changes needed
- Simple JSON file is human-readable, editable, and needs no migration tooling
- Single-user architecture means no file locking is needed (Node.js single-threaded)
- New quovibe-only settings must go to the sidecar, never to the `property` table
