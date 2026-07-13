export const IMAGE_PIXEL_LIMIT = 40_000_000;
export const SCAN_TIMEOUT_MS = 30_000;
export const CLEAN_TIMEOUT_MS = 45_000;

export const CANCELLED_MESSAGE = 'Обработка отменена.\nФайл не был изменён и не покидал ваше устройство.';
export const TIMEOUT_MESSAGE = 'BURAN не завершил обработку в безопасное время.\nФайл не был загружен или изменён. Попробуйте файл меньшего размера.';
export const RESOURCE_LIMIT_MESSAGE = 'Файл слишком сложный для безопасной обработки в браузере.\nФайл не был изменён и не покидал ваше устройство.';
export const MALFORMED_MESSAGE = 'Не удалось безопасно разобрать файл.\nФайл повреждён или использует неподдерживаемую структуру, поэтому BURAN не создал очищенную копию.';

export function dimensionsExceedPixelLimit(dimensions: { width: number; height: number } | null): boolean {
  if (!dimensions) return false;
  return dimensions.width * dimensions.height > IMAGE_PIXEL_LIMIT;
}
