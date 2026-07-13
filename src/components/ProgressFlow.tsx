import { useEffect, useState } from 'react';
import { Mascot } from './Mascot';
import { useT } from '../i18n';

interface ProgressFlowProps {
  onComplete: () => void;
}

export function ProgressFlow({ onComplete }: ProgressFlowProps) {
  const t = useT();
  const steps = [
    { key: 'scanning', label: t.progressScanning },
    { key: 'cleaning', label: t.progressCleaning },
    { key: 'verifying', label: t.progressVerifying },
  ] as const;
  const [currentStep, setCurrentStep] = useState(0);

  useEffect(() => {
    if (currentStep >= steps.length) {
      onComplete();
      return;
    }

    const delay = Math.min(600 + Math.random() * 400, 1200); // Brief but noticeable
    const timer = setTimeout(() => {
      setCurrentStep((prev) => prev + 1);
    }, delay);

    return () => clearTimeout(timer);
  }, [currentStep, onComplete]);

  const mascotState = currentStep === 0 ? 'scanning' : 'cleaning';

  return (
    <div className="flex flex-col items-center mt-12">
      <Mascot state={currentStep <= 1 ? mascotState : 'success'} />

      <div className="mt-6 space-y-3 w-full max-w-sm">
        {steps.map((step, i) => {
          const isActive = i === currentStep;
          const isDone = i < currentStep;
          return (
            <div
              key={step.key}
              className={`flex items-center gap-3 px-4 py-2.5 rounded-lg transition-all duration-300 ${
                isActive ? 'bg-buran-ice-light border border-buran-ice-dark/30' :
                isDone ? 'bg-buran-green-light/50' :
                'opacity-40'
              }`}
            >
              <div
                className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 transition-colors duration-300 ${
                  isDone ? 'bg-buran-green text-white' :
                  isActive ? 'bg-buran-ice-dark text-white animate-pulse-glow' :
                  'bg-buran-border'
                }`}
              >
                {isDone ? (
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                  </svg>
                ) : (
                  <span className="text-[10px] font-bold">{i + 1}</span>
                )}
              </div>
              <span className={`text-sm font-medium transition-colors duration-300 ${
                isDone ? 'text-buran-green' :
                isActive ? 'text-buran-text' :
                'text-buran-text-secondary'
              }`}>
                {step.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
