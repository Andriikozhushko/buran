import type { ScanResult, CleanResult, VerificationResult } from '../lib/formats/types';
import { formatToExtension, formatToMimeType } from '../lib/formats/detector';
import { buildSuccessBeforeAfter, formatLabel, successLimitations } from '../lib/trust-result';
import { useLocale } from '../i18n';
import type { Strings } from '../i18n';
import { Button } from './Button';

interface SuccessResultProps {
  scanResult: ScanResult;
  cleanResult: CleanResult;
  verification: VerificationResult;
  onReset: () => void;
}

export function SuccessResult({ scanResult, cleanResult, verification, onReset }: SuccessResultProps) {
  const { t, locale } = useLocale();
  const comparison = buildSuccessBeforeAfter(scanResult, verification, t);
  const limitations = successLimitations(scanResult, verification, t);
  const passed = verification.passed;

  const handleDownload = () => {
    const outputFormat = verification.heic?.exportedFormat ?? scanResult.format;
    const blob = new Blob([cleanResult.cleanBuffer], { type: formatToMimeType(outputFormat) });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = scanResult.format === 'zip' ? 'buran-clean.zip' : `${t.successDownloadFilename}.${formatToExtension(outputFormat)}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // Mobile browsers may not start reading the blob until after the click.
    // Keep it alive briefly so the downloaded image is not empty.
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  const handleCertificate = async () => {
    const { buildCertificateData, downloadCertificatePdf } = await import('../lib/certificate');
    const data = buildCertificateData(scanResult, verification, cleanResult.cleanHash, locale);
    await downloadCertificatePdf(data, t);
  };

  return (
    <section className="w-full h-full flex flex-col animate-fade-in min-h-0 py-1" aria-labelledby="success-title">
      <div className="flex-1 min-h-0 overflow-y-auto pr-1 -mr-1">
        <div className="text-center mb-3">
          <div className={`inline-flex items-center justify-center w-12 h-12 rounded-xl mb-3 animate-rise ring-1 ${passed ? 'bg-[#e8f1e8] ring-[#cfe3cf]' : 'bg-[#f8f0e2] ring-[#ecddc4]'}`}>
            <svg className={`w-6 h-6 ${passed ? 'text-[#357a3b]' : 'text-[#a9711f]'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
          </div>
          <h2 id="success-title" className="text-[20px] font-bold text-[#2b2b2b] tracking-tight">
            {passed ? t.successTitle : t.successBannerFail}
          </h2>
          <p className="text-[13px] text-[#7a7167] mt-1 max-w-md mx-auto leading-snug">
            {passed
              ? verification.heic
                ? t.successDescPassedHeic
                : t.successDescPassed
              : t.successDescFail}
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 mb-2.5">
          <BeforeAfterCard title={t.successBefore} items={comparison.before} tone="before" />
          <BeforeAfterCard title={t.successAfter} items={comparison.after} tone="after" />
        </div>

        <div className="bg-white rounded-xl border border-[#e6e6e6] shadow-[0_1px_2px_rgba(0,0,0,0.03)] px-4 py-3 mb-2.5 space-y-2">
          <Row label={t.successRowFormat} value={formatLabel(scanResult.format)} />
          <Row label={t.successRowFound} value={String(verification.metadataFoundBefore)} />
          <Row label={t.successRowRemaining} value={String(verification.metadataRemaining)} ok={verification.metadataRemaining === 0} />
          {scanResult.preservedInfo.iccDescription && <Row label={t.successRowColour} value={scanResult.preservedInfo.iccDescription} ok />}
          {verification.orientationApplied && <Row label={t.successRowOrientation} value={t.successOrientationApplied} ok />}
          {verification.pdf && <Row label={t.successRowPdfPages} value={verification.pdf.pageCountPreserved ? t.successPdfPagesPreserved : t.successPdfPagesNot} ok={verification.pdf.pageCountPreserved} />}
          {verification.office && <OfficeRows scanResult={scanResult} verification={verification} t={t} />}
          {verification.zip && <ZipRows verification={verification} t={t} />}
          {verification.heic && <HeicRows verification={verification} t={t} />}
          <Row label={t.successRowHash} value={cleanResult.cleanHash} mono />
          <Row label={t.successRowLocal} value={t.successLocalYes} ok />
        </div>

        <details className="bg-[#faf6ee] rounded-xl border border-l-[3px] border-[#ece0cb] border-l-[#c08a3e] px-4 py-3 mb-3">
          <summary className="cursor-pointer text-[13.5px] font-semibold text-[#6c4b26] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#9c6b3f] rounded-md">
            {t.successLimitTitle}
          </summary>
          <ul className="mt-2 text-[12.5px] text-[#7b6244] leading-relaxed list-disc pl-4 space-y-1">
            {limitations.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </details>
      </div>

      <div className="flex flex-wrap gap-2 justify-center flex-shrink-0 pt-2">
        <Button variant="primary" size="sm" onClick={handleDownload} aria-label={t.successDownloadAria}>
          {t.successDownload}
        </Button>
        <Button variant="secondary" size="sm" onClick={handleCertificate} aria-label={t.successCertButtonAria}>
          {t.successCertButton}
        </Button>
        <Button variant="ghost" size="sm" onClick={onReset}>{t.successReset}</Button>
      </div>
    </section>
  );
}

function BeforeAfterCard({ title, items, tone }: { title: string; items: string[]; tone: 'before' | 'after' }) {
  return (
    <div className={tone === 'after' ? 'bg-[#e8f1e8] rounded-xl border border-[#d3e6d3] p-4' : 'bg-white rounded-xl p-4 border border-[#e6e6e6] shadow-[0_1px_2px_rgba(0,0,0,0.03)]'}>
      <p className={`text-[11px] font-semibold uppercase tracking-wide mb-2 ${tone === 'after' ? 'text-[#357a3b]' : 'text-[#8a8a8a]'}`}>{title}</p>
      <ul className="space-y-1 text-[13px] text-[#2b2b2b] font-medium">
        {items.map((item) => <li key={item}>{item}</li>)}
      </ul>
    </div>
  );
}

function Row({ label, value, ok, mono }: { label: string; value: string; ok?: boolean; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-[13px] text-[#7a7a7a]">{label}</span>
      <span className={`text-[13px] font-semibold text-right break-all ${ok ? 'text-[#357a3b]' : 'text-[#2b2b2b]'} ${mono ? 'font-mono text-[11px]' : ''}`}>{value}</span>
    </div>
  );
}

function OfficeRows({ scanResult, verification, t }: { scanResult: ScanResult; verification: VerificationResult; t: Strings }) {
  const ov = verification.office;
  if (!ov) return null;
  const propsRemoved = ov.corePropertiesRemoved && ov.appPropertiesRemoved && ov.customPropertiesRemoved;
  return (
    <>
      <Row label={t.successOfficeProps} value={propsRemoved ? t.successOfficePropsRemoved : t.successOfficePropsNot} ok={propsRemoved} />
      {scanResult.office?.hasComments && <Row label={t.successOfficeCommentAuthors} value={ov.commentAuthorsAnonymised ? t.successOfficeCommentAuthorsAnon : t.successOfficePropsNot} ok={ov.commentAuthorsAnonymised} />}
      {scanResult.office?.hasRevisions && <Row label={t.successOfficeRevisions} value={ov.revisionMetadataRemoved ? t.successOfficeRevisionsCleaned : t.successOfficePropsNot} ok={ov.revisionMetadataRemoved} />}
    </>
  );
}

function HeicRows({ verification, t }: { verification: VerificationResult; t: Strings }) {
  const hv = verification.heic;
  if (!hv) return null;
  return (
    <>
      <Row label={t.successHeicExport} value={hv.exportedFormat === 'png' ? 'PNG' : 'JPEG'} ok />
      <Row label={t.successHeicSourceMeta} value={t.successHeicSourceNotTransferred} ok={!hv.personalMetadataTransferred} />
      <Row label={t.successHeicColour} value={hv.colourHandling} />
    </>
  );
}

function ZipRows({ verification, t }: { verification: VerificationResult; t: Strings }) {
  const zv = verification.zip;
  if (!zv) return null;
  return (
    <>
      <Row label={t.successZipTimestamps} value={zv.timestampsNormalised ? t.successZipTimestampsNeutralised : t.successNotConfirmed} ok={zv.timestampsNormalised} />
      <Row label={t.successZipSupported} value={`${zv.supportedEntriesVerified} ${t.successZipSupportedVerified}`} ok={zv.supportedEntriesFailed === 0} />
      <Row label={t.successZipUnsupported} value={`${zv.unsupportedEntriesUnchanged} ${t.successZipUnsupportedUnchanged}`} ok />
    </>
  );
}
