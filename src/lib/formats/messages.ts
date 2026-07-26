/**
 * Engine-side message codes.
 *
 * Format handlers run inside Web Workers, where the selected locale is not
 * available, so they must never emit user-facing prose. They emit a stable code
 * instead and the UI resolves it against the active translation.
 *
 * `resolveEngineMessage` passes anything it does not recognise through
 * verbatim, so handlers can be migrated to codes one at a time without
 * breaking the screens that render their output.
 */

import type { Strings } from '../../i18n';

/** Translation keys whose value is a single string (not a string list). */
type TextKey = {
  [K in keyof Strings]: Strings[K] extends string ? K : never;
}[keyof Strings];

/**
 * Codes carry a `buran:` prefix so a code is never mistaken for prose and a
 * missed migration is obvious in the UI rather than silently localized wrong.
 */
export const ENGINE_MESSAGES = {
  'buran:risk/office.custom-xml-preserved': 'riskOfficeCustomXmlPreserved',
  'buran:risk/office.custom-xml-remaining': 'riskOfficeCustomXmlRemaining',
  'buran:risk/office.main-part-missing': 'riskOfficeMainPartMissing',
  'buran:risk/office.package-unreadable': 'riskOfficePackageUnreadable',
} as const satisfies Record<string, TextKey>;

export type EngineMessageCode = keyof typeof ENGINE_MESSAGES;

/** Resolve one engine message to localized text, or return it unchanged. */
export function resolveEngineMessage(message: string, t: Strings): string {
  const key = ENGINE_MESSAGES[message as EngineMessageCode];
  return key ? t[key] : message;
}

/** Resolve a list of engine messages, preserving order and dropping blanks. */
export function resolveEngineMessages(messages: readonly string[], t: Strings): string[] {
  return messages.filter((m) => m.trim() !== '').map((m) => resolveEngineMessage(m, t));
}
