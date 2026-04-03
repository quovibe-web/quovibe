import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { createElement } from 'react';

export type ThemeMode = 'light' | 'dark' | 'system';

interface ThemeContextValue {
  theme: ThemeMode;
  setTheme: (theme: ThemeMode) => void;
  syncThemeFromServer: (theme: ThemeMode) => void;
  resolvedTheme: 'light' | 'dark';
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const STORAGE_KEY = 'quovibe-theme';
const LEGACY_KEY = 'vibefolio-theme';
const VALID_THEMES: readonly ThemeMode[] = ['light', 'dark', 'system'];

function migrateStorageKey(): void {
  const legacy = localStorage.getItem(LEGACY_KEY);
  if (legacy !== null && localStorage.getItem(STORAGE_KEY) === null) {
    localStorage.setItem(STORAGE_KEY, legacy);
    localStorage.removeItem(LEGACY_KEY);
  }
}

function parseStoredTheme(): ThemeMode {
  migrateStorageKey();
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored && VALID_THEMES.includes(stored as ThemeMode)
    ? (stored as ThemeMode)
    : 'system';
}

function getSystemDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function applyTheme(mode: ThemeMode): 'light' | 'dark' {
  const resolved = mode === 'system' ? (getSystemDark() ? 'dark' : 'light') : mode;
  const el = document.documentElement;
  el.classList.add('theme-transitioning');
  el.classList.toggle('dark', resolved === 'dark');
  setTimeout(() => el.classList.remove('theme-transitioning'), 200);
  return resolved;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeMode>(parseStoredTheme);

  const [resolvedTheme, setResolvedTheme] = useState<'light' | 'dark'>(() =>
    applyTheme(parseStoredTheme())
  );

  useEffect(() => {
    const resolved = applyTheme(theme);
    setResolvedTheme(resolved);

    if (theme !== 'system') return;

    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => {
      const r = applyTheme('system');
      setResolvedTheme(r);
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [theme]);

  function setTheme(next: ThemeMode) {
    localStorage.setItem(STORAGE_KEY, next);
    setThemeState(next);
  }

  function syncThemeFromServer(next: ThemeMode) {
    localStorage.setItem(STORAGE_KEY, next);
    setThemeState(next);
  }

  return createElement(ThemeContext.Provider, { value: { theme, setTheme, syncThemeFromServer, resolvedTheme } }, children);
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
  return ctx;
}
