import type { ScanResult } from '../lib/formats/types';
import { buildTrustResult, personalFindings } from '../lib/trust-result';
import type { ConcreteFindingGroup } from '../lib/trust-result';
import { useT } from '../i18n';
import type { Strings } from '../i18n';
import { ScanItem } from './ScanItem';
import { Button } from './Button';

interface ScanReportProps {
  scanResult: ScanResult;
  onClean: () => void;
  onReset: () => void;
}

export function ScanReport({ scanResult, onClean, onReset }: ScanReportProps) {
  const t = useT();
  const model = buildTrustResult(scanResult, t);
  const stateText = model.supportState === 'partially-supported' ? t.scanStatePartial : t.scanStateSupported;
  const hasMetadataToClean = personalFindings(scanResult).length > 0;
  // HEIC/HEIF is intentionally exported through a fresh JPEG/PNG container.
  // Offer that verified clean export even when the source scan did not expose
  // a metadata container; otherwise the advertised HEIC workflow dead-ends.
  const canClean = hasMetadataToClean || scanResult.format === 'heic';

  return (
    <section className="w-full h-full flex flex-col animate-fade-in min-h-0" aria-labelledby="scan-title">
      <header className="flex items-start justify-between gap-3 mb-3 flex-shrink-0">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 id="scan-title" className="text-[18px] font-bold text-[#2b2b2b] tracking-tight">
              {t.scanReportTitle}
            </h2>
            <span className="text-[10.5px] font-semibold uppercase tracking-wide text-[#357a3b] bg-[#e8f1e8] ring-1 ring-[#d3e6d3] px-2 py-0.5 rounded-md">{t.scanReportLocal}</span>
            <span className="text-[10.5px] font-semibold uppercase tracking-wide text-[#7a5734] bg-[#f1ece4] ring-1 ring-[#e4d9c9] px-2 py-0.5 rounded-md">{stateText}</span>
          </div>
          <p className="text-[12px] text-[#8a8a8a] mt-1">
            {model.fileType} · {model.fileSize} · {t.scanDeviceNote}
          </p>
        </div>
        <button
          onClick={onReset}
          className="text-[13px] font-medium text-[#8a8a8a] hover:text-[#9c6b3f] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#9c6b3f] rounded-md transition-colors flex items-center gap-1 flex-shrink-0"
        >
          {t.scanResetFile}
        </button>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto pr-1 -mr-1 space-y-2.5">
        <div className={hasMetadataToClean
          ? 'bg-white rounded-xl border border-[#e6e6e6] shadow-[0_1px_2px_rgba(0,0,0,0.03)] p-5'
          : 'bg-[#f0f8f1] rounded-xl border border-[#cfe8d2] shadow-[0_1px_2px_rgba(53,122,59,0.08)] p-5'
        }>
          <div className={hasMetadataToClean ? '' : 'flex items-start gap-3'}>
            {!hasMetadataToClean && (
              <span className="w-8 h-8 rounded-full bg-[#357a3b] text-white flex items-center justify-center flex-shrink-0 mt-0.5" aria-hidden="true">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </span>
            )}
            <div className="min-w-0">
              <p className={hasMetadataToClean
                ? 'text-[19px] font-bold text-[#2b2b2b] leading-tight tracking-tight'
                : 'text-[22px] font-bold text-[#245b2a] leading-tight tracking-tight'
              }>{model.summaryTitle}</p>
              <p className={hasMetadataToClean
                ? 'text-[13px] text-[#6f6258] mt-2 leading-relaxed'
                : 'text-[13.5px] text-[#426b46] mt-2 leading-relaxed'
              }>{model.summaryText}</p>
            </div>
          </div>
        </div>

        {model.concreteFindings.length > 0 && <FoundValues groups={model.concreteFindings} t={t} />}

        {scanResult.format === 'heic' && (
          <div className="rounded-xl border border-[#d7e5d8] bg-[#f4faf4] p-4 text-[13px] font-medium text-[#357a3b]">
            {t.trustFoundHeicSupported}
          </div>
        )}

        {scanResult.format === 'zip' && scanResult.zip ? <ZipTree scanResult={scanResult} t={t} /> : null}

        {model.limitations.length > 0 && (
          <details className="bg-[#faf6ee] rounded-xl border border-l-[3px] border-[#ece0cb] border-l-[#c08a3e] p-4 group">
            <summary className="cursor-pointer text-[13.5px] font-semibold text-[#6c4b26] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#9c6b3f] rounded-md">
              {t.scanLimitsTitle}
            </summary>
            <ul className="mt-3 space-y-1.5 text-[12.5px] text-[#7b6244] leading-relaxed list-disc pl-4">
              {model.limitations.map((item) => <li key={item}>{item}</li>)}
            </ul>
          </details>
        )}

        <details className="bg-white rounded-xl p-4 border border-[#e6e6e6] group">
          <summary className="cursor-pointer text-[13.5px] font-semibold text-[#2b2b2b] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#9c6b3f] rounded-md">
            {t.scanTechDetailsTitle}
          </summary>
          <div className="mt-2 divide-y divide-[#f0f0ef]">
            {model.technicalDetails.length > 0 ? model.technicalDetails.map((finding, i) => (
              <ScanItem key={`${finding.field}-${i}`} finding={finding} />
            )) : <p className="text-[13px] text-[#8a8a8a] py-2">{t.scanTechNoneFound}</p>}
          </div>
        </details>
      </div>

      {canClean && (
        <div className="flex flex-col items-center pt-3 flex-shrink-0">
          <Button variant="primary" size="lg" onClick={onClean} aria-label={t.scanCleanAria}>
            {t.ctaClean}
          </Button>
          <p className="text-[12px] text-[#8a8a8a] mt-2">{t.scanNoUpload}</p>
        </div>
      )}
    </section>
  );
}

const SEVERITY_BAR = {
  high: 'bg-[#c0392f]',
  medium: 'bg-[#a9711f]',
  low: 'bg-[#9c6b3f]',
};

function FoundValues({ groups, t }: { groups: ConcreteFindingGroup[]; t: Strings }) {
  return (
    <section className="bg-white rounded-xl border border-[#e6e6e6] shadow-[0_1px_2px_rgba(0,0,0,0.03)] p-5" aria-label={t.scanFoundValuesTitle}>
      <h3 className="text-[15px] font-semibold text-[#2b2b2b] tracking-tight">{t.scanFoundValuesTitle}</h3>
      <p className="text-[12px] text-[#8a8a8a] mt-1 leading-relaxed">{t.scanFoundValuesNote}</p>
      <div className="mt-3 space-y-2.5">
        {groups.map((group) => (
          <div key={group.label} className="flex items-stretch gap-3">
            <span className={`w-[3px] rounded-full flex-shrink-0 ${SEVERITY_BAR[group.severity]}`} />
            <div className="min-w-0 flex-1">
              <p className="text-[12.5px] font-semibold text-[#5f5a54]">{group.label}</p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {group.values.map((value) => (
                  <span
                    key={value}
                    className="text-[12.5px] font-mono text-[#2b2b2b] break-all bg-[#f6f6f5] border border-[#ececea] rounded-md px-2 py-1 max-w-full"
                  >
                    {value}
                  </span>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function ZipTree({ scanResult, t }: { scanResult: ScanResult; t: Strings }) {
  const zip = scanResult.zip;
  if (!zip) return null;
  const rows = [
    ...zip.supportedEntries.map((entry) => ({ path: entry.path, note: `${entry.findingsCount} ${t.scanZipEntryTraces}`, kind: 'clean' as const })),
    ...zip.unsupportedEntries.map((entry) => ({ path: entry.path, note: t.scanZipEntryUnchanged, kind: 'unchanged' as const })),
  ];
  return (
    <section className="bg-[#f8f8f7] rounded-xl p-4 border border-[#e6e6e6]" aria-label={t.scanZipTreeAria}>
      <h3 className="text-[14px] font-semibold text-[#2b2b2b] mb-3 break-all tracking-tight">{scanResult.fileName || t.scanZipDefaultName}</h3>
      <div className="font-mono text-[12px] text-[#594d42] space-y-1 overflow-x-auto pb-1">
        {rows.map((row, index) => (
          <div key={row.path} className="min-w-0 flex items-start gap-2">
            <span className="text-[#b78345]">{index === rows.length - 1 ? '└──' : '├──'}</span>
            <span className="break-all flex-1">{row.path}</span>
            <span className={row.kind === 'clean' ? 'text-[#357a3b] whitespace-nowrap' : 'text-[#9c6b3f]'}>{row.note}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
