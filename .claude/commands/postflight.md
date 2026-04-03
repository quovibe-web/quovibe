# Postflight Check — Governance 2.0

## Step 1: Automated checks
Run `pnpm postflight`. If ❌, fix them NOW.

## Step 2: CHANGELOG
The postflight automatically generates a draft CHANGELOG entry.
Review the draft, fill in the `[to be filled]` fields, and insert it
in `docs/CHANGELOG-SESSIONS.md` immediately after the `---` line (before the most recent session).

## Step 3: PP Documentation (if engine was touched)
If files in `packages/engine/`: update `docs/pp-verified/implementation-verified.md`

## Step 4: ADR (if architectural decision was made)
Create in `docs/adr/`, update README.

## Step 5: Summary
3-5 lines: done, to do, risks.
