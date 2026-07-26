import { describe, expect, it } from 'vitest';
import ru from '../../src/i18n/ru';
import { localeOrder, locales, resolveStrings } from '../../src/i18n';
import type { Locale } from '../../src/i18n';
import { ENGINE_MESSAGES, resolveEngineMessage, resolveEngineMessages } from '../../src/lib/formats/messages';

const ALL_LOCALES = Object.keys(locales) as Locale[];
const SCHEMA_KEYS = Object.keys(ru);

describe('translation completeness', () => {
  it.each(ALL_LOCALES)('%s carries every key from the Russian schema, with no extras', (locale) => {
    const strings = locales[locale] as Record<string, unknown>;
    expect(Object.keys(strings).filter((k) => !SCHEMA_KEYS.includes(k))).toEqual([]);
    expect(SCHEMA_KEYS.filter((k) => !(k in strings))).toEqual([]);
  });

  it.each(ALL_LOCALES)('%s has no blank strings', (locale) => {
    const strings = locales[locale] as Record<string, unknown>;
    const blank = Object.entries(strings)
      .filter(([, v]) => typeof v === 'string' && v.trim() === '')
      .map(([k]) => k);
    expect(blank).toEqual([]);
  });

  it('lists every locale in the switcher order exactly once', () => {
    expect([...localeOrder].sort()).toEqual([...ALL_LOCALES].sort());
  });
});

describe('engine message codes', () => {
  it('uses the reserved prefix so an unmigrated handler is visible, never mislabelled', () => {
    for (const code of Object.keys(ENGINE_MESSAGES)) {
      expect(code.startsWith('buran:')).toBe(true);
    }
  });

  it.each(ALL_LOCALES)('%s resolves every engine message code to real text', (locale) => {
    const t = resolveStrings(locale);
    for (const code of Object.keys(ENGINE_MESSAGES)) {
      const text = resolveEngineMessage(code, t);
      expect(text, `${code} in ${locale}`).not.toBe(code);
      expect(text.trim().length, `${code} in ${locale}`).toBeGreaterThan(0);
    }
  });

  it('passes text that is not a code through unchanged', () => {
    const t = resolveStrings('en');
    expect(resolveEngineMessage('Some handler prose', t)).toBe('Some handler prose');
    expect(resolveEngineMessages(['buran:risk/office.main-part-missing', '', 'raw'], t)).toEqual([
      t.riskOfficeMainPartMissing,
      'raw',
    ]);
  });
});
