import type { ScanResult, VerificationResult } from '../lib/formats/types';
import { buildCertificateData, generateCertificateHtml } from '../lib/certificate';
import { useLocale } from '../i18n';
import { Button } from './Button';

interface CertificateProps {
  scanResult: ScanResult;
  verification: VerificationResult;
  cleanHash: string;
}

export function Certificate({ scanResult, verification, cleanHash }: CertificateProps) {
  const { t, locale } = useLocale();
  const data = buildCertificateData(scanResult, verification, cleanHash, locale);
  const certificateHtml = generateCertificateHtml(data, t);

  const handlePrint = () => {
    // Create a hidden iframe to print just the certificate
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.top = '0';
    iframe.style.left = '0';
    iframe.style.width = '100%';
    iframe.style.height = '100%';
    iframe.style.border = 'none';
    iframe.style.zIndex = '9999';
    document.body.appendChild(iframe);

    const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!iframeDoc) {
      document.body.removeChild(iframe);
      return;
    }

    iframeDoc.open();
    iframeDoc.write(certificateHtml);
    iframeDoc.close();

    iframe.onload = () => {
      try {
        iframe.contentWindow?.print();
      } catch {
        // Fallback: open in new window
        const win = window.open('', '_blank', 'width=700,height=900');
        if (win) {
          win.document.write(certificateHtml);
          win.document.close();
          win.print();
        }
      }
      // Remove iframe after print dialog
      setTimeout(() => {
        document.body.removeChild(iframe);
      }, 1000);
    };
  };

  return (
    <div className="w-full max-w-2xl mx-auto mt-4">
      <div className="bg-white rounded-3xl shadow-[0_2px_20px_rgba(0,0,0,0.05)] p-6">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-[17px] font-extrabold text-[#2b2b2b]">{t.certificateTitle}</h3>
          <Button variant="secondary" size="sm" onClick={handlePrint}>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6.72 13.829c-.24.03-.48.062-.72.096m.72-.096a42.415 42.415 0 0110.56 0m-10.56 0L6.34 18m10.94-4.171c.24.03.48.062.72.096m-.72-.096L17.66 18m0 0l.229 2.523a1.125 1.125 0 01-1.12 1.227H7.231c-.662 0-1.18-.568-1.12-1.227L6.34 18m11.318 0h1.091A2.25 2.25 0 0021 15.75V9.456c0-1.081-.768-2.015-1.837-2.175a48.055 48.055 0 00-1.913-.247M6.34 18H5.25A2.25 2.25 0 013 15.75V9.456c0-1.081.768-2.015 1.837-2.175a48.041 48.041 0 011.913-.247m10.5 0a48.536 48.536 0 00-10.5 0m10.5 0V3.375c0-.621-.504-1.125-1.125-1.125h-8.25c-.621 0-1.125.504-1.125 1.125v3.659M18 10.5h.008v.008H18V10.5zm-3 0h.008v.008H15V10.5z" />
            </svg>
            {t.certificatePrint}
          </Button>
        </div>

        {/* Certificate preview */}
        <div className="bg-[#fafafa] rounded-2xl p-5 space-y-3">
          <CertRow label={t.certificateFileType} value={data.fileType} />
          <CertRow label={t.certificateDateTime} value={data.scanDateTime} small />
          <CertRow label={t.certificateFound} value={String(data.metadataFound)} />
          <CertRow label={t.certificateRemoved} value={String(data.metadataRemoved)} green />
          <CertRow
            label={t.certificateRemaining}
            value={String(data.metadataRemaining)}
            green={data.metadataRemaining === 0}
          />
          <CertRow label={t.certificateVerification} value={t.verifyPassed} green />
          {data.orientationApplied && <CertRow label={t.successOrientationFixed} value="Применена" />}
          {data.pixelDataReencoded && <CertRow label="Метод обработки" value="Пересобрана JPEG-копия" small />}
          {data.colourProfile && (
            <CertRow label={t.certificateColourProfile} value={data.colourProfile} small />
          )}
          <CertRow label={t.certificateHash} value={data.shortHash} mono />
          <CertRow label={t.certificateProcessedLocally} value={t.verifyYes} green />
        </div>

        <p className="text-[12px] text-[#9a9a9a] mt-4 leading-relaxed">
          {t.certificateScopeShort}
        </p>
      </div>
    </div>
  );
}

function CertRow({
  label,
  value,
  green,
  small,
  mono,
}: {
  label: string;
  value: string;
  green?: boolean;
  small?: boolean;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[13px] text-[#8a8a8a] flex-shrink-0">{label}</span>
      <span
        className={`font-semibold text-right ${green ? 'text-[#3e8a43]' : 'text-[#2b2b2b]'} ${
          mono ? 'font-mono text-[12px]' : small ? 'text-[12px]' : 'text-[13.5px]'
        }`}
      >
        {value}
      </span>
    </div>
  );
}
