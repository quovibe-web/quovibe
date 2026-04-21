import { describe, test, expect } from 'vitest';
import { mapServerError } from '../ImportHub';

/**
 * Locks the contract between `.claude/rules/xml-import.md`'s error-code table
 * and `ImportHub.tsx`'s inline <Alert> mapping. Every code documented in that
 * rule must resolve to a non-null PpUploadError so the user sees feedback;
 * silently falling through to `null` is BUG-95 regressing.
 *
 * DUPLICATE_NAME is intentionally excluded: it has its own toast path
 * (`errors.portfolio.duplicateName`) and must NOT render as a drop-zone
 * error (user keeps the file, only renames).
 */
describe('ImportHub.mapServerError', () => {
  test.each([
    ['FILE_TOO_LARGE', 'tooLarge'],
    ['INVALID_FILE_FORMAT', 'invalidFile'],
    ['NO_FILE', 'invalidFile'],
    ['INVALID_XML', 'invalidXml'],
    ['INVALID_FORMAT', 'invalidFormat'],
    ['ENCRYPTED_FORMAT', 'encrypted'],
    ['IMPORT_IN_PROGRESS', 'importInProgress'],
    ['CONVERSION_FAILED', 'conversionFailed'],
  ])('maps %s → %s', (code, expected) => {
    expect(mapServerError(code)).toBe(expected);
  });

  test('DUPLICATE_NAME intentionally returns null (toast path handles it)', () => {
    expect(mapServerError('DUPLICATE_NAME')).toBeNull();
  });

  test('unknown code returns null', () => {
    expect(mapServerError('SOMETHING_WEIRD')).toBeNull();
  });
});
