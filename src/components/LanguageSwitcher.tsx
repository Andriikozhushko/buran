import { useEffect, useRef, useState } from 'react';
import { localeNames, localeOrder, useLocale } from '../i18n';

export function LanguageSwitcher() {
  const { locale, setLocale } = useLocale();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const currentLabel = localeNames[locale];

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex max-w-[min(44vw,12rem)] items-center gap-1.5 rounded-full border border-[#e6ddcf] bg-white px-3 py-1.5 text-[12.5px] font-semibold text-[#5a5246] transition-colors hover:border-[#9c6b3f] hover:text-[#9c6b3f] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#9c6b3f] sm:max-w-none"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Language selector"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9 9 0 100-18 9 9 0 000 18zm0 0c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3M3.6 9h16.8M3.6 15h16.8" />
        </svg>
        <span className="truncate">{currentLabel}</span>
        <svg className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
        </svg>
      </button>

      {open && (
        <ul
          role="listbox"
          className="absolute right-0 z-50 mt-2 max-h-[min(60vh,20rem)] w-[min(75vw,13rem)] overflow-y-auto rounded-2xl border border-[#ece3d4] bg-white py-1 shadow-[0_8px_28px_rgba(0,0,0,0.12)] sm:w-44"
        >
          {localeOrder.map((code) => (
            <li key={code}>
              <button
                type="button"
                role="option"
                aria-selected={code === locale}
                onClick={() => {
                  setLocale(code);
                  setOpen(false);
                }}
                className={`flex w-full items-center justify-between gap-3 px-4 py-2 text-left text-[13px] transition-colors hover:bg-[#faf5ee] ${
                  code === locale ? 'font-bold text-[#9c6b3f]' : 'font-medium text-[#5a5246]'
                }`}
              >
                <span className="min-w-0 break-words">{localeNames[code]}</span>
                {code === locale && (
                  <svg className="h-4 w-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                  </svg>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
