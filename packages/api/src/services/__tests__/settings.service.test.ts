import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

// ---------------------------------------------------------------------------
// Test isolation: use a temp directory so tests never touch the real sidecar.
// We point QUOVIBE_DATA_DIR at a temp dir, then reset config's module-level
// constants so SIDECAR_PATH resolves inside our tempDir.
// ---------------------------------------------------------------------------

let tempDir: string;
let sidecarPath: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quovibe-settings-test-'));
  sidecarPath = path.join(tempDir, 'quovibe.settings.json');

  process.env.QUOVIBE_DATA_DIR = tempDir;
  vi.resetModules();
});

afterEach(() => {
  vi.resetModules();
  delete process.env.QUOVIBE_DATA_DIR;
  fs.rmSync(tempDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Helper: dynamically import the service after mocking config
// ---------------------------------------------------------------------------
async function importService() {
  const mod = await import('../settings.service');
  return mod;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('loadSettings — no sidecar file', () => {
  test('returns DEFAULT_SETTINGS when sidecar file does not exist', async () => {
    const { loadSettings, getSettings } = await importService();
    const { DEFAULT_SETTINGS } = await import('@quovibe/shared');

    expect(fs.existsSync(sidecarPath)).toBe(false);
    loadSettings();

    const settings = getSettings();
    expect(settings).toEqual(DEFAULT_SETTINGS);
  });
});

describe('loadSettings — corrupt file', () => {
  test('returns defaults when sidecar file contains garbage JSON', async () => {
    const { loadSettings, getSettings } = await importService();
    const { DEFAULT_SETTINGS } = await import('@quovibe/shared');

    fs.writeFileSync(sidecarPath, '{ this is not : valid json !!!', 'utf-8');

    loadSettings();

    const settings = getSettings();
    expect(settings).toEqual(DEFAULT_SETTINGS);
  });
});

describe('loadSettings — valid sidecar file', () => {
  test('reads and parses a valid sidecar file', async () => {
    const { loadSettings, getSettings } = await importService();

    const content = {
      version: 1,
      app: { lastImport: '2024-06-01', appVersion: '0.1.0' },
      preferences: {
        language: 'it',
        theme: 'dark',
        sharesPrecision: 4,
        quotesPrecision: 3,
        showCurrencyCode: true,
        showPaSuffix: false,
        privacyMode: true,
      },
      reportingPeriods: [{ type: 'currentYTD' }],
    };
    fs.writeFileSync(sidecarPath, JSON.stringify(content), 'utf-8');

    loadSettings();

    const settings = getSettings();
    expect(settings.version).toBe(1);
    expect(settings.app.lastImport).toBe('2024-06-01');
    expect(settings.app.appVersion).toBe('0.1.0');
    expect(settings.preferences.language).toBe('it');
    expect(settings.preferences.theme).toBe('dark');
    expect(settings.preferences.sharesPrecision).toBe(4);
    expect(settings.preferences.privacyMode).toBe(true);
    expect(settings.reportingPeriods).toHaveLength(1);
    expect(settings.reportingPeriods[0]).toEqual({ type: 'currentYTD' });
  });
});

describe('updateSettings — writes to disk and updates cache', () => {
  test('writes sidecar file on first write and updates cache', async () => {
    const { loadSettings, updateSettings, getSettings } = await importService();

    // Start without a file
    expect(fs.existsSync(sidecarPath)).toBe(false);
    loadSettings();

    const result = updateSettings({ app: { lastImport: '2025-01-15' } });

    // File must now exist
    expect(fs.existsSync(sidecarPath)).toBe(true);

    // Returned value must contain the update
    expect(result.app.lastImport).toBe('2025-01-15');

    // Cache must be updated
    expect(getSettings().app.lastImport).toBe('2025-01-15');

    // On-disk content must match
    const raw = JSON.parse(fs.readFileSync(sidecarPath, 'utf-8'));
    expect(raw.app.lastImport).toBe('2025-01-15');
  });

  test('atomic write: uses .tmp file then renames', async () => {
    const { loadSettings, updateSettings } = await importService();
    loadSettings();

    const tmpPath = sidecarPath + '.tmp';

    updateSettings({ preferences: { language: 'de' } });

    // After a successful write the .tmp file must be gone
    expect(fs.existsSync(tmpPath)).toBe(false);
    expect(fs.existsSync(sidecarPath)).toBe(true);
  });
});

describe('updateAppState — convenience wrapper for app section', () => {
  test('updates only the app section, leaving preferences intact', async () => {
    const { loadSettings, updateAppState, getSettings } = await importService();
    loadSettings();

    // First set a preference
    await (await import('../settings.service')).updateSettings({
      preferences: { language: 'fr' },
    });

    // Then update app state
    updateAppState({ lastImport: '2026-03-19' });

    const settings = getSettings();
    expect(settings.app.lastImport).toBe('2026-03-19');
    // Preferences must be preserved
    expect(settings.preferences.language).toBe('fr');
  });
});

describe('updatePreferences — convenience wrapper for preferences section', () => {
  test('updates only preferences, leaving app section intact', async () => {
    const { loadSettings, updatePreferences, getSettings } = await importService();
    loadSettings();

    // First set app state
    await (await import('../settings.service')).updateSettings({
      app: { lastImport: '2026-01-01' },
    });

    updatePreferences({ theme: 'dark', privacyMode: true });

    const settings = getSettings();
    expect(settings.preferences.theme).toBe('dark');
    expect(settings.preferences.privacyMode).toBe(true);
    // App state must be preserved
    expect(settings.app.lastImport).toBe('2026-01-01');
  });
});

describe('updateSettings — partial updates preserve existing data', () => {
  test('preserves existing fields on partial update', async () => {
    const { loadSettings, updateSettings, getSettings } = await importService();
    loadSettings();

    // Write initial full state
    updateSettings({
      app: { lastImport: '2025-06-01', appVersion: '0.2.0' },
      preferences: { language: 'es', theme: 'light', sharesPrecision: 2 },
    });

    // Partial update: only change appVersion
    updateSettings({ app: { appVersion: '0.3.0' } });

    const settings = getSettings();
    // lastImport must be preserved
    expect(settings.app.lastImport).toBe('2025-06-01');
    expect(settings.app.appVersion).toBe('0.3.0');
    // All preferences must be preserved
    expect(settings.preferences.language).toBe('es');
    expect(settings.preferences.theme).toBe('light');
    expect(settings.preferences.sharesPrecision).toBe(2);
  });
});

describe('File creation policy', () => {
  test('does NOT create sidecar file on loadSettings when file is absent', async () => {
    const { loadSettings } = await importService();

    expect(fs.existsSync(sidecarPath)).toBe(false);
    loadSettings();
    // File must still not exist after a read-only load
    expect(fs.existsSync(sidecarPath)).toBe(false);
  });

  test('DOES create sidecar file on first updateSettings call', async () => {
    const { loadSettings, updateSettings } = await importService();

    loadSettings();
    expect(fs.existsSync(sidecarPath)).toBe(false);

    updateSettings({ preferences: { language: 'nl' } });
    expect(fs.existsSync(sidecarPath)).toBe(true);
  });
});

describe('reportingPeriods round-trip', () => {
  test('stores and retrieves an array of reporting period definitions', async () => {
    const { loadSettings, updateSettings, getSettings } = await importService();
    loadSettings();

    const periods = [
      { type: 'currentYTD' as const },
      { type: 'lastYearsMonths' as const, years: 1, months: 0 },
      { type: 'fromTo' as const, from: '2024-01-01', to: '2024-12-31' },
    ];

    updateSettings({ reportingPeriods: periods });

    const settings = getSettings();
    expect(settings.reportingPeriods).toHaveLength(3);
    expect(settings.reportingPeriods[0]).toEqual({ type: 'currentYTD' });
    expect(settings.reportingPeriods[1]).toEqual({ type: 'lastYearsMonths', years: 1, months: 0 });
    expect(settings.reportingPeriods[2]).toEqual({ type: 'fromTo', from: '2024-01-01', to: '2024-12-31' });
  });
});

describe('tableLayouts round-trip', () => {
  test('stores and retrieves tableLayouts for a tableId', async () => {
    const { loadSettings, updateSettings, getSettings } = await importService();
    loadSettings();

    updateSettings({
      tableLayouts: {
        transactions: {
          columnOrder: ['date', 'type', 'amount'],
          columnSizing: { date: 120 },
          sorting: [{ id: 'date', desc: true }],
          columnVisibility: null,
          version: 1,
        },
      },
    });

    const settings = getSettings();
    expect(settings.tableLayouts['transactions'].columnOrder).toEqual(['date', 'type', 'amount']);
    expect(settings.tableLayouts['transactions'].columnSizing['date']).toBe(120);
    expect(settings.tableLayouts['transactions'].sorting).toEqual([{ id: 'date', desc: true }]);
  });

  test('preserves existing tableLayouts when updating preferences', async () => {
    const { loadSettings, updateSettings, getSettings } = await importService();
    loadSettings();

    updateSettings({
      tableLayouts: { transactions: { columnOrder: ['date', 'type'], columnSizing: {}, sorting: null, columnVisibility: null, version: 1 } },
    });
    updateSettings({ preferences: { language: 'de' } });

    const settings = getSettings();
    expect(settings.tableLayouts['transactions'].columnOrder).toEqual(['date', 'type']);
    expect(settings.preferences.language).toBe('de');
  });

  test('defaults tableLayouts to {} in DEFAULT_SETTINGS', async () => {
    const { loadSettings, getSettings } = await importService();
    loadSettings();
    expect(getSettings().tableLayouts).toEqual({});
  });
});

describe('updatePreferences — defaultDataSeriesTaxonomyId round-trip', () => {
  test('persists and retrieves defaultDataSeriesTaxonomyId', async () => {
    const { loadSettings, updatePreferences, getSettings } = await importService();
    loadSettings();

    updatePreferences({ defaultDataSeriesTaxonomyId: 'tax-uuid-abc' });

    const settings = getSettings();
    expect(settings.preferences.defaultDataSeriesTaxonomyId).toBe('tax-uuid-abc');
  });

  test('defaultDataSeriesTaxonomyId is undefined by default', async () => {
    const { loadSettings, getSettings } = await importService();
    loadSettings();

    expect(getSettings().preferences.defaultDataSeriesTaxonomyId).toBeUndefined();
  });
});

describe('updateSettings — allocationView', () => {
  test('partial-merges allocationView.chartMode', async () => {
    const { loadSettings, updateSettings, getSettings } = await importService();
    loadSettings();

    const before = getSettings();
    expect(before.allocationView.chartMode).toBe('pie');

    updateSettings({ allocationView: { chartMode: 'treemap' } });

    const after = getSettings();
    expect(after.allocationView.chartMode).toBe('treemap');
    // Sibling namespaces are untouched
    expect(after.investmentsView).toEqual(before.investmentsView);
  });
});
