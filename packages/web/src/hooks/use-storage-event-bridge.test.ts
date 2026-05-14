import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  routeStorageEvent,
  PRIVACY_KEY,
  THEME_KEY,
  LANGUAGE_KEY,
  DEFAULT_THEME,
  DEFAULT_LANGUAGE,
  type StorageEventHandlers,
} from './use-storage-event-bridge';

function makeHandlers(): StorageEventHandlers {
  return {
    setPrivacy: vi.fn(),
    syncTheme: vi.fn(),
    changeLanguage: vi.fn(),
  };
}

let h: StorageEventHandlers;
beforeEach(() => {
  h = makeHandlers();
});

describe('routeStorageEvent — privacy', () => {
  it('routes "true" to setPrivacy(true)', () => {
    routeStorageEvent(PRIVACY_KEY, 'true', h);
    expect(h.setPrivacy).toHaveBeenCalledWith(true);
    expect(h.syncTheme).not.toHaveBeenCalled();
    expect(h.changeLanguage).not.toHaveBeenCalled();
  });

  it('routes "false" to setPrivacy(false)', () => {
    routeStorageEvent(PRIVACY_KEY, 'false', h);
    expect(h.setPrivacy).toHaveBeenCalledWith(false);
  });

  it('routes null (key removed) to setPrivacy(false) — fall back to default', () => {
    routeStorageEvent(PRIVACY_KEY, null, h);
    expect(h.setPrivacy).toHaveBeenCalledWith(false);
  });

  it('treats any non-"true" string as false (defensive)', () => {
    routeStorageEvent(PRIVACY_KEY, 'garbage', h);
    expect(h.setPrivacy).toHaveBeenCalledWith(false);
  });
});

describe('routeStorageEvent — theme', () => {
  it('routes "light" through syncTheme', () => {
    routeStorageEvent(THEME_KEY, 'light', h);
    expect(h.syncTheme).toHaveBeenCalledWith('light');
  });

  it('routes "dark" through syncTheme', () => {
    routeStorageEvent(THEME_KEY, 'dark', h);
    expect(h.syncTheme).toHaveBeenCalledWith('dark');
  });

  it('routes "system" through syncTheme', () => {
    routeStorageEvent(THEME_KEY, 'system', h);
    expect(h.syncTheme).toHaveBeenCalledWith('system');
  });

  it('routes null (key removed) to syncTheme(DEFAULT_THEME)', () => {
    routeStorageEvent(THEME_KEY, null, h);
    expect(h.syncTheme).toHaveBeenCalledWith(DEFAULT_THEME);
  });

  it('ignores invalid theme value', () => {
    routeStorageEvent(THEME_KEY, 'neon', h);
    expect(h.syncTheme).not.toHaveBeenCalled();
  });
});

describe('routeStorageEvent — language', () => {
  it('routes a non-empty string through changeLanguage', () => {
    routeStorageEvent(LANGUAGE_KEY, 'it', h);
    expect(h.changeLanguage).toHaveBeenCalledWith('it');
  });

  it('routes null (key removed) to changeLanguage(DEFAULT_LANGUAGE)', () => {
    routeStorageEvent(LANGUAGE_KEY, null, h);
    expect(h.changeLanguage).toHaveBeenCalledWith(DEFAULT_LANGUAGE);
  });

  it('ignores empty string (treats as no-op)', () => {
    routeStorageEvent(LANGUAGE_KEY, '', h);
    expect(h.changeLanguage).not.toHaveBeenCalled();
  });
});

describe('routeStorageEvent — unknown keys', () => {
  it('does nothing on unrelated keys', () => {
    routeStorageEvent('quovibe-something-else', 'true', h);
    expect(h.setPrivacy).not.toHaveBeenCalled();
    expect(h.syncTheme).not.toHaveBeenCalled();
    expect(h.changeLanguage).not.toHaveBeenCalled();
  });

  it('ignores null key (StorageEvent emitted by storage.clear())', () => {
    routeStorageEvent(null, null, h);
    expect(h.setPrivacy).not.toHaveBeenCalled();
    expect(h.syncTheme).not.toHaveBeenCalled();
    expect(h.changeLanguage).not.toHaveBeenCalled();
  });
});
