# ADR-001: Do not expose `_id` (rowid) in Drizzle models for tables with `uuid` PK

**Status:** accepted
**Date:** 2026-03-15
**Supersedes:** —

## Context

ppxml2db uses `_id INTEGER NOT NULL PRIMARY KEY` as the physical PK for the main tables
(`account`, `security`, `xact`, `taxonomy_category`, `attribute_type`). quovibe remaps the
logical Drizzle PK to `uuid TEXT`, which is the key used in all joins and throughout the
application code.

During schema alignment (session 2026-03-15-D), an attempt was made to add `_id` as a
non-PK field in the Drizzle models to document the actual DB structure. The attempt produced
runtime errors during tests:

```
SqliteError: table security has no column named _id
SqliteError: no such column: "_id"
```

**Root cause**: Drizzle ORM includes **all** columns declared in the schema in automatically
generated SELECT queries. Tests use SQLite `:memory:` DBs with explicit DDL that does not
declare `_id`. This divergence is structural: the test DDL reflects the "native quovibe"
creation where `_id` is a silent SQLite rowid, not a declared column.

## Decision

**Do not add `_id` to Drizzle models** for tables that use `uuid` as the logical PK
(`account`, `security`, `xact`, `taxonomy_category`, `attribute_type`).

Reasons:
1. **SQLite rowid is implicit**: every SQLite table has an auto-generated rowid accessible
   as `rowid`, `oid`, or `_rowid_`. It does not need to be explicitly declared in INSERTs.
2. **All code uses `uuid`**: raw SQL, Drizzle queries, and joins use `uuid` as the primary
   identifier. `_id` is never needed in quovibe application code.
3. **Drizzle SELECT is total**: unlike an ORM that allows "annotation-only" fields,
   Drizzle includes every declared column in generated queries. Adding `_id` requires that
   all test tables have that column.
4. **Test DDL must not diverge from semantics**: updating test DDLs to add `_id` would
   introduce complexity without value, since ppxml2db auto-generates it anyway.

## Consequences

- **Positive:**
  - 110 tests continue to pass without changes to DDLs
  - Inferred Drizzle types are correct for the actual code usage
  - No application code needs to be updated

- **Negative / trade-off:**
  - Drizzle models do not fully reflect the physical structure of ppxml2db for these tables
  - If CRUD for `taxonomy_category` is added via Drizzle ORM in the future (e.g., category
    creation via UI), the test DDL will need to include `_id` or use raw SQL for the INSERT

- **Accepted technical debt:**
  - Divergence D1 from the audit (PK remapping) remains documented but unresolved at the
    Drizzle model level. Runtime behaviour is correct thanks to SQLite auto-generation.

## References

- Audit report: section "3. Primary Key Divergences" — `docs/CHANGELOG-SESSIONS.md` session 2026-03-15-D
- ppxml2db vendor SQL: `packages/api/vendor/*.sql` (original definitions with `_id`)
- Drizzle ORM behavior: all declared columns are always included in generated SELECTs
