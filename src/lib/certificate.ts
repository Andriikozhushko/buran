import type { ScanResult, VerificationResult } from './formats/types';
import type { Strings } from '../i18n';
import { formatToDisplayName } from './formats/detector';
import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import robotoVfs from 'pdfmake/build/vfs_fonts';
// Real brand assets, inlined at build time as data URIs so the certificate
// generator never touches the network (privacy guard forbids fetch in src).
import logoDataUri from '../assets/buran-logo-embed.png?inline';
import backgroundDataUri from '../assets/buran-bg.jpg?inline';
import stampDataUri from '../assets/buran-stamp.png?inline';
import pawSignDataUri from '../assets/buran-pawsign.png?inline';
// Noto Sans Armenian (Armenian subset) for the certificate PDF — Roboto lacks
// Armenian glyphs, so Armenian text is drawn per-character from these fonts.
import notoArmenianRegular from '@fontsource/noto-sans-armenian/files/noto-sans-armenian-armenian-400-normal.woff?inline';
import notoArmenianMedium from '@fontsource/noto-sans-armenian/files/noto-sans-armenian-armenian-700-normal.woff?inline';

/** Armenian Unicode ranges: letters + ligatures. */
const ARMENIAN_RE = /[԰-֏ﬓ-ﬗ]/;

const ROBOTO_REGULAR = (robotoVfs as unknown as Record<string, string>)['Roboto-Regular.ttf'];
const ROBOTO_MEDIUM = (robotoVfs as unknown as Record<string, string>)['Roboto-Medium.ttf'];

export interface CertificateData {
  /** Active UI locale — drives date formatting and Armenian font fallback. */
  locale: string;
  fileType: string;
  scanDateTime: string;
  metadataFound: number;
  metadataRemoved: number;
  metadataRemaining: number;
  verificationPassed: boolean;
  colourProfile: string | null;
  cleanHash: string;
  shortHash: string;
  processedLocally: boolean;
  orientationApplied: boolean;
  pixelDataReencoded: boolean;
  /** PDF-only: pages preserved as "N из N", or null for images. */
  pdfPages: string | null;
  /** PDF-only: whether document structure (pages + geometry) was verified. */
  pdfStructureVerified: boolean | null;
  /** Office-only fields (null for non-Office). */
  office: {
    propertiesRemoved: boolean;
    commentAuthorsAnonymised: boolean | null;
    revisionMetadataRemoved: boolean | null;
    embeddedImagesVerified: string | null;
    structureVerified: boolean;
  } | null;
  zip: {
    totalEntries: number;
    supportedEntriesCleaned: number;
    unsupportedEntriesPreserved: number;
    archiveTimestampsNeutralised: boolean;
    zipCommentRemoved: boolean;
    nestedArchiveCount: number;
    limitations: string[];
  } | null;
  heic: {
    exportedFormat: 'jpeg' | 'png';
    colourHandling: string;
  } | null;
}

export function buildCertificateData(
  scanResult: ScanResult,
  verification: VerificationResult,
  cleanHash: string,
  locale: string,
): CertificateData {
  const now = new Date();
  const scanDateTime = now.toLocaleString(toBcp47(locale), {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short',
  });

  const isPdf = scanResult.format === 'pdf';
  const isOffice =
    scanResult.format === 'docx' || scanResult.format === 'xlsx' || scanResult.format === 'pptx';
  const isZip = scanResult.format === 'zip';
  const isHeic = scanResult.format === 'heic';

  // Removed = found − remaining. Honest and uniform across formats. The
  // certificate carries only counts and the output hash — never any original
  // metadata value.
  const metadataFound = verification.metadataFoundBefore;
  const metadataRemoved = Math.max(0, metadataFound - verification.metadataRemaining);

  const pdfPages =
    isPdf && scanResult.pdf ? `${scanResult.pdf.pageCount} / ${scanResult.pdf.pageCount}` : null;
  const pdfStructureVerified = isPdf
    ? !!(verification.pdf?.pageCountPreserved && verification.pdf?.pageGeometryPreserved)
    : null;

  return {
    locale,
    fileType: formatToDisplayName(scanResult.format),
    scanDateTime,
    metadataFound,
    metadataRemoved,
    metadataRemaining: verification.metadataRemaining,
    verificationPassed: verification.passed,
    colourProfile: isPdf || isHeic ? null : scanResult.preservedInfo.iccDescription || null,
    cleanHash,
    shortHash: cleanHash.substring(0, 16) + '…',
    processedLocally: verification.processedLocally,
    orientationApplied: verification.orientationApplied,
    pixelDataReencoded: verification.pixelDataReencoded,
    pdfPages,
    pdfStructureVerified,
    office:
      isOffice && verification.office
        ? {
            propertiesRemoved:
              verification.office.corePropertiesRemoved &&
              verification.office.appPropertiesRemoved &&
              verification.office.customPropertiesRemoved,
            commentAuthorsAnonymised: scanResult.office?.hasComments
              ? verification.office.commentAuthorsAnonymised
              : null,
            revisionMetadataRemoved: scanResult.office?.hasRevisions
              ? verification.office.revisionMetadataRemoved
              : null,
            embeddedImagesVerified:
              (scanResult.office?.embeddedImages.length ?? 0) > 0
                ? `${verification.office.embeddedImagesVerified} / ${scanResult.office?.embeddedImages.length}`
                : null,
            structureVerified: verification.office.verificationPassed,
          }
        : null,
    zip:
      isZip && scanResult.zip && verification.zip
        ? {
            totalEntries: scanResult.zip.totalEntries,
            supportedEntriesCleaned: verification.zip.supportedEntriesVerified,
            unsupportedEntriesPreserved: verification.zip.unsupportedEntriesUnchanged,
            archiveTimestampsNeutralised: verification.zip.timestampsNormalised,
            zipCommentRemoved: verification.zip.archiveCommentRemoved,
            nestedArchiveCount: verification.zip.nestedArchivesVerified,
            limitations: verification.zip.remainingUnsupportedMetadataRisk,
          }
        : null,
    heic:
      isHeic && verification.heic
        ? {
            exportedFormat: verification.heic.exportedFormat,
            colourHandling: verification.heic.colourHandling,
          }
        : null,
  };
}

/** Horizontal, course-style certificate as a self-contained printable page. */
export function generateCertificateHtml(data: CertificateData, t: Strings): string {
  const passed = data.verificationPassed;
  const context = formatContextLine(data, t);
  const statusLabel = passed ? t.certStatVerified : t.certStatFailed;

  // Real grunge verification stamp and Buran's paw-print signature.
  const seal = `<img class="stamp" src="${stampDataUri}" alt="">`;
  const signature = `<img class="paw-sign" src="${pawSignDataUri}" alt="">`;

  const check = passed
    ? `<span class="badge-check"><svg viewBox="0 0 24 24"><path d="M5 13l4 4 10-12" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg></span>`
    : `<span class="stat-dash">—</span>`;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>BURAN — ${esc(t.certTitle)}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    :root {
      --ink: #1c1e2e; --muted: #6a6d7c; --faint: #9a9da8;
      --accent: #2e5c8a; --accent-soft: #8db1cf; --gold: #ad873b; --gold-soft: #d4b870;
      --ok: #2f7d57; --paper: #fbfaf4; --panel: #f3f6fb;
    }
    html, body { background: #e9e8e2; }
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      color: var(--ink);
      display: flex; align-items: center; justify-content: center;
      min-height: 100vh; padding: 24px;
    }
    .page {
      position: relative;
      width: 1086px; height: 768px;
      background: var(--paper);
      box-shadow: 0 12px 40px rgba(0,0,0,0.18);
      overflow: hidden;
    }
    .frame-outer { position: absolute; inset: 22px; border: 2px solid var(--accent); }
    .frame-inner { position: absolute; inset: 29px; border: 0.8px solid var(--gold-soft); }
    .corner { position: absolute; width: 22px; height: 22px; }
    .corner::before, .corner::after { content: ''; position: absolute; background: var(--gold); }
    .corner::before { width: 100%; height: 1.2px; }
    .corner::after { width: 1.2px; height: 100%; }
    .corner.tl { top: 37px; left: 37px; }
    .corner.tr { top: 37px; right: 37px; }
    .corner.tr::before { right: 0; } .corner.tr::after { right: 0; }
    .corner.bl { bottom: 37px; left: 37px; }
    .corner.bl::before { bottom: 0; } .corner.bl::after { bottom: 0; }
    .corner.br { bottom: 37px; right: 37px; }
    .corner.br::before { right: 0; bottom: 0; } .corner.br::after { right: 0; bottom: 0; }

    .bg-photo {
      position: absolute; top: 50%; left: 50%; transform: translate(-50%, -48%);
      width: 720px; height: auto; opacity: 0.1; pointer-events: none;
    }
    .content {
      position: absolute; inset: 56px; text-align: center;
      display: flex; flex-direction: column; align-items: center;
    }
    .logo { height: 56px; width: auto; object-fit: contain; }
    .logo-fallback { font-size: 30px; font-weight: 800; letter-spacing: 4px; }
    .logo-fallback span { color: var(--accent); }
    .tagline { font-size: 9.5px; letter-spacing: 2.5px; color: var(--faint); margin-top: 8px; }

    .title { font-size: 33px; font-weight: 800; letter-spacing: 1px; margin-top: 18px; }
    .subtitle { font-size: 12px; letter-spacing: 5px; color: var(--muted); margin-top: 6px; }
    .divider { display: flex; align-items: center; gap: 10px; margin: 16px 0 4px; }
    .divider .line { width: 150px; height: 1.2px; background: var(--accent); }
    .divider .diamond { width: 8px; height: 8px; background: var(--gold); transform: rotate(45deg); }

    .statement { font-size: 15px; line-height: 1.7; margin-top: 8px; max-width: 760px; }
    .statement b { font-weight: 700; }

    .stats { display: flex; justify-content: center; gap: 0; margin-top: 22px; }
    .stat { width: 175px; padding: 0 6px; position: relative; }
    .stat + .stat::before { content: ''; position: absolute; left: 0; top: 8px; bottom: 14px; width: 1px; background: #d9dde3; }
    .stat .value { font-size: 38px; font-weight: 800; line-height: 1; }
    .stat .value.accent { color: var(--accent); }
    .stat .value.ok { color: var(--ok); }
    .stat .label { font-size: 9.5px; letter-spacing: 1.5px; color: var(--muted); margin-top: 8px; font-weight: 600; }
    .badge-check { display: inline-flex; align-items: center; justify-content: center; width: 38px; height: 38px; border-radius: 50%; background: var(--ok); }
    .badge-check svg { width: 22px; height: 22px; }
    .stat-dash { font-size: 38px; font-weight: 800; color: var(--ok); }

    .context { font-size: 11.5px; color: var(--muted); margin-top: 16px; }
    .hash-panel {
      margin-top: 16px; width: 760px; padding: 10px 16px;
      background: var(--panel); border: 0.8px solid #d7e0ea; border-radius: 6px;
    }
    .hash-panel .h-label { font-size: 8.5px; letter-spacing: 2px; color: var(--muted); font-weight: 600; }
    .hash-panel .h-value { font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 12.5px; margin-top: 4px; word-break: break-all; }
    .meta-date { font-size: 11px; color: var(--muted); margin-top: 12px; }
    .local-note { font-size: 12px; margin-top: 10px; font-weight: 600; }
    .local-note.ok { color: var(--ok); }

    .signoff {
      position: absolute; left: 56px; right: 56px; bottom: 78px;
      display: flex; align-items: flex-end; justify-content: space-between;
    }
    .stamp { width: 124px; height: 124px; object-fit: contain; }
    .sign-block { text-align: center; width: 220px; }
    .paw-sign { width: 86px; height: 86px; object-fit: contain; display: block; margin: 0 auto -4px; }
    .sign-line { border-top: 1px solid #b3b6bf; padding-top: 6px; }
    .sign-name { font-size: 12px; font-weight: 700; }
    .sign-role { font-size: 9.5px; color: var(--muted); margin-top: 2px; }

    .footer {
      position: absolute; left: 56px; right: 56px; bottom: 34px;
      border-top: 0.8px solid #dfe3e8; padding-top: 8px;
      font-size: 8.5px; line-height: 1.5; color: var(--faint); text-align: center;
    }

    @page { size: A4 landscape; margin: 0; }
    @media print {
      html, body { background: #ffffff; padding: 0; }
      .page { box-shadow: none; width: 297mm; height: 210mm; }
    }
  </style>
</head>
<body>
  <div class="page">
    <div class="frame-outer"></div>
    <div class="frame-inner"></div>
    <span class="corner tl"></span><span class="corner tr"></span>
    <span class="corner bl"></span><span class="corner br"></span>

    <img class="bg-photo" src="${backgroundDataUri}" alt="">


    <div class="content">
      <img class="logo" src="/buran-logo.png" alt="BURAN" onerror="this.outerHTML='&lt;div class=&quot;logo-fallback&quot;&gt;BUR&lt;span&gt;AN&lt;/span&gt;&lt;/div&gt;'">
      <div class="tagline">${esc(t.certTagline)}</div>

      <h1 class="title">${esc(t.certTitle)}</h1>
      <div class="subtitle">${esc(t.certSubtitle)}</div>
      <div class="divider"><span class="line"></span><span class="diamond"></span><span class="line"></span></div>

      <p class="statement">
        ${interpolate(esc(t.certStatementLine1), { type: `<b>${esc(data.fileType)}</b>` })}<br>
        ${esc(t.certStatementLine2)}
      </p>

      <div class="stats">
        <div class="stat"><div class="value">${data.metadataFound}</div><div class="label">${esc(t.certStatFound)}</div></div>
        <div class="stat"><div class="value accent">${data.metadataRemoved}</div><div class="label">${esc(t.certStatRemoved)}</div></div>
        <div class="stat"><div class="value ${data.metadataRemaining === 0 ? 'ok' : ''}">${data.metadataRemaining}</div><div class="label">${esc(t.certStatRemaining)}</div></div>
        <div class="stat"><div class="value">${check}</div><div class="label">${esc(statusLabel)}</div></div>
      </div>

      ${context ? `<div class="context">${esc(context)}</div>` : ''}

      <div class="hash-panel">
        <div class="h-label">${esc(t.certShaLabel)}</div>
        <div class="h-value">${esc(data.cleanHash)}</div>
      </div>

      <div class="meta-date">${interpolate(esc(t.certDateLabel), { date: esc(data.scanDateTime) })}</div>
      <div class="local-note ${data.processedLocally ? 'ok' : ''}">
        ${data.processedLocally ? esc(t.certLocalNote) : esc(t.certLocalNotUnconfirmed)}
      </div>
    </div>

    <div class="signoff">
      ${seal}
      <div class="sign-block">
        ${signature}
        <div class="sign-line">
          <div class="sign-name">${esc(t.certSignName)}</div>
          <div class="sign-role">${esc(t.certSignCaption)}</div>
        </div>
      </div>
    </div>

    <div class="footer">
      ${esc(t.certFooter1)}<br>
      ${esc(t.certFooter2)}
    </div>
  </div>
</body>
</html>`;
}

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Replace `{key}` placeholders in a localized template string. */
function interpolate(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key) =>
    Object.prototype.hasOwnProperty.call(values, key) ? values[key] : match,
  );
}

/** Map an app locale code to a BCP-47 tag for Intl/toLocaleString. */
function toBcp47(locale: string): string {
  if (locale === 'hy') return 'hy-AM';
  return locale;
}

export async function downloadCertificatePdf(data: CertificateData, t: Strings): Promise<void> {
  const blob = await generateCertificatePdfBlob(data, t);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'buran-clean-certificate.pdf';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function generateCertificatePdfBlob(data: CertificateData, t: Strings): Promise<Blob> {
  const bytes = await generateCertificatePdfBytes(data, t);
  return new Blob([toArrayBuffer(bytes)], { type: 'application/pdf' });
}

// Horizontal, course-style certificate. Landscape A4 (842 × 595 pt) with an
// ornamented double frame, the real BURAN logo, a faint photo of Buran from the
// site video as a backdrop, a paw-print verification seal, and an engine
// "signature". Everything is embedded from build-time assets — no network.
export async function generateCertificatePdfBytes(data: CertificateData, t: Strings): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  pdf.setTitle('BURAN Clean Certificate');
  pdf.setSubject(t.certPdfSubject);
  pdf.setCreator('BURAN');
  pdf.setProducer('BURAN local browser PDF generator');

  const regular = await pdf.embedFont(base64ToBytes(ROBOTO_REGULAR));
  const medium = await pdf.embedFont(base64ToBytes(ROBOTO_MEDIUM));

  // Armenian glyphs are missing from Roboto. For the Armenian locale, embed
  // Noto Sans Armenian and fall back to it per-character (Latin/digits/hash
  // still come from Roboto). Other locales skip this entirely.
  const isArmenian = data.locale === 'hy';
  const armRegular = isArmenian
    ? await pdf.embedFont(dataUriToBytes(notoArmenianRegular), { subset: true })
    : null;
  const armMedium = isArmenian
    ? await pdf.embedFont(dataUriToBytes(notoArmenianMedium), { subset: true })
    : null;
  const armFor = (font: typeof regular): typeof regular | null =>
    font === medium ? armMedium : armRegular;

  const logoImg = await pdf.embedPng(dataUriToBytes(logoDataUri));
  const bgImg = await pdf.embedJpg(dataUriToBytes(backgroundDataUri));
  const stampImg = await pdf.embedPng(dataUriToBytes(stampDataUri));
  const pawImg = await pdf.embedPng(dataUriToBytes(pawSignDataUri));

  const W = 842;
  const H = 595;
  const page = pdf.addPage([W, H]);

  const ink = rgb(0.11, 0.12, 0.18);
  const muted = rgb(0.42, 0.44, 0.52);
  const faint = rgb(0.62, 0.64, 0.7);
  const accent = rgb(0.18, 0.36, 0.54);
  const gold = rgb(0.68, 0.53, 0.23);
  const goldSoft = rgb(0.83, 0.72, 0.44);
  const paper = rgb(0.993, 0.991, 0.984);
  const panel = rgb(0.965, 0.975, 0.99);
  const white = rgb(1, 1, 1);
  const ok = data.verificationPassed ? rgb(0.2, 0.49, 0.35) : rgb(0.62, 0.42, 0.22);

  const cx = W / 2;
  const center = (text: string, y: number, size: number, font: typeof regular, color = ink, spacing = 0) =>
    drawCenteredText(page, text, cx, y, size, font, color, spacing, armFor(font));

  // Paper, then a faint photo of Buran as a backdrop, then the double frame.
  page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: paper });
  const bgW = 660;
  const bgH = (bgImg.height / bgImg.width) * bgW;
  page.drawImage(bgImg, { x: cx - bgW / 2, y: (H - bgH) / 2 + 6, width: bgW, height: bgH, opacity: 0.1 });
  page.drawRectangle({ x: 22, y: 22, width: W - 44, height: H - 44, borderColor: accent, borderWidth: 2 });
  page.drawRectangle({ x: 29, y: 29, width: W - 58, height: H - 58, borderColor: goldSoft, borderWidth: 0.8 });
  drawCornerFlourishes(page, 29, 29, W - 58, H - 58, gold);

  // Real BURAN logo at the top.
  const logoH = 64;
  const logoW = (logoImg.width / logoImg.height) * logoH;
  page.drawImage(logoImg, { x: cx - logoW / 2, y: H - 96, width: logoW, height: logoH });
  center(t.certTagline, H - 110, 7.5, regular, faint, 1.5);

  // Title.
  center(t.certTitle, H - 142, 25, medium, ink, 0.5);
  center(t.certSubtitle, H - 162, 10, regular, muted, 2.5);
  drawDivider(page, cx, H - 178, accent, gold);

  // Statement.
  center(interpolate(t.certStatementLine1, { type: data.fileType }), H - 200, 12, regular, ink);
  center(t.certStatementLine2, H - 218, 12, regular, ink);

  // Key statistics strip.
  const stats: Array<{ value: string; label: string; color: typeof ink; check?: boolean }> = [
    { value: String(data.metadataFound), label: t.certStatFound, color: ink },
    { value: String(data.metadataRemoved), label: t.certStatRemoved, color: accent },
    { value: String(data.metadataRemaining), label: t.certStatRemaining, color: data.metadataRemaining === 0 ? ok : ink },
    { value: '', label: data.verificationPassed ? t.certStatVerified : t.certStatFailed, color: ok, check: true },
  ];
  const stripLeft = 180;
  const stripRight = W - 180;
  const step = (stripRight - stripLeft) / (stats.length - 1);
  stats.forEach((s, i) => {
    const x = stripLeft + step * i;
    if (s.check) {
      if (data.verificationPassed) drawCheck(page, x, H - 258, 13, ok, white);
      else center('-', H - 268, 26, medium, ok);
    } else {
      drawCenteredText(page, s.value, x, H - 270, 27, medium, s.color, 0, armFor(medium));
    }
    drawCenteredText(page, s.label, x, H - 288, 7.5, medium, muted, 1.2, armFor(medium));
    if (i < stats.length - 1) {
      page.drawLine({ start: { x: x + step / 2, y: H - 288 }, end: { x: x + step / 2, y: H - 258 }, thickness: 0.6, color: rgb(0.85, 0.87, 0.9) });
    }
  });

  // Format-specific context line.
  const context = formatContextLine(data, t);
  if (context) center(context, H - 308, 9, regular, muted);

  // SHA-256 panel.
  const panelW = 600;
  const panelX = cx - panelW / 2;
  const panelY = H - 360;
  page.drawRectangle({ x: panelX, y: panelY, width: panelW, height: 44, color: panel, borderColor: rgb(0.84, 0.88, 0.93), borderWidth: 0.7 });
  center(t.certShaLabel, panelY + 30, 7, medium, muted, 1.5);
  center(data.cleanHash, panelY + 12, 9, regular, ink);

  center(interpolate(t.certDateLabel, { date: data.scanDateTime }), H - 378, 9, regular, muted);
  center(data.processedLocally ? t.certLocalNote : t.certLocalNotUnconfirmed, H - 410, 9.5, regular, data.processedLocally ? ok : muted);

  // Verification stamp (left) and Buran's paw signature (right).
  const stampSize = 122;
  page.drawImage(stampImg, { x: 172 - stampSize / 2, y: 122 - stampSize / 2, width: stampSize, height: stampSize });
  const pawSize = 90;
  const pawW = (pawImg.width / pawImg.height) * pawSize;
  page.drawImage(pawImg, { x: 648 - pawW / 2, y: 98, width: pawW, height: pawSize });
  page.drawLine({ start: { x: 562, y: 94 }, end: { x: 734, y: 94 }, thickness: 0.8, color: rgb(0.7, 0.72, 0.78) });
  drawCenteredText(page, t.certSignName, 648, 80, 9, medium, ink, 0, armFor(medium));
  drawCenteredText(page, t.certSignCaption, 648, 69, 7.5, regular, muted, 0, armFor(regular));

  // Footer scope notice.
  page.drawLine({ start: { x: 60, y: 58 }, end: { x: W - 60, y: 58 }, thickness: 0.6, color: rgb(0.86, 0.89, 0.92) });
  center(t.certFooter1, 46, 7.5, regular, faint);
  center(t.certFooter2, 36, 7.5, regular, faint);

  return pdf.save({ useObjectStreams: false });
}

export function certificatePdfFilename(): string {
  return 'buran-clean-certificate.pdf';
}

/** A single, human-readable line summarising format-specific guarantees. */
function formatContextLine(data: CertificateData, t: Strings): string | null {
  if (data.pdfPages) {
    return (
      interpolate(t.certCtxPdf, { pages: data.pdfPages }) +
      (data.pdfStructureVerified ? t.certCtxPdfStructure : '')
    );
  }
  if (data.office) {
    const parts = [
      data.office.propertiesRemoved ? t.certCtxOfficePropsRemoved : t.certCtxOfficePropsNot,
    ];
    if (data.office.commentAuthorsAnonymised) parts.push(t.certCtxOfficeCommentsAnon);
    if (data.office.revisionMetadataRemoved) parts.push(t.certCtxOfficeRevisions);
    if (data.office.structureVerified) parts.push(t.certCtxOfficeStructure);
    return t.certCtxOfficePrefix + parts.join(' · ');
  }
  if (data.zip) {
    return interpolate(t.certCtxZip, {
      cleaned: String(data.zip.supportedEntriesCleaned),
      preserved: String(data.zip.unsupportedEntriesPreserved),
    });
  }
  if (data.heic) {
    return interpolate(t.certCtxHeic, { format: data.heic.exportedFormat.toUpperCase() });
  }
  const bits: string[] = [];
  if (data.orientationApplied) bits.push(t.certCtxImageOrientation);
  if (data.pixelDataReencoded) bits.push(t.certCtxImageReencoded);
  if (data.colourProfile) bits.push(t.certCtxImageColour);
  return bits.length ? bits.join(' · ') : null;
}

function drawCenteredText(
  page: ReturnType<PDFDocument['addPage']>,
  text: string,
  cx: number,
  y: number,
  size: number,
  font: Awaited<ReturnType<PDFDocument['embedFont']>>,
  color: ReturnType<typeof rgb>,
  spacing = 0,
  armFont: Awaited<ReturnType<PDFDocument['embedFont']>> | null = null,
): void {
  // Per-character drawing is required when letter-spacing is set, or when the
  // text mixes Armenian (drawn from armFont) with Latin/digits (drawn from font).
  const needsFallback = armFont !== null && ARMENIAN_RE.test(text);
  if (spacing > 0 || needsFallback) {
    const chars = [...text];
    const fontFor = (ch: string) => (armFont && ARMENIAN_RE.test(ch) ? armFont : font);
    const widths = chars.map((ch) => fontFor(ch).widthOfTextAtSize(ch, size) + spacing);
    const total = widths.reduce((a, b) => a + b, 0) - (chars.length > 0 ? spacing : 0);
    let x = cx - total / 2;
    chars.forEach((ch, i) => {
      page.drawText(ch, { x, y, size, font: fontFor(ch), color });
      x += widths[i];
    });
    return;
  }
  const width = font.widthOfTextAtSize(text, size);
  page.drawText(text, { x: cx - width / 2, y, size, font, color });
}

function drawDivider(
  page: ReturnType<PDFDocument['addPage']>,
  cx: number,
  y: number,
  accent: ReturnType<typeof rgb>,
  gold: ReturnType<typeof rgb>,
): void {
  page.drawLine({ start: { x: cx - 130, y }, end: { x: cx - 12, y }, thickness: 1, color: accent });
  page.drawLine({ start: { x: cx + 12, y }, end: { x: cx + 130, y }, thickness: 1, color: accent });
  page.drawSvgPath('M 0 -4 L 4 0 L 0 4 L -4 0 Z', { x: cx, y, color: gold, borderColor: gold });
}

function drawCornerFlourishes(
  page: ReturnType<PDFDocument['addPage']>,
  x: number,
  y: number,
  w: number,
  h: number,
  gold: ReturnType<typeof rgb>,
): void {
  const arm = 16;
  const inset = 8;
  const corners: Array<[number, number, number, number]> = [
    [x + inset, y + inset, 1, 1],
    [x + w - inset, y + inset, -1, 1],
    [x + inset, y + h - inset, 1, -1],
    [x + w - inset, y + h - inset, -1, -1],
  ];
  for (const [px, py, sx, sy] of corners) {
    page.drawLine({ start: { x: px, y: py }, end: { x: px + arm * sx, y: py }, thickness: 1, color: gold });
    page.drawLine({ start: { x: px, y: py }, end: { x: px, y: py + arm * sy }, thickness: 1, color: gold });
    page.drawCircle({ x: px, y: py, size: 1.6, color: gold });
  }
}

function drawCheck(
  page: ReturnType<PDFDocument['addPage']>,
  cx: number,
  cy: number,
  r: number,
  color: ReturnType<typeof rgb>,
  white: ReturnType<typeof rgb>,
): void {
  page.drawCircle({ x: cx, y: cy, size: r, color });
  page.drawCircle({ x: cx, y: cy, size: r + 2.5, borderColor: color, borderWidth: 0.8 });
  page.drawSvgPath('M -5 0 L -1 5 L 6 -5', { x: cx, y: cy, borderColor: white, borderWidth: 1.8 });
}

/** Decode a `data:...;base64,XXXX` URI (build-time inlined asset) to bytes. */
function dataUriToBytes(uri: string): Uint8Array {
  return base64ToBytes(uri.slice(uri.indexOf(',') + 1));
}

function base64ToBytes(value: string): Uint8Array {
  if (typeof atob === 'function') {
    const binary = atob(value);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  }
  return Uint8Array.from(Buffer.from(value, 'base64'));
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

/**
 * Print a certificate locally via a hidden iframe. Falls back to a popup window.
 */
export function printCertificate(html: string): void {
  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = 'none';
  document.body.appendChild(iframe);

  const doc = iframe.contentDocument || iframe.contentWindow?.document;
  if (!doc) {
    document.body.removeChild(iframe);
    return;
  }

  doc.open();
  doc.write(html);
  doc.close();

  iframe.onload = () => {
    try {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    } catch {
      const win = window.open('', '_blank', 'width=700,height=900');
      if (win) {
        win.document.write(html);
        win.document.close();
        win.print();
      }
    }
    setTimeout(() => document.body.removeChild(iframe), 1000);
  };
}
