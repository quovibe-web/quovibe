import { createContext, useContext, useState, type ReactNode } from 'react';

interface PrivacyContextValue {
  isPrivate: boolean;
  togglePrivacy: () => void;
  setPrivacy: (value: boolean) => void;
}

const PrivacyContext = createContext<PrivacyContextValue>({
  isPrivate: false,
  togglePrivacy: () => {},
  setPrivacy: () => {},
});

const STORAGE_KEY = 'quovibe_privacy_mode';
const LEGACY_KEY = 'vibefolio_privacy_mode';

function migrateStorageKey(): void {
  const legacy = localStorage.getItem(LEGACY_KEY);
  if (legacy !== null && localStorage.getItem(STORAGE_KEY) === null) {
    localStorage.setItem(STORAGE_KEY, legacy);
    localStorage.removeItem(LEGACY_KEY);
  }
}

export function PrivacyProvider({ children }: { children: ReactNode }) {
  const [isPrivate, setIsPrivate] = useState(() => {
    migrateStorageKey();
    return localStorage.getItem(STORAGE_KEY) === 'true';
  });

  function togglePrivacy() {
    setIsPrivate((prev) => {
      const next = !prev;
      localStorage.setItem(STORAGE_KEY, String(next));
      return next;
    });
  }

  function setPrivacy(value: boolean) {
    localStorage.setItem(STORAGE_KEY, String(value));
    setIsPrivate(value);
  }

  return (
    <PrivacyContext.Provider value={{ isPrivate, togglePrivacy, setPrivacy }}>
      {children}
    </PrivacyContext.Provider>
  );
}

export function usePrivacy() {
  return useContext(PrivacyContext);
}
