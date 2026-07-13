import type { MetadataFinding } from '../lib/formats/types';
import { Badge } from './Badge';
import { useT } from '../i18n';

interface ScanItemProps {
  finding: MetadataFinding;
}

const barColor = {
  high: 'bg-[#c0392f]',
  medium: 'bg-[#a9711f]',
  low: 'bg-[#9c6b3f]',
};

export function ScanItem({ finding }: ScanItemProps) {
  const t = useT();
  const description =
    finding.severity === 'high' ? t.scanDescHigh : finding.severity === 'medium' ? t.scanDescMedium : t.scanDescLow;
  return (
    <div className="flex items-stretch gap-3 py-2.5">
      <span className={`w-[3px] rounded-full flex-shrink-0 ${barColor[finding.severity]}`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-[14px] text-[#2b2b2b]">{finding.label}</span>
          <Badge variant={finding.severity} />
        </div>
        {finding.value && (
          <p className="mt-1 text-[12.5px] font-mono text-[#5f5a54] break-all bg-[#f6f6f5] border border-[#ececea] rounded-md px-2.5 py-1.5 inline-block max-w-full">
            {finding.value}
          </p>
        )}
        <p className="mt-1.5 text-[12.5px] text-[#8a8a8a] leading-relaxed">
          {description}
        </p>
      </div>
    </div>
  );
}
