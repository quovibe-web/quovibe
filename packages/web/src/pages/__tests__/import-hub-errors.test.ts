import { describe, test, expect } from 'vitest';
import { mapServerError } from '../ImportHub';

/**
 * Locks the contract between `.claude/rules/xml-import.md`'s error-code table
 * and `ImportHub.tsx`'s inline <Alert> mapping. Every code documented in that
 * rule must resolve to a non-null PpUploadError so the user sees feedback;
 * silently falling through to `null` is BUG-95 regressing.
 *
 * DUPLICATE_NAME maps to 'duplicateName' (BUG-PRE14-03): the inline alert
 * improves discoverability over a transient toast and is consistent with the
 * other failure surfaces. The handler clears the error when the user types
 * into the rename input so the recovery path is obvious.
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
    ['DUPLICATE_NAME', 'duplicateName'],
  ])('maps %s → %s', (code, expected) => {
    expect(mapServerError(code)).toBe(expected);
  });

  test('unknown code returns null', () => {
    expect(mapServerError('SOMETHING_WEIRD')).toBeNull();
  });
});
