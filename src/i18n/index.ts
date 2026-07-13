import uk from './uk';
import ru from './ru';
import en from './en';
import de from './de';
import es from './es';
import fr from './fr';
import pl from './pl';
import hy from './hy';
import type { Strings } from './types';

export type { Strings, TranslationKey } from './types';

export type Locale = 'uk' | 'ru' | 'en' | 'de' | 'es' | 'fr' | 'pl' | 'hy';

/** Default selected language and missing-string fallback. */
export const DEFAULT_LOCALE: Locale = 'uk';

/** Locales may be partial; missing keys fall back to Ukrainian, then English. */
export const locales: Record<Locale, Partial<Strings>> = { uk, ru, en, de, es, fr, pl, hy };

/**
 * Resolve a complete strings object for a locale: English guarantees every key
 * exists, Ukrainian is the preferred fallback, the selected locale wins.
 */
export function resolveStrings(locale: Locale): Strings {
  return { ...(en as Strings), ...uk, ...locales[locale] } as Strings;
}

/** Native names shown in the language switcher. */
export const localeNames: Record<Locale, string> = {
  uk: 'Українська',
  ru: 'Русский',
  en: 'English',
  de: 'Deutsch',
  es: 'Español',
  fr: 'Français',
  pl: 'Polski',
  hy: 'Հայերեն',
};

/** Display order in the switcher. */
export const localeOrder: Locale[] = ['uk', 'en', 'de', 'es', 'fr', 'pl', 'hy', 'ru'];

/**
 * Static default-locale strings, for the rare non-React caller. UI components
 * must use `useT()` so they re-render when the language changes.
 */
export const strings: Strings = resolveStrings(DEFAULT_LOCALE);

export { useT, useLocale, LocaleProvider } from './context';
