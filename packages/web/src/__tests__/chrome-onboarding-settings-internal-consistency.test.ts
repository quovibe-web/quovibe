import { describe, test, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const LOCALES_DIR = join(__dirname, '..', 'i18n', 'locales');
const LANGUAGES = ['en', 'it', 'de', 'fr', 'es', 'nl', 'pl', 'pt'] as const;

type Json = Record<string, unknown>;

function load(lang: string, file: string): Json {
  return JSON.parse(readFileSync(join(LOCALES_DIR, lang, file), 'utf-8')) as Json;
}

function get(obj: Json, path: string): string | undefined {
  const parts = path.split('.');
  let cur: unknown = obj;
  for (const p of parts) {
    if (typeof cur !== 'object' || cur === null) return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return typeof cur === 'string' ? cur : undefined;
}

function casefold(s: string): string {
  return s.normalize('NFC').toLocaleLowerCase();
}

function stemOf(s: string, len = 5): string {
  return casefold(s).slice(0, Math.min(len, s.length));
}

describe('welcome.json internal consistency', () => {
  for (const lang of LANGUAGES) {
    describe(`lang: ${lang}`, () => {
      const w = load(lang, 'welcome.json');

      test('importing key not English fallback in non-en', () => {
        if (lang === 'en') return;
        expect(get(w, 'flow.importing')).not.toBe('Importing…');
      });

      test('importSuccess block not English fallback in non-en', () => {
        if (lang === 'en') return;
        const englishMarkers = [
          { path: 'flow.importSuccess.title', english: 'Import successful' },
          { path: 'flow.importSuccess.openButton', english: 'Open portfolio' },
          { path: 'flow.importSuccess.statSecurities_one', english: '{{count}} Security' },
          { path: 'flow.importSuccess.statSecurities_other', english: '{{count}} Securities' },
          { path: 'flow.importSuccess.statAccounts_one', english: '{{count}} Account' },
          { path: 'flow.importSuccess.statTransactions_one', english: '{{count}} Transaction' },
        ];
        for (const { path, english } of englishMarkers) {
          const v = get(w, path);
          if (!v) continue;
          expect(v, `welcome.${path} must be translated (current: "${v}")`).not.toBe(english);
        }
      });
    });
  }
});

describe('navigation.json cross-namespace stem alignment', () => {
  for (const lang of LANGUAGES) {
    describe(`lang: ${lang}`, () => {
      const nav = load(lang, 'navigation.json');
      const tx = load(lang, 'transactions.json');

      test('navigation.items.security stem matches transactions.columns.security', () => {
        const navSecurity = get(nav, 'items.security');
        const txSecurity = get(tx, 'columns.security');
        if (!navSecurity || !txSecurity) return;
        expect(
          casefold(navSecurity),
          `navigation.items.security ("${navSecurity}") must match transactions.columns.security ("${txSecurity}")`,
        ).toEqual(casefold(txSecurity));
      });

      test('navigation.items.account stem matches accounts ecosystem', () => {
        const navAccount = get(nav, 'items.account');
        if (!navAccount) return;
        const acc = load(lang, 'accounts.json');
        const colName = get(acc, 'columns.name');
        if (!colName) return;
        const sectionDeposit = get(acc, 'sections.deposit');
        // navigation.account is the generic singular noun; verify it shares a stem with either
        // the generic account-type noun or sections.deposit
        const navStem = stemOf(navAccount, 4);
        const sources = [sectionDeposit, get(acc, 'title')].filter((s): s is string => !!s);
        const matches = sources.some((s) => casefold(s).includes(navStem));
        expect(
          matches,
          `navigation.items.account ("${navAccount}") stem "${navStem}" must appear in accounts.json sections.deposit or title`,
        ).toBe(true);
      });
    });
  }
});

describe('portfolio-setup.json cross-namespace consistency', () => {
  for (const lang of LANGUAGES) {
    describe(`lang: ${lang}`, () => {
      const setup = load(lang, 'portfolio-setup.json');
      const acc = load(lang, 'accounts.json');

      test('account-type wording uses canonical stems from accounts.types', () => {
        const depositType = get(acc, 'types.deposit');
        if (!depositType) return;
        // portfolio-setup primaryDeposit.name (or similar) — verify stems align with deposit type
        // This is a sanity check that portfolio-setup hasn't drifted from the canonical types.deposit anchor.
        const depositStem = stemOf(depositType, 4);
        // Scan portfolio-setup for any string mentioning the account-type stem
        const flat = JSON.stringify(setup);
        const folded = casefold(flat);
        expect(
          folded.includes(depositStem),
          `portfolio-setup.json must contain accounts.types.deposit stem ("${depositStem}" from "${depositType}")`,
        ).toBe(true);
      });
    });
  }
});
