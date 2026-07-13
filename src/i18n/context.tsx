import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { DEFAULT_LOCALE, locales, resolveStrings, type Locale } from './index';
import type { Strings } from './types';

const STORAGE_KEY = 'buran.locale';

function isLocale(value: string): value is Locale {
  return Object.prototype.hasOwnProperty.call(locales, value);
}

/** Stored preference → browser language → default (Ukrainian). */
function detectLocale(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && isLocale(saved)) return saved;
  } catch {
    /* localStorage may be unavailable */
  }
  const candidates =
    typeof navigator !== 'undefined'
      ? [navigator.language, ...(navigator.languages ?? [])]
      : [];
  for (const lang of candidates) {
    const code = lang.toLowerCase().split('-')[0];
    if (isLocale(code)) return code;
  }
  return DEFAULT_LOCALE;
}

interface LocaleContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: Strings;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => detectLocale());

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (typeof document !== 'undefined') document.documentElement.lang = locale;
  }, [locale]);

  const value = useMemo<LocaleContextValue>(
    () => ({ locale, setLocale, t: resolveStrings(locale) }),
    [locale, setLocale],
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleContextValue {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error('useLocale must be used within a LocaleProvider');
  return ctx;
}

/** The active locale's strings. Components re-render when the language changes. */
export function useT(): Strings {
  return useLocale().t;
}
