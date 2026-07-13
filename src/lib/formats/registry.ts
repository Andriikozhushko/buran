import type { FormatHandler, SupportedFormat } from './types';

const handlers = new Map<SupportedFormat, FormatHandler>();

export function registerFormatHandler(handler: FormatHandler): void {
  handlers.set(handler.format, handler);
}

export function getFormatHandler(format: SupportedFormat): FormatHandler | undefined {
  return handlers.get(format);
}

export function getSupportedFormats(): readonly SupportedFormat[] {
  return ['jpeg', 'png', 'webp'] as const;
}

export function isFormatSupported(format: string): format is SupportedFormat {
  return handlers.has(format as SupportedFormat);
}

export function initializeRegistry(): void {
  // Handlers are registered in their respective modules.
  // This function is called at app startup to ensure all are loaded.
}
