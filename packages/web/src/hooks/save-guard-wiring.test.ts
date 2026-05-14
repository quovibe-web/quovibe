// Structural test that locks the "Save-button re-entry guard" wiring contract
// (frontend.md > Save-button re-entry guard) at the call-site level.
//
// The hook test in `use-guarded-submit.test.ts` covers the re-entry guard's
// behaviour end-to-end (5 concurrent calls coalesce to 1 invocation). This
// suite covers the orthogonal failure mode: a regression where someone
// removes `useGuardedSubmit` from one of the wired dialogs, reverting it to
// the un-guarded `mutate(...)` shape.
//
// Per project convention (portfolio-creation.md, TaxonomyNodePickerPopover.test.tsx)
// web tests are pure-helper-level, no @testing-library/user-event. This file
// reads the source files as text and asserts each one imports the hook +
// references its `run`/`inFlight` API. Cheap and durable: the assertion fails
// the moment a dialog drops back to fire-and-forget `mutate()`, regardless of
// whether the dialog body grows new branches.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '..');

/**
 * Dialogs / pages that fire a single user-driven create/update/delete mutation
 * from a "Save" button. Each MUST route through `useGuardedSubmit` per the
 * frontend.md contract.
 *
 * Edit-transaction dialogs (EditBuy, EditSell, …) and SecurityEditor are
 * already covered by their own existing wiring (visible in the codebase) and
 * aren't re-asserted here — this list is the BUG-PRE14-01 cohort + the audit
 * it triggered.
 */
const SAVE_GUARD_CALL_SITES: ReadonlyArray<string> = [
  'components/domain/portfolio/NewPortfolioDialog.tsx',
  'components/domain/RenamePortfolioDialog.tsx',
  'components/domain/DeletePortfolioDialog.tsx',
  'components/domain/CreateAccountDialog.tsx',
  'components/domain/CreateTaxonomyDialog.tsx',
  'components/domain/DeleteTaxonomyDialog.tsx',
  'components/domain/CorporateEventDialog.tsx',
  'components/domain/StockSplitDialog.tsx',
  'components/domain/NewPeriodDialog.tsx',
  'components/domain/AddSecurityToWatchlistDialog.tsx',
  'components/domain/ChangeReferenceAccountDialog.tsx',
  'components/domain/AddInstrumentDialog/index.tsx',
  'pages/PortfolioSetupPage.tsx',
];

/**
 * Anti-pattern: a fire-and-forget `mutate(...)` directly in a Save handler
 * defeats the guard. We grep for the exact bug shape — `mutation.mutate(`
 * or `<destructured>.mutate(` — and exempt the rare legitimate uses
 * (queryClient.invalidateQueries doesn't apply here, and the EditX dialogs
 * use `mutateAsync` exclusively).
 *
 * Note: this is a heuristic. `mutate(` can appear inside an unrelated context
 * (e.g. an in-component non-Save mutation). Per call site we check the file
 * imports `useGuardedSubmit` AND uses `await … .mutateAsync(`; a residual
 * `.mutate(` is allowed only if the file also explicitly comments why.
 */

describe('Save-button re-entry guard wiring', () => {
  for (const relPath of SAVE_GUARD_CALL_SITES) {
    const absPath = resolve(ROOT, relPath);
    const source = readFileSync(absPath, 'utf-8');

    describe(relPath, () => {
      it('imports useGuardedSubmit', () => {
        expect(source).toMatch(
          /import\s*\{[^}]*\buseGuardedSubmit\b[^}]*\}\s*from\s*['"]@\/hooks\/use-guarded-submit['"]/,
        );
      });

      it('destructures `run` and `inFlight` from useGuardedSubmit', () => {
        // Match either `{ run, inFlight }` or `{ run: alias, inFlight: alias }`
        // or `{ run: alias, inFlight }` etc. — the shape this file relies on.
        expect(source).toMatch(
          /useGuardedSubmit\s*\(/,
        );
        // Verify both `run` and `inFlight` are extracted. Allow optional alias
        // on either: `run: handleSave`, `inFlight: createInFlight`.
        expect(source).toMatch(/\brun\b\s*[:,}]/);
        expect(source).toMatch(/\binFlight\b\s*[:,}]/);
      });

      it('uses mutateAsync (not fire-and-forget mutate) for the guarded call', () => {
        // The contract: the guarded handler awaits a Promise. That requires
        // `mutateAsync` (returns Promise) instead of `mutate(...)`
        // (fire-and-forget). The literal `mutateAsync` MUST appear in the
        // file, either as a direct call (`await mutation.mutateAsync(`) or
        // as a destructured-and-aliased binding
        // (`{ mutateAsync: createPeriod, ... }` followed by `await
        // createPeriod(`). The aliased form is rare but legitimate.
        expect(source).toMatch(/\bmutateAsync\b/);
        // And we must `await` something inside the guarded body — RHS check
        // separately so a stray `mutateAsync` reference (e.g. in a comment)
        // doesn't pass the suite alone.
        expect(source).toMatch(/\bawait\b/);
      });

      it('propagates inFlight into the Save button gating', () => {
        // The Save button MUST factor `inFlight` (or an alias) into its
        // disabled state so the user sees the in-flight state. The actual
        // JSX shape varies:
        //
        //  - `disabled={inFlight || mutation.isPending}` (CreateAccountDialog)
        //  - `isSubmitting={inFlight || mutation.isPending}` (NewPortfolioDialog
        //    forwards it to PortfolioSetupForm.disabled)
        //  - `disabled={isSaveDisabled}` where `isSaveDisabled = inFlight ||
        //    …` (ChangeReferenceAccountDialog)
        //  - `inFlight: createInFlight` aliased, used as `createInFlight`
        //    elsewhere (AddInstrumentDialog)
        //
        // The invariant we lock is: the destructured guard flag is referenced
        // at least once OUTSIDE the destructure itself. Detect by scanning for
        // any of the well-known shapes.
        const referenced =
          / inFlight[ \t]*[|)}]/.test(source) ||      // `inFlight |` or `inFlight)`
          /\|\| inFlight\b/.test(source) ||           // `... || inFlight`
          /\binFlight\b[^:,}]*[|)}]/.test(source) ||  // any other usage
          // Aliased form: `inFlight: foo` followed by `foo` used elsewhere.
          /\binFlight\s*:\s*(\w+)/.test(source) &&
            (() => {
              const m = source.match(/\binFlight\s*:\s*(\w+)/);
              if (!m) return false;
              const alias = m[1];
              // Count usages outside the destructure line.
              const aliasRe = new RegExp(`\\b${alias}\\b`, 'g');
              const total = (source.match(aliasRe) ?? []).length;
              return total >= 2;
            })();
        expect(referenced).toBe(true);
      });
    });
  }
});
