import type { PreservedInfo as PreservedInfoType } from '../lib/formats/types';
import { useT } from '../i18n';

interface PreservedInfoProps {
  preservedInfo: PreservedInfoType;
}

export function PreservedInfo({ preservedInfo }: PreservedInfoProps) {
  const t = useT();
  const items: { label: string; value: string }[] = [
    { label: t.scanKeptPixels, value: t.preservedWillKeep },
    {
      label: t.scanKeptDimensions,
      value: preservedInfo.dimensions
        ? `${preservedInfo.dimensions.width} × ${preservedInfo.dimensions.height}`
        : '—',
    },
    {
      label: t.scanKeptTransparency,
      value: preservedInfo.hasTransparency ? t.preservedYes : t.preservedNo,
    },
    {
      label: t.scanKeptIcc,
      value: preservedInfo.iccDescription || t.preservedNo,
    },
    {
      label: t.scanKeptColour,
      value: preservedInfo.colourChunks.length > 0 ? preservedInfo.colourChunks.join(', ') : '—',
    },
  ];

  return (
    <div className="bg-[#eaf5ea] rounded-3xl p-6">
      <div className="flex items-center gap-2 mb-4">
        <div className="w-7 h-7 rounded-full bg-[#58a55c] flex items-center justify-center flex-shrink-0">
          <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
          </svg>
        </div>
        <h3 className="text-[15px] font-extrabold text-[#2b2b2b]">{t.scanWhatKept}</h3>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        {items.map((item) => (
          <div
            key={item.label}
            className="flex items-center justify-between gap-3 bg-white/70 rounded-xl px-3.5 py-2.5"
          >
            <span className="text-[13px] text-[#5a5a5a]">{item.label}</span>
            <span className="text-[13px] font-semibold text-[#2b2b2b] text-right">{item.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
