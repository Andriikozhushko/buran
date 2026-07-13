import type { ReactNode } from 'react';
import { useRef, useEffect, useState } from 'react';
import { useT } from '../i18n';
import { LanguageSwitcher } from './LanguageSwitcher';

interface LayoutProps {
  children: ReactNode;
  phase: string;
  onVideoEnded?: () => void;
}

const GITHUB_REPO_URL = 'https://github.com/Andriikozhushko/buran';

// Timestamp (seconds) where the "intro" half ends and the "eating" half begins.
const SPLIT_AT = 6.07;

/* Video mascot — plays 0→SPLIT on entry, then SPLIT→end once a file is dropped */
function VideoMascot({ playFull, onEnded }: { playFull: boolean; onEnded?: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);

  // Intro: play up to SPLIT_AT, then freeze
  useEffect(() => {
    if (playFull) return;
    const v = videoRef.current;
    if (!v) return;

    const onTime = () => {
      if (v.currentTime >= SPLIT_AT) {
        v.pause();
        v.removeEventListener('timeupdate', onTime);
      }
    };
    v.addEventListener('timeupdate', onTime);
    v.play().catch(() => {});
    return () => v.removeEventListener('timeupdate', onTime);
  }, [playFull]);

  // Second half: continue from SPLIT_AT to the end, then notify
  useEffect(() => {
    if (!playFull) return;
    const v = videoRef.current;
    if (!v) return;

    const onEnd = () => onEnded?.();
    v.addEventListener('ended', onEnd);
    if (v.currentTime < SPLIT_AT) v.currentTime = SPLIT_AT;
    v.play().catch(() => {
      // If playback fails, don't block the flow — reveal immediately
      onEnded?.();
    });
    return () => v.removeEventListener('ended', onEnd);
  }, [playFull, onEnded]);

  return (
    <div className="relative rounded-3xl overflow-hidden bg-white max-h-[34vh]">
      <div className="relative rounded-3xl overflow-hidden bg-white max-h-[34vh]">
        <video
          ref={videoRef}
          src="/hero-video.mp4"
          className="h-[34vh] w-auto object-contain block"
          aria-hidden="true"
          muted
          playsInline
          preload="auto"
          disablePictureInPicture
        />
      </div>
    </div>
  );
}

export function Layout({ children, phase, onVideoEnded }: LayoutProps) {
  const t = useT();
  const [privacyOpen, setPrivacyOpen] = useState(false);
  // Hero (with video) is shown while idle or while the file is being processed.
  const showHero = phase === 'idle' || phase === 'scanning' || phase === 'cleaning';
  const isIdle = phase === 'idle';

  const trustItems = [t.trustLocal, t.trustNoReg, t.trustNoStorage, t.trustOpenSource];

  return (
    <div className="relative h-screen flex flex-col antialiased bg-white overflow-hidden">
      {/* Header */}
      <header className="relative z-50 grid h-28 flex-shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-3 border-b border-[#efe7da] bg-white/90 px-3 backdrop-blur-sm sm:gap-8 md:gap-12">
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => setPrivacyOpen(true)}
            className="rounded-full border border-[#e6ddcf] bg-white px-3 py-1.5 text-[12.5px] font-semibold text-[#5a5246] transition-colors hover:border-[#9c6b3f] hover:text-[#9c6b3f] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#9c6b3f]"
          >
            {t.privacyLink}
          </button>
        </div>
        <img src="/buran-logo.png" alt="BURAN" className="h-20 w-auto object-contain sm:h-24" />
        <div className="flex justify-start">
          <LanguageSwitcher />
        </div>
      </header>

      {privacyOpen && <PrivacyDialog onClose={() => setPrivacyOpen(false)} />}

      {showHero ? (
        <main className="relative z-10 flex-1 flex flex-col items-center justify-center px-4 sm:px-6 text-center min-h-0">
          {/* Video */}
          <div className="mb-5">
            <VideoMascot playFull={!isIdle} onEnded={onVideoEnded} />
          </div>

          {/* Subheadline */}
          <p className="text-[15px] sm:text-[16px] text-[#6b6b6b] leading-relaxed max-w-sm">
            {t.subheadline}
          </p>

          {/* CTA / dropzone / status slot */}
          <div className="mt-5 w-full max-w-md">{children}</div>

          {/* Trust row (idle only) */}
          {isIdle && (
            <div className="mt-5 flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5">
              {trustItems.map((t) => (
                <div key={t} className="flex items-center gap-1.5 text-[12px] text-[#8a8a8a]">
                  <svg className="w-3.5 h-3.5 text-[#58a55c]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                  </svg>
                  {t}
                </div>
              ))}
            </div>
          )}
        </main>
      ) : (
        <main className="relative z-10 flex-1 min-h-0 px-4 sm:px-6 py-4 bg-[#fafafa] flex flex-col">
          <div className="max-w-2xl w-full mx-auto flex-1 min-h-0 flex flex-col">{children}</div>
        </main>
      )}

      {/* Footer */}
      <footer className="relative z-10 h-10 flex-shrink-0 flex items-center border-t border-gray-100 bg-white/90 backdrop-blur-sm">
        <div className="max-w-4xl w-full mx-auto px-6 flex items-center justify-between">
          <p className="flex min-w-0 items-center gap-2 text-[11px] text-gray-400">
            <span className="truncate">{t.footerText}</span>
            <a
              href={GITHUB_REPO_URL}
              target="_blank"
              rel="noreferrer"
              className="flex-shrink-0 font-semibold text-[#7a4f2c] underline decoration-[#d6b898] underline-offset-2 transition-colors hover:text-[#9c6b3f]"
            >
              GitHub
            </a>
          </p>
          <p className="text-[11px] text-gray-300 flex-shrink-0 ml-3">v0.1.0</p>
        </div>
      </footer>
    </div>
  );
}

function PrivacyDialog({ onClose }: { onClose: () => void }) {
  const t = useT();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#2b2b2b]/35 p-3 sm:px-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="privacy-title">
      <div className="max-h-[calc(100dvh-1.5rem)] w-full max-w-lg overflow-hidden rounded-[1.75rem] border border-[#eadfce] bg-white shadow-[0_24px_80px_rgba(0,0,0,0.22)] sm:rounded-3xl">
        <div className="max-h-[calc(100dvh-1.5rem)] overflow-y-auto p-4 sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#9c6b3f]">BURAN</p>
              <h2 id="privacy-title" className="mt-1 text-[20px] font-bold tracking-tight text-[#2b2b2b] sm:text-[24px]">
                {t.privacyTitle}
              </h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="flex-shrink-0 rounded-full p-2 text-[#8a8a8a] transition-colors hover:bg-[#faf5ee] hover:text-[#9c6b3f] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#9c6b3f]"
              aria-label={t.privacyClose}
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <p className="mt-4 text-[13px] leading-relaxed text-[#5f5a54] sm:text-[14px]">{t.privacyIntro}</p>

          <div className="mt-5 space-y-3">
            <PrivacyPoint title={t.privacyLocalTitle} text={t.privacyLocalText} />
            <PrivacyPoint title={t.privacyNoAnalyticsTitle} text={t.privacyNoAnalyticsText} />
            <PrivacyPoint title={t.privacyLimitsTitle} text={t.privacyLimitsText} />
          </div>
        </div>
      </div>
    </div>
  );
}

function PrivacyPoint({ title, text }: { title: string; text: string }) {
  return (
    <section className="rounded-2xl border border-[#efe7da] bg-[#fffaf2] p-3.5 sm:p-4">
      <h3 className="text-[14px] font-bold text-[#2b2b2b]">{title}</h3>
      <p className="mt-1.5 text-[12.5px] leading-relaxed text-[#6f6258] sm:text-[13px]">{text}</p>
    </section>
  );
}
