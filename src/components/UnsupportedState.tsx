import { useT } from '../i18n';
import { Button } from './Button';

interface UnsupportedStateProps {
  fileType: string;
  fileName: string;
  onReset: () => void;
}

export function UnsupportedState({ fileType, fileName, onReset }: UnsupportedStateProps) {
  const t = useT();
  return (
    <div className="w-full max-w-lg mx-auto animate-fade-in">
      <div className="bg-white rounded-xl border border-[#e6e6e6] shadow-[0_1px_3px_rgba(0,0,0,0.04)] p-8 text-center">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-[#f8f0e2] ring-1 ring-[#ecddc4] mb-5 animate-rise">
          <svg className="w-6 h-6 text-[#a9711f]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
          </svg>
        </div>

        <h2 className="text-[20px] font-bold text-[#2b2b2b] tracking-tight mb-3">{t.unsupportedTitle}</h2>

        <div className="bg-[#f8f8f7] border border-[#ececea] rounded-lg p-4 mb-4">
          <p className="text-[14px] text-[#6b6b6b] leading-relaxed">
            <span className="font-semibold text-[#2b2b2b]">{fileName}</span>
            {fileType ? ` (${fileType.toUpperCase()})` : ''} — {t.unsupportedGeneric}
          </p>
        </div>

        <p className="text-[14px] text-[#8a8a8a] leading-relaxed mb-4">{t.unsupportedWhy}</p>

        <div className="bg-[#faf7f3] border border-l-[3px] border-[#e9ddcb] border-l-[#9c6b3f] rounded-lg p-4 mb-7 text-left">
          <p className="text-[13px] text-[#5a5a5a] leading-relaxed">
            <span className="font-semibold text-[#9c6b3f]">{t.unsupportedRoadmapLabel}</span>
            {t.unsupportedRoadmap}
          </p>
        </div>

        <Button variant="primary" size="lg" onClick={onReset}>
          {t.unsupportedRetry}
        </Button>
      </div>
    </div>
  );
}
