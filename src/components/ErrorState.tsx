import { useT } from '../i18n';
import { Button } from './Button';

interface ErrorStateProps {
  message: string;
  onReset: () => void;
}

export function ErrorState({ message, onReset }: ErrorStateProps) {
  const t = useT();
  return (
    <div className="w-full max-w-lg mx-auto animate-fade-in">
      <div className="bg-white rounded-xl border border-[#e6e6e6] shadow-[0_1px_3px_rgba(0,0,0,0.04)] p-8 text-center">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-[#fbeaea] ring-1 ring-[#f0d2d0] mb-5 animate-rise">
          <svg className="w-6 h-6 text-[#c0392f]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
        </div>

        <h2 className="text-[20px] font-bold text-[#2b2b2b] tracking-tight mb-3">{t.errorProcessing}</h2>

        <div className="bg-[#fbeaea] border border-[#f0d2d0] rounded-lg p-4 mb-7">
          <p className="text-[13px] text-[#b34237] leading-relaxed font-mono break-all">{message}</p>
        </div>

        <Button variant="primary" size="lg" onClick={onReset}>
          {t.errorRetry}
        </Button>
      </div>
    </div>
  );
}
