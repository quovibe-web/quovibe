import { describe, test, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const LOCALES_DIR = join(__dirname, '..', 'i18n', 'locales');
const LANGUAGES = ['en', 'it', 'de', 'fr', 'es', 'nl', 'pl', 'pt'] as const;

type SecJson = {
  title: string;
  subtitle?: string;
  columns: Record<string, string>;
  detail: Record<string, unknown>;
  taxonomies: Record<string, string>;
  summary: Record<string, string>;
};

type AccJson = {
  title: string;
  subtitle?: string;
  types: Record<string, string>;
  columns: Record<string, string>;
  detail: Record<string, unknown>;
  dialog: Record<string, string>;
};

function loadSec(lang: string): SecJson {
  return JSON.parse(readFileSync(join(LOCALES_DIR, lang, 'securities.json'), 'utf-8')) as SecJson;
}

function loadAcc(lang: string): AccJson {
  return JSON.parse(readFileSync(join(LOCALES_DIR, lang, 'accounts.json'), 'utf-8')) as AccJson;
}

function casefold(s: string): string {
  return s.normalize('NFC').toLocaleLowerCase();
}

describe('securities.json internal consistency', () => {
  for (const lang of LANGUAGES) {
    describe(`lang: ${lang}`, () => {
      const sec = loadSec(lang);

      test('no untranslated English stragglers in non-en files', () => {
        if (lang === 'en') return;
        expect(sec.subtitle, 'securities.subtitle must be translated').not.toBe('Manage your securities and instruments');
        expect(sec.taxonomies.notAssigned, 'taxonomies.notAssigned').not.toBe('— Select category —');
        expect(sec.taxonomies.weight, 'taxonomies.weight').not.toBe('Weight %');
        expect(sec.taxonomies.addRow, 'taxonomies.addRow').not.toBe('Add assignment');
        expect(sec.taxonomies.removeRow, 'taxonomies.removeRow').not.toBe('Remove');
        expect(sec.taxonomies.weightSum, 'taxonomies.weightSum').not.toBe('Weight sum');
        expect(sec.summary.totalSecurities, 'summary.totalSecurities').not.toBe('Total Securities');
        expect(sec.summary.activeSecurities, 'summary.activeSecurities').not.toBe('Active');
        expect(sec.summary.totalMarketValue, 'summary.totalMarketValue').not.toBe('Total Market Value');
      });

      test('shares stem alignment across columns/detail', () => {
        const colShares = casefold(sec.columns.shares);
        const detailShares = casefold((sec.detail as { shares: string }).shares);
        expect(detailShares, 'detail.shares vs columns.shares').toEqual(colShares);
      });

      test('unrealizedPL is not an abbreviation (canonical "Unrealized Gains" style)', () => {
        const value = (sec.detail as { unrealizedPL: string }).unrealizedPL;
        // PP canonical is "Unrealized Gains" / "Utili non realizzati" / etc. — never abbreviated.
        expect(value, 'detail.unrealizedPL must not contain P&L / G&V / Z&S / L&P abbreviation').not.toMatch(/[A-Za-z]&[A-Za-z]/);
      });
    });
  }
});

describe('accounts.json internal consistency', () => {
  for (const lang of LANGUAGES) {
    describe(`lang: ${lang}`, () => {
      const acc = loadAcc(lang);

      test('no untranslated English subtitle in non-en files', () => {
        if (lang === 'en') return;
        expect(acc.subtitle, 'accounts.subtitle must be translated').not.toBe('Overview of all portfolio and deposit accounts');
      });

      test('dialog.typeDeposit matches types.deposit', () => {
        expect(casefold(acc.dialog.typeDeposit), 'dialog.typeDeposit vs types.deposit').toEqual(casefold(acc.types.deposit));
      });

      test('dialog.typeSecurities matches types.portfolio', () => {
        expect(casefold(acc.dialog.typeSecurities), 'dialog.typeSecurities vs types.portfolio').toEqual(casefold(acc.types.portfolio));
      });

      test('referenceAccount stem alignment across columns/detail', () => {
        const colRef = casefold(acc.columns.referenceAccount);
        const detailRef = casefold((acc.detail as { referenceAccount: string }).referenceAccount);
        expect(detailRef, 'detail.referenceAccount vs columns.referenceAccount').toEqual(colRef);
      });
    });
  }
});

