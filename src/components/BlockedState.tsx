import type { PdfBlockReason } from '../lib/formats/pdf/types';
import type { OfficeBlockReason } from '../lib/formats/office/types';
import type { ZipBlockReason } from '../lib/formats/zip/types';
import type { HeicBlockReason } from '../lib/formats/heic/types';
import { useT } from '../i18n';
import type { Strings } from '../i18n';
import { Button } from './Button';

type BlockReason = PdfBlockReason | OfficeBlockReason | ZipBlockReason | HeicBlockReason;

interface BlockedStateProps {
  reason: BlockReason;
  fileName: string;
  message: string;
  onReset: () => void;
}

function reasonTitle(reason: BlockReason, t: Strings): string {
  const titles: Record<BlockReason, string> = {
    // PDF
    encrypted: t.blockedEncrypted,
    signed: t.blockedSigned,
    xfa: t.blockedXfa,
    portfolio: t.blockedPortfolio,
    attachments: t.blockedAttachments,
    'too-many-pages': t.blockedTooManyPages,
    'too-large': t.blockedTooLarge,
    malformed: t.blockedMalformed,
    // Office
    macro: t.blockedMacro,
    'embedded-object': t.blockedEmbeddedObject,
    'custom-xml': t.blockedCustomXml,
    'threaded-comments': t.blockedThreadedComments,
    'unsupported-media': t.blockedUnsupportedMedia,
    'too-many-entries': t.blockedTooManyEntries,
    'zip-bomb': t.blockedZipBomb,
    'unsupported-package': t.blockedUnsupportedPackage,
    'multi-volume': t.blockedMultiVolume,
    'too-deep': t.blockedTooDeep,
    'entry-too-large': t.blockedEntryTooLarge,
    'path-traversal': t.blockedPathTraversal,
    'duplicate-path': t.blockedDuplicatePath,
    'verification-failed': t.blockedVerificationFailed,
    'nested-clean-failed': t.blockedNestedCleanFailed,
    'too-many-images': t.blockedTooManyImages,
    'no-primary-image': t.blockedNoPrimaryImage,
    'auxiliary-image': t.blockedAuxiliaryImage,
    'depth-map': t.blockedDepthMap,
    animation: t.blockedAnimation,
    'unsupported-colour': t.blockedUnsupportedColour,
    'decode-failed': t.blockedDecodeFailed,
    'resource-limit': t.blockedResourceLimit,
  };
  return titles[reason];
}

/**
 * Honest blocked state for PDFs that BURAN must not modify. No clean download
 * is offered — BURAN never fabricates a "cleaned" file it cannot guarantee.
 */
export function BlockedState({ reason, fileName, message, onReset }: BlockedStateProps) {
  const t = useT();
  return (
    <div className="w-full max-w-lg mx-auto animate-fade-in">
      <div className="bg-white rounded-xl border border-[#e6e6e6] shadow-[0_1px_3px_rgba(0,0,0,0.04)] p-8 text-center">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-[#fbeaea] ring-1 ring-[#f0d2d0] mb-5 animate-rise">
          <svg className="w-6 h-6 text-[#c0392f]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" transform="rotate(45 12 12)" opacity="0" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m0 3.75h.008M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>

        <h2 className="text-[20px] font-bold text-[#2b2b2b] tracking-tight mb-3">{reasonTitle(reason, t)}</h2>

        <div className="bg-[#f8f8f7] border border-[#ececea] rounded-lg p-4 mb-4">
          <p className="text-[13px] text-[#9a9a9a] truncate mb-2">{fileName}</p>
          <p className="text-[14px] text-[#5a5a5a] leading-relaxed text-left">{message}</p>
        </div>

        <div className="bg-[#faf7f3] border border-l-[3px] border-[#e9ddcb] border-l-[#9c6b3f] rounded-lg p-4 mb-7 text-left">
          <p className="text-[13px] text-[#5a5a5a] leading-relaxed">
            <span className="font-semibold text-[#9c6b3f]">{t.blockedFileUnchanged}</span>
            {t.pdfBlockedReassurance}
          </p>
        </div>

        <Button variant="primary" size="lg" onClick={onReset}>
          {t.unsupportedRetry}
        </Button>
      </div>
    </div>
  );
}
