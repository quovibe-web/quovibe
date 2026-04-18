import { describe, test, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const LOCALES_DIR = join(__dirname, '..', 'i18n', 'locales');
const NAMESPACES = ['dashboard', 'performance', 'welcome', 'csv-import'];
const LANGUAGES = ['en', 'it', 'de', 'fr', 'es', 'nl', 'pl', 'pt'];

function getAllKeys(obj: Record<string, unknown>, prefix = ''): string[] {
  const keys: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      keys.push(...getAllKeys(value as Record<string, unknown>, fullKey));
    } else {
      keys.push(fullKey);
    }
  }
  return keys.sort();
}

describe('H1: i18n key completeness', () => {
  for (const ns of NAMESPACES) {
    describe(`namespace: ${ns}`, () => {
      const enPath = join(LOCALES_DIR, 'en', `${ns}.json`);
      const enData = JSON.parse(readFileSync(enPath, 'utf-8'));
      const enKeys = getAllKeys(enData);

      for (const lang of LANGUAGES.filter(l => l !== 'en')) {
        test(`${lang}/${ns}.json has all keys from en`, () => {
          const langPath = join(LOCALES_DIR, lang, `${ns}.json`);
          const langData = JSON.parse(readFileSync(langPath, 'utf-8'));
          const langKeys = getAllKeys(langData);
          const missing = enKeys.filter(k => !langKeys.includes(k));
          expect(missing).toEqual([]);
        });
      }
    });
  }
});
