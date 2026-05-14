import { describe, test, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const LOCALES_DIR = join(__dirname, '..', 'i18n', 'locales');
const LANGUAGES = ['en', 'it', 'de', 'fr', 'es', 'nl', 'pl', 'pt'] as const;

type TxJson = {
  types: Record<string, string>;
  columns: Record<string, string>;
  form: Record<string, string>;
  validation?: Record<string, string>;
  editTitles?: Record<string, string>;
};

function loadTx(lang: string): TxJson {
  return JSON.parse(readFileSync(join(LOCALES_DIR, lang, 'transactions.json'), 'utf-8')) as TxJson;
}

function stripDeductedPrefix(v: string): string {
  return v.replace(/^[-−–—]\s*/, '').trim();
}

function stripOptionalSuffix(v: string): string {
  return v.replace(/\s*\([^)]*\)\s*$/, '').trim();
}

function stripCcySuffix(v: string): string {
  return v.replace(/\s*\(\{\{ccy\}\}\)\s*$/, '').trim();
}

function casefold(s: string): string {
  return s.normalize('NFC').toLocaleLowerCase();
}

describe('transactions.json internal consistency', () => {
  for (const lang of LANGUAGES) {
    describe(`lang: ${lang}`, () => {
      const tx = loadTx(lang);

      test('fees stem alignment across types/form/columns', () => {
        const base = casefold(tx.types.fees);
        expect(casefold(tx.form.fees), 'form.fees vs types.fees').toEqual(base);
        expect(casefold(stripOptionalSuffix(tx.form.feesOptional)), 'form.feesOptional stem').toEqual(base);
        expect(casefold(stripDeductedPrefix(tx.form.feesDeducted)), 'form.feesDeducted stem').toEqual(base);
        expect(casefold(stripCcySuffix(tx.form.feesInCcy)), 'form.feesInCcy stem').toEqual(base);
      });

      test('taxes stem alignment across types/form', () => {
        const base = casefold(tx.types.taxes);
        expect(casefold(tx.form.taxes), 'form.taxes vs types.taxes').toEqual(base);
        expect(casefold(stripOptionalSuffix(tx.form.taxesOptional)), 'form.taxesOptional stem').toEqual(base);
        expect(casefold(stripDeductedPrefix(tx.form.taxesDeducted)), 'form.taxesDeducted stem').toEqual(base);
        expect(casefold(stripCcySuffix(tx.form.taxesInCcy)), 'form.taxesInCcy stem').toEqual(base);
      });

      test('security stem alignment across columns/form/filters', () => {
        const base = casefold(tx.columns.security);
        expect(casefold(tx.form.security), 'form.security vs columns.security').toEqual(base);
        expect(casefold(stripOptionalSuffix(tx.form.securityOptional)), 'form.securityOptional stem').toEqual(base);
      });

      test('cashAccount stem alignment across form/validation/copy', () => {
        const base = casefold(tx.form.cashAccount);
        const STEM_LEN = 5;
        const baseStem = base.slice(0, Math.min(STEM_LEN, base.length));

        const referencingKeys = [
          { ns: 'form' as const, key: 'selectCashAccount' },
          { ns: 'form' as const, key: 'cashAccountLinked' },
          { ns: 'validation' as const, key: 'selectAccount' },
        ];
        for (const { ns, key } of referencingKeys) {
          const value = tx[ns]?.[key];
          if (!value) continue;
          const folded = casefold(value);
          expect(
            folded.includes(baseStem),
            `${ns}.${key} (\"${value}\") must share a stem with form.cashAccount (\"${tx.form.cashAccount}\") — looking for \"${baseStem}\"`
          ).toBe(true);
        }
      });

      test('editTitles stems match types when present', () => {
        if (!tx.editTitles) return;
        const sharedKeys = ['buy', 'sell', 'deposit', 'dividend', 'interest', 'interestCharge', 'fees', 'feesRefund', 'taxes', 'removal', 'taxRefund', 'deliveryInbound', 'deliveryOutbound'];
        const STEM_LEN = 5;
        for (const k of sharedKeys) {
          const editTitle = tx.editTitles[k];
          const typeLabel = tx.types[k];
          if (!editTitle || !typeLabel) continue;
          const editFolded = casefold(editTitle);
          const typeFolded = casefold(typeLabel);
          if (typeFolded.length <= STEM_LEN) {
            expect(
              editFolded.includes(typeFolded),
              `editTitles.${k} (\"${editTitle}\") must contain types.${k} (\"${typeLabel}\")`
            ).toBe(true);
            continue;
          }
          const stem = typeFolded.slice(0, STEM_LEN);
          expect(
            editFolded.includes(stem),
            `editTitles.${k} (\"${editTitle}\") must share a ${STEM_LEN}-char stem with types.${k} (\"${typeLabel}\") — looking for \"${stem}\"`
          ).toBe(true);
        }
      });
    });
  }
});
