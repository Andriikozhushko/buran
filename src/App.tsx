import { useState, useCallback, useRef, useEffect } from 'react';
import type { ScanResult, VerificationResult } from './lib/formats/types';
import { validateFile } from './lib/validation';
import { sha256 } from './lib/hash';
import { correctJpegOrientation } from './lib/image-orientation';
import { Layout } from './components/Layout';
import { ScanReport } from './components/ScanReport';
import { SuccessResult } from './components/SuccessResult';
import { UnsupportedState } from './components/UnsupportedState';
import { BlockedState } from './components/BlockedState';
import { ErrorState } from './components/ErrorState';
import type { PdfBlockReason } from './lib/formats/pdf/types';
import type { OfficeBlockReason } from './lib/formats/office/types';
import type { ZipBlockReason } from './lib/formats/zip/types';
import type { HeicBlockReason } from './lib/formats/heic/types';
import { useLocale } from './i18n';
import ScanWorker from './workers/scan.worker?worker';
import CleanWorker from './workers/clean.worker?worker';
import { CANCELLED_MESSAGE, CLEAN_TIMEOUT_MS, MALFORMED_MESSAGE, SCAN_TIMEOUT_MS, TIMEOUT_MESSAGE } from './lib/processing-limits';
import { Button } from './components/Button';

type AppPhase =
  | { phase: 'idle' }
  | { phase: 'scanning'; fileName: string }
  | { phase: 'scan-done'; scanResult: ScanResult }
  | { phase: 'cleaning'; scanResult: ScanResult }
  | {
      phase: 'success';
      scanResult: ScanResult;
      verification: VerificationResult;
      cleanBuffer: ArrayBuffer;
      cleanHash: string;
    }
  | { phase: 'unsupported'; fileType: string; fileName: string }
  | { phase: 'blocked'; reason: PdfBlockReason | OfficeBlockReason | ZipBlockReason | HeicBlockReason; fileName: string; message: string }
  | { phase: 'error'; message: string }
  | { phase: 'cancelled'; message: string };

export default function App() {
  const { t, locale } = useLocale();
  const [phase, setPhase] = useState<AppPhase>({ phase: 'idle' });
  const [isDragOver, setIsDragOver] = useState(false);
  const originalBufferRef = useRef<ArrayBuffer | null>(null);
  const scanWorkerRef = useRef<Worker | null>(null);
  const cleanWorkerRef = useRef<Worker | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const operationRef = useRef<{ id: string; kind: 'scan' | 'clean' } | null>(null);
  const watchdogRef = useRef<number | null>(null);

  // Coordination: after a file is dropped, the hero video plays its second
  // half. We only reveal the scan report once BOTH the scan has finished
  // AND the video has played to the end.
  const videoEndedRef = useRef(false);
  const pendingScanRef = useRef<ScanResult | null>(null);
  const pendingBlockedRef = useRef<{ reason: PdfBlockReason | OfficeBlockReason | ZipBlockReason | HeicBlockReason; fileName: string; message: string } | null>(null);

  const recreateScanWorker = useCallback(() => {
    scanWorkerRef.current?.terminate();
    scanWorkerRef.current = new ScanWorker();
  }, []);

  const recreateCleanWorker = useCallback(() => {
    cleanWorkerRef.current?.terminate();
    cleanWorkerRef.current = new CleanWorker();
  }, []);

  const clearWatchdog = useCallback(() => {
    if (watchdogRef.current !== null) window.clearTimeout(watchdogRef.current);
    watchdogRef.current = null;
  }, []);

  const startWatchdog = useCallback((id: string, kind: 'scan' | 'clean') => {
    clearWatchdog();
    watchdogRef.current = window.setTimeout(() => {
      if (operationRef.current?.id !== id) return;
      operationRef.current = null;
      originalBufferRef.current = null;
      pendingScanRef.current = null;
      pendingBlockedRef.current = null;
      if (kind === 'scan') recreateScanWorker();
      else recreateCleanWorker();
      setPhase({ phase: 'error', message: TIMEOUT_MESSAGE });
    }, kind === 'scan' ? SCAN_TIMEOUT_MS : CLEAN_TIMEOUT_MS);
  }, [clearWatchdog, recreateCleanWorker, recreateScanWorker]);

  const tryRevealScan = useCallback(() => {
    if (!videoEndedRef.current) return;
    if (pendingScanRef.current) {
      const result = pendingScanRef.current;
      pendingScanRef.current = null;
      operationRef.current = null;
      setPhase({ phase: 'scan-done', scanResult: result });
    } else if (pendingBlockedRef.current) {
      const blocked = pendingBlockedRef.current;
      pendingBlockedRef.current = null;
      operationRef.current = null;
      setPhase({ phase: 'blocked', ...blocked });
    }
  }, []);

  const handleVideoEnded = useCallback(() => {
    videoEndedRef.current = true;
    tryRevealScan();
  }, [tryRevealScan]);

  // Initialize workers
  useEffect(() => {
    scanWorkerRef.current = new ScanWorker();
    cleanWorkerRef.current = new CleanWorker();
    return () => {
      scanWorkerRef.current?.terminate();
      cleanWorkerRef.current?.terminate();
      clearWatchdog();
    };
  }, [clearWatchdog]);

  const handleReset = useCallback(() => {
    operationRef.current = null;
    clearWatchdog();
    originalBufferRef.current = null;
    videoEndedRef.current = false;
    pendingScanRef.current = null;
    pendingBlockedRef.current = null;
    setPhase({ phase: 'idle' });
  }, [clearWatchdog]);

  const handleCancel = useCallback(() => {
    const operation = operationRef.current;
    if (!operation) return;
    clearWatchdog();
    operationRef.current = null;
    originalBufferRef.current = null;
    pendingScanRef.current = null;
    pendingBlockedRef.current = null;
    if (operation.kind === 'scan') recreateScanWorker();
    else recreateCleanWorker();
    setPhase({ phase: 'cancelled', message: CANCELLED_MESSAGE });
  }, [clearWatchdog, recreateCleanWorker, recreateScanWorker]);

  const handleFile = useCallback(async (file: File) => {
    // Validate
    operationRef.current = null;
    clearWatchdog();
    const validation = await validateFile(file);

    if (!validation.valid) {
      if (validation.error === 'unsupported-format') {
        const ext = file.name.split('.').pop()?.toLowerCase() ?? t.appUnknownType;
        setPhase({
          phase: 'unsupported',
          fileType: validation.detectedType || ext,
          fileName: file.name,
        });
      } else {
        setPhase({
          phase: 'error',
          message: validation.error === 'too-large' ? t.appErrTooLarge : t.appErrReadFailed,
        });
      }
      return;
    }

    // Keep the original for cleaning; scan receives a transferred copy.
    originalBufferRef.current = validation.buffer;
    const scanBuffer = validation.buffer.slice(0);

    // Reset video coordination — the second half of the video will now play
    videoEndedRef.current = false;
    pendingScanRef.current = null;
    pendingBlockedRef.current = null;

    // Start scanning (hero stays, video plays its second half)
    setPhase({ phase: 'scanning', fileName: file.name });

    const worker = scanWorkerRef.current;
    if (!worker) {
      setPhase({ phase: 'error', message: t.appErrWorkerUnavailable });
      return;
    }

    const id = Math.random().toString(36).substring(2, 10);
    operationRef.current = { id, kind: 'scan' };
    startWatchdog(id, 'scan');

    const handleMessage = (event: MessageEvent) => {
      const response = event.data;
      if (response.id !== id || operationRef.current?.id !== id) return;

      worker.removeEventListener('message', handleMessage);
      clearWatchdog();

      if (response.error) {
        operationRef.current = null;
        originalBufferRef.current = null;
        setPhase({ phase: 'error', message: response.error || MALFORMED_MESSAGE });
        return;
      }

      if (response.blocked) {
        // A supported-format PDF that BURAN must not modify. Hold until the
        // video finishes, like a normal scan result.
        pendingBlockedRef.current = {
          reason: response.blocked.reason,
          fileName: validation.fileName,
          message: response.blocked.message,
        };
        tryRevealScan();
        return;
      }

      if (response.result) {
        // Hold the result until the video has finished playing
        pendingScanRef.current = response.result;
        tryRevealScan();
      }
    };

    worker.addEventListener('message', handleMessage);
    worker.postMessage(
      {
        id,
        buffer: scanBuffer,
        fileName: validation.fileName,
        fileSize: validation.fileSize,
        locale,
      },
      { transfer: [scanBuffer] },
    );
  }, [clearWatchdog, startWatchdog, tryRevealScan, t, locale]);

  // Drag-and-drop for idle
  useEffect(() => {
    if (phase.phase !== 'idle') return;
    const onDragOver = (e: DragEvent) => { e.preventDefault(); setIsDragOver(true); };
    const onDragLeave = () => setIsDragOver(false);
    const onDrop = (e: DragEvent) => {
      e.preventDefault(); setIsDragOver(false);
      if (e.dataTransfer?.files?.length === 1) handleFile(e.dataTransfer.files[0]);
    };
    document.addEventListener('dragover', onDragOver);
    document.addEventListener('dragleave', onDragLeave);
    document.addEventListener('drop', onDrop);
    return () => {
      document.removeEventListener('dragover', onDragOver);
      document.removeEventListener('dragleave', onDragLeave);
      document.removeEventListener('drop', onDrop);
    };
  }, [phase.phase, handleFile]);

  const handleStartClean = useCallback(async () => {
    if (phase.phase !== 'scan-done') return;

    const scanResult = phase.scanResult;
    setPhase({ phase: 'cleaning', scanResult });

    const worker = cleanWorkerRef.current;
    let bufferToClean = originalBufferRef.current;

    if (!worker || !bufferToClean) {
      setPhase({ phase: 'error', message: t.appErrCleanStart });
      return;
    }

    // Check if orientation correction is needed (JPEG with non-default orientation)
    const needsOrientationCorrection =
      scanResult.format === 'jpeg' &&
      scanResult.orientation !== null &&
      scanResult.orientation !== 1;

    if (needsOrientationCorrection) {
      try {
        // Apply physical rotation on the main thread via canvas
        bufferToClean = await correctJpegOrientation(
          bufferToClean,
          scanResult.orientation!,
        );
        // Canvas-re-encoded JPEG won't have EXIF, so the worker just strips any
        // residual metadata and verifies. The verification will note orientationApplied=true.
      } catch {
        // If orientation correction fails, continue with original buffer
        // (the clean worker will still strip metadata from it)
      }
    }

    const id = Math.random().toString(36).substring(2, 10);
    operationRef.current = { id, kind: 'clean' };
    startWatchdog(id, 'clean');

    const needsReencode = needsOrientationCorrection;

    const handleMessage = async (event: MessageEvent) => {
      const response = event.data;
      if (response.id !== id || operationRef.current?.id !== id) return;

      worker.removeEventListener('message', handleMessage);
      clearWatchdog();
      operationRef.current = null;

      if (response.error) {
        originalBufferRef.current = null;
        setPhase({ phase: 'error', message: response.error });
        return;
      }

      if (response.cleanBuffer && response.verification) {
        // Compute SHA-256 hash of clean output
        const hash = await sha256(response.cleanBuffer);

        const verification: VerificationResult = {
          ...response.verification,
          cleanHash: hash,
          orientationApplied: needsOrientationCorrection,
          pixelDataReencoded: needsReencode,
        };

        setPhase({
          phase: 'success',
          scanResult,
          verification,
          cleanBuffer: response.cleanBuffer,
          cleanHash: hash,
        });
        originalBufferRef.current = null;
      }
    };

    worker.addEventListener('message', handleMessage);
    originalBufferRef.current = null;
    worker.postMessage(
      {
        id,
        buffer: bufferToClean,
        scanResult,
        locale,
      },
      { transfer: [bufferToClean] },
    );
  }, [clearWatchdog, phase, startWatchdog, t, locale]);

  const processingState = (message: string) => (
    <div className="text-center space-y-4">
      <p className="text-[15px] font-medium text-[#9c6b3f] animate-pulse whitespace-pre-line">{message}</p>
      <Button variant="secondary" size="sm" onClick={handleCancel}>{t.appCancel}</Button>
    </div>
  );

  const renderContent = () => {
    switch (phase.phase) {
      case 'idle':
        return (
          <>
            <input ref={fileInputRef} type="file" accept=".jpg,.jpeg,.png,.webp,.heic,.heif,.pdf,.docx,.xlsx,.pptx,.zip" className="hidden"
              onChange={(e) => {
                if (e.target.files?.[0]) handleFile(e.target.files[0]);
                if (fileInputRef.current) fileInputRef.current.value = '';
              }}
            />
            {/* Outlined drag-and-drop zone (compact) */}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className={`group w-full rounded-2xl border-[3px] border-dashed px-6 py-5 transition-all duration-200 cursor-pointer flex items-center justify-center gap-4 ${
                isDragOver
                  ? 'border-[#9c6b3f] bg-[#f4ebe0] scale-[1.02]'
                  : 'border-[#d5d5d5] bg-white hover:border-[#9c6b3f] hover:bg-[#faf5ee]'
              }`}
            >
              <div className={`w-11 h-11 flex-shrink-0 rounded-xl flex items-center justify-center transition-colors ${isDragOver ? 'bg-[#9c6b3f]' : 'bg-[#f4ebe0] group-hover:bg-[#9c6b3f]'}`}>
                <svg className={`w-6 h-6 transition-colors ${isDragOver ? 'text-white' : 'text-[#9c6b3f] group-hover:text-white'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                </svg>
              </div>
              <div className="text-left">
                <p className="text-[15px] font-bold text-[#2b2b2b] leading-tight">
                  {isDragOver ? t.appDropPromptActive : t.appDropPrompt}
                </p>
                <p className="text-[12px] text-[#8a8a8a] mt-0.5">{t.zipDropFormats} · {t.appDropSizes}</p>
              </div>
            </button>
          </>
        );

      case 'scanning':
        return processingState(phase.fileName.toLowerCase().endsWith('.zip') ? t.appProcScanArchive : t.appProcScanFile);

      case 'scan-done':
        return (
          <ScanReport
            scanResult={phase.scanResult}
            onClean={handleStartClean}
            onReset={handleReset}
          />
        );

      case 'cleaning':
        return processingState(phase.scanResult.format === 'zip' ? t.appProcCleanArchive : t.appProcCleanFile);

      case 'success':
        return (
          <SuccessResult
            scanResult={phase.scanResult}
            cleanResult={{
              cleanBuffer: phase.cleanBuffer,
              originalHash: '',
              cleanHash: phase.cleanHash,
              metadataFound: phase.scanResult.findings.filter(
                (f) =>
                  !['PNG:iCCP', 'PNG:sRGB', 'PNG:gAMA', 'PNG:cHRM', 'WebP:ICCP'].includes(
                    f.field,
                  ),
              ).length,
              metadataRemoved: phase.verification.metadataRemaining,
            }}
            verification={phase.verification}
            onReset={handleReset}
          />
        );

      case 'unsupported':
        return (
          <UnsupportedState
            fileType={phase.fileType}
            fileName={phase.fileName}
            onReset={handleReset}
          />
        );

      case 'blocked':
        return (
          <BlockedState
            reason={phase.reason}
            fileName={phase.fileName}
            message={phase.message}
            onReset={handleReset}
          />
        );

      case 'error':
        return <ErrorState message={phase.message} onReset={handleReset} />;

      case 'cancelled':
        return <ErrorState message={phase.message} onReset={handleReset} />;

      default:
        return null;
    }
  };

  return (
    <Layout phase={phase.phase} onVideoEnded={handleVideoEnded}>
      {renderContent()}
    </Layout>
  );
}
