import { test, expect, type Page } from '@playwright/test';
import { join } from 'node:path';
import { mkdirSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import JSZip from 'jszip';

const FIXTURES = join(import.meta.dirname || __dirname, '..', 'fixtures');

async function installPrivacyGuards(page: Page) {
  await page.addInitScript(() => {
    // The assertions below intentionally verify the Russian copy. Pin the
    // locale so the suite does not depend on the browser/host language.
    localStorage.setItem('buran.locale', 'ru');
    const calls: string[] = [];
    Object.defineProperty(window, '__buranNetworkCalls', { value: calls });
    window.fetch = ((...args: unknown[]) => {
      calls.push(`fetch:${String(args[0])}`);
      throw new Error('Network disabled in BURAN privacy smoke test');
    }) as typeof fetch;
    window.XMLHttpRequest = class extends XMLHttpRequest {
      open(method: string, url: string | URL) {
        calls.push(`xhr:${method}:${String(url)}`);
        throw new Error('XHR disabled in BURAN privacy smoke test');
      }
    };
    window.WebSocket = class extends WebSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        calls.push(`ws:${String(url)}`);
        super(url, protocols);
      }
    };
    navigator.sendBeacon = ((url: string | URL) => {
      calls.push(`beacon:${String(url)}`);
      return false;
    }) as typeof navigator.sendBeacon;
  });
}

async function expectNoNetwork(page: Page) {
  const calls = await page.evaluate(() => (window as unknown as { __buranNetworkCalls: string[] }).__buranNetworkCalls);
  expect(calls.filter((call) => !/^ws:ws:\/\/127\.0\.0\.1:5274\//.test(call))).toEqual([]);
  const requests = await page.evaluate(() => (window as unknown as { __buranRequests?: string[] }).__buranRequests ?? []);
  expect(requests.filter((request) => !isLocalPreviewRequest(request))).toEqual([]);
}

function isLocalPreviewRequest(requestUrl: string): boolean {
  return /^http:\/\/(127\.0\.0\.1|localhost):5274\//.test(requestUrl);
}

async function startNetworkCapture(page: Page) {
  await page.evaluate(() => {
    (window as unknown as { __buranRequests: string[] }).__buranRequests = [];
  });
  page.on('request', (request) => {
    const url = request.url();
    if (url.startsWith('data:') || url.startsWith('blob:')) return;
    if (url.startsWith('http://127.0.0.1:5274/') || url.startsWith('http://localhost:5274/')) {
      page.evaluate((requestUrl) => {
        (window as unknown as { __buranRequests: string[] }).__buranRequests.push(requestUrl);
      }, url).catch(() => {});
      return;
    }
    page.evaluate((requestUrl) => {
      (window as unknown as { __buranRequests: string[] }).__buranRequests.push(requestUrl);
    }, url).catch(() => {});
  });
}

type SmokeKind = 'JPEG' | 'PDF' | 'ZIP';

async function runFixture(page: Page, kind: SmokeKind) {
  await openAppReady(page);
  await startNetworkCapture(page);
  await uploadSmokeFile(page, kind);
  await expect(page.getByText('Отчёт BURAN')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Что BURAN нашёл в файле')).toBeVisible();
  await page.getByRole('button', { name: 'Удалить метаданные из файла' }).click();
  await expect(page.getByText('BURAN CLEAN VERIFIED')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('button', { name: 'Скачать чистую копию файла' })).toBeVisible();
}

async function uploadSmokeFile(page: Page, kind: SmokeKind) {
  const input = page.locator('input[type="file"]');
  if (kind === 'JPEG') {
    await input.setInputFiles(join(FIXTURES, 'sample.jpg'));
  } else if (kind === 'PDF') {
    await input.setInputFiles(join(FIXTURES, 'pdf-info.pdf'));
  } else {
    await input.setInputFiles({ name: 'smoke.zip', mimeType: 'application/zip', buffer: await makeZipFixture() });
  }
}

async function openAppReady(page: Page) {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.waitForFunction(() => {
    const video = document.querySelector('video');
    return !video || video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA;
  }, null, { timeout: 10_000 }).catch(() => {});
}

test.beforeEach(async ({ page }) => {
  await installPrivacyGuards(page);
});

test('JPEG fixture scans, cleans, verifies, and stays local', async ({ page }) => {
  await runFixture(page, 'JPEG');
  await expect(page.getByText(/GPS|камера|автор|Геолокация|Устройство/)).toBeVisible();
  await expectNoNetwork(page);
});

test('PDF fixture scans, verifies, and certificate download is available', async ({ page }, testInfo) => {
  await runFixture(page, 'PDF');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Скачать сертификат PDF' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('buran-clean-certificate.pdf');
  const path = await download.path();
  expect(path).toBeTruthy();
  const bytes = readFileSync(path!);
  const text = bytes.toString('latin1');
  expect(text.startsWith('%PDF-')).toBe(true);
  expect(text).toContain('/ToUnicode');
  expect(text).not.toContain('DEMO_FAKE_AUTHOR');
  expect(text).not.toContain('buran-demo.pdf');
  mkdirSync('test-artifacts', { recursive: true });
  const certificatePath = join(process.cwd(), 'test-artifacts', `certificate-03c-${testInfo.project.name}.pdf`);
  await download.saveAs(certificatePath);
  try {
    const viewer = await page.context().newPage();
    await viewer.goto(pathToFileURL(certificatePath).toString(), { waitUntil: 'domcontentloaded', timeout: 10_000 });
    await viewer.screenshot({ path: join(process.cwd(), 'test-artifacts', 'certificate-03c-chromium.png'), fullPage: true });
    await viewer.close();
  } catch {
    // Viewer rendering is environment-dependent; byte-level PDF validation above remains mandatory.
  }
  await expectNoNetwork(page);
});

test('ZIP fixture shows supported and unsupported entries, then verifies', async ({ page }) => {
  await openAppReady(page);
  await startNetworkCapture(page);
  await uploadSmokeFile(page, 'ZIP');
  await expect(page.getByRole('region', { name: 'Дерево ZIP-архива' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/будет очищен/)).toHaveCount(1);
  await expect(page.getByText(/Сохранён без изменений/)).toBeVisible();
  await page.getByRole('button', { name: 'Удалить метаданные из файла' }).click();
  await expect(page.getByText('BURAN CLEAN VERIFIED')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/fully anonymous|аноним/i)).toHaveCount(0);
  await expectNoNetwork(page);
});

test('HEIC fixture exports a verified clean JPEG or PNG locally', async ({ page }) => {
  test.setTimeout(90_000);
  await openAppReady(page);
  await startNetworkCapture(page);
  await page.locator('input[type="file"]').setInputFiles(join(FIXTURES, 'sample.heic'));
  await expect(page.getByText('Отчёт BURAN')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/HEIC \/ HEIF ·/)).toBeVisible();
  await expect(page.getByText('HEIC / HEIF поддерживается как чистый экспорт.')).toBeVisible();
  await page.getByRole('button', { name: 'Удалить метаданные из файла' }).click();
  await expect(page.getByText('BURAN CLEAN VERIFIED')).toBeVisible({ timeout: 45_000 });
  await expect(page.getByText('Личные метаданные исходного HEIC/HEIF не перенесены в экспорт.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Скачать чистую копию файла' })).toBeVisible();
  await expectNoNetwork(page);
});

test('blocked HEIF sequence has no output download', async ({ page }) => {
  await openAppReady(page);
  await startNetworkCapture(page);
  await page.locator('input[type="file"]').setInputFiles({ name: 'sequence.heic', mimeType: 'image/heic', buffer: makeFtyp(['msf1', 'heic', 'mif1']) });
  await expect(page.getByText('HEIC/HEIF sequence')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Скачать чистую копию файла' })).toHaveCount(0);
  await expectNoNetwork(page);
});

for (const label of ['JPEG', 'PDF', 'ZIP'] as const) {
  test(`${label} fixture can be cancelled without verified output`, async ({ page }) => {
    await openAppReady(page);
    await startNetworkCapture(page);
    await uploadSmokeFile(page, label);
    await page.getByRole('button', { name: 'Отменить обработку' }).click({ timeout: 10_000 });
    await expect(page.getByText('Обработка отменена.')).toBeVisible();
    await expect(page.getByText('Файл не был изменён и не покидал ваше устройство.')).toBeVisible();
    await expect(page.getByText('BURAN CLEAN VERIFIED')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Скачать чистую копию файла' })).toHaveCount(0);
    await expectNoNetwork(page);
  });
}

test('unsupported file shows unsupported state and no clean download', async ({ page }) => {
  await openAppReady(page);
  await startNetworkCapture(page);
  const input = page.locator('input[type="file"]');
  await input.setInputFiles({ name: 'unsupported.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
  await expect(page.getByText('Формат пока не поддерживается')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('button', { name: 'Скачать чистую копию файла' })).toHaveCount(0);
  await expectNoNetwork(page);
});

test('blocked malformed PDF is explicit and has no output download', async ({ page }) => {
  await openAppReady(page);
  await startNetworkCapture(page);
  const input = page.locator('input[type="file"]');
  await input.setInputFiles({ name: 'broken.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-not-valid') });
  await expect(page.getByRole('heading', { name: 'Не удалось разобрать файл' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Скачать чистую копию файла' })).toHaveCount(0);
  await expectNoNetwork(page);
});

test('mobile viewport has no horizontal overflow and CTA remains accessible', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'mobile-only assertion');
  await openAppReady(page);
  await startNetworkCapture(page);
  await uploadSmokeFile(page, 'JPEG');
  await expect(page.getByRole('button', { name: 'Удалить метаданные из файла' })).toBeVisible({ timeout: 15_000 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflow).toBe(false);
  await expectNoNetwork(page);
});

for (const fileName of ['office-sample.docx', 'office-sample.xlsx', 'office-sample.pptx']) {
  test(`${fileName} fixture scans, cleans, verifies, and offers output download`, async ({ page }) => {
    await openAppReady(page);
    await startNetworkCapture(page);
    await page.locator('input[type="file"]').setInputFiles(join(FIXTURES, fileName));
    await expect(page.getByText('Отчёт BURAN')).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Удалить метаданные из файла' }).click();
    await expect(page.getByText('BURAN CLEAN VERIFIED')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('button', { name: 'Скачать чистую копию файла' })).toBeVisible();
    await expectNoNetwork(page);
  });
}

declare global {
  interface Window {
    __buranNetworkCalls?: string[];
  }
}

function makeFtyp(brands: string[]): Buffer {
  const size = 16 + Math.max(0, brands.length - 1) * 4;
  const bytes = Buffer.alloc(size);
  bytes.writeUInt32BE(size, 0);
  bytes.write('ftyp', 4, 'ascii');
  bytes.write((brands[0] ?? 'heic').padEnd(4, ' ').slice(0, 4), 8, 'ascii');
  let offset = 16;
  for (const brand of brands.slice(1)) {
    bytes.write(brand.padEnd(4, ' ').slice(0, 4), offset, 'ascii');
    offset += 4;
  }
  return bytes;
}

async function makeZipFixture(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('photos/sample.png', makePngWithText(), { date: new Date('2024-01-01T00:00:00Z') });
  zip.file('docs/readme.txt', 'Synthetic unsupported smoke text. Preserved unchanged.\n', { date: new Date('2023-01-01T00:00:00Z') });
  const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', comment: 'SMOKE_ARCHIVE_COMMENT' });
  return Buffer.from(bytes);
}

function makePngWithText(): Uint8Array {
  const signature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = pngChunk('IHDR', new Uint8Array([0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]));
  const text = pngChunk('tEXt', new TextEncoder().encode('Comment\0PRIVATE_PNG_TEXT_DO_NOT_LEAK'));
  const idat = pngChunk('IDAT', new Uint8Array([0x78, 0x9c, 0x63, 0x60, 0x60, 0x00, 0x00, 0x00, 0x03, 0x00, 0x01]));
  const iend = pngChunk('IEND', new Uint8Array());
  const out = new Uint8Array(signature.length + ihdr.length + text.length + idat.length + iend.length);
  let offset = 0;
  for (const part of [signature, ihdr, text, idat, iend]) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.slice(4, 8 + data.length)));
  return out;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
