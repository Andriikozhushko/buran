import { useState, useCallback, useRef, useEffect } from 'react';
import type { AppState, ScanResult, VerificationResult } from '../lib/formats/types';
import { validateFile } from '../lib/validation';
import { getValidationErrorMessage } from '../lib/validation';
import ScanWorker from '../workers/scan.worker?worker';
import CleanWorker from '../workers/clean.worker?worker';

interface UseFileProcessingReturn {
  state: AppState;
  handleFile: (file: File) => void;
  handleScanComplete: (result: ScanResult) => void;
  handleStartClean: () => void;
  handleCleaningComplete: (
    cleanBuffer: ArrayBuffer,
    originalHash: string,
    verification: VerificationResult,
  ) => void;
  handleReset: () => void;
  handleError: (message: string) => void;
}

export function useFileProcessing(): UseFileProcessingReturn {
  const [state, setState] = useState<AppState>({ phase: 'idle' });
  const scanWorkerRef = useRef<Worker | null>(null);
  const cleanWorkerRef = useRef<Worker | null>(null);
  const pendingIdRef = useRef<string>('');

  // Create workers on mount
  useEffect(() => {
    scanWorkerRef.current = new ScanWorker();
    cleanWorkerRef.current = new CleanWorker();

    return () => {
      scanWorkerRef.current?.terminate();
      cleanWorkerRef.current?.terminate();
    };
  }, []);

  const generateId = () => Math.random().toString(36).substring(2, 10);

  const handleFile = useCallback(
    async (file: File) => {
      // Reset any previous state
      pendingIdRef.current = '';

      const validation = await validateFile(file);

      if (!validation.valid) {
        if (validation.error === 'unsupported-format') {
          const ext = file.name.split('.').pop()?.toLowerCase() ?? 'неизвестный';
          setState({
            phase: 'unsupported',
            fileType: validation.detectedType || ext,
            fileName: file.name,
            message: getValidationErrorMessage(validation.error),
          });
        } else {
          setState({
            phase: 'error',
            message: getValidationErrorMessage(validation.error),
          });
        }
        return;
      }

      // Start scanning
      setState({ phase: 'scanning', fileName: file.name });

      const id = generateId();
      pendingIdRef.current = id;

      const worker = scanWorkerRef.current;
      if (!worker) {
        setState({ phase: 'error', message: 'Web Worker не доступен.' });
        return;
      }

      const handleScanMessage = (event: MessageEvent) => {
        const response = event.data;
        if (response.id !== id) return;

        worker.removeEventListener('message', handleScanMessage);

        if (response.error) {
          setState({ phase: 'error', message: response.error });
          return;
        }

        if (response.result) {
          setState({ phase: 'scan-done', scanResult: response.result });
        }
      };

      worker.addEventListener('message', handleScanMessage);

      worker.postMessage(
        {
          id,
          buffer: validation.buffer,
          fileName: validation.fileName,
          fileSize: validation.fileSize,
        },
        { transfer: [validation.buffer] },
      );
    },
    [],
  );

  const handleStartClean = useCallback(() => {
    if (state.phase !== 'scan-done') return;

    setState({
      phase: 'cleaning',
      scanResult: state.scanResult,
    });
  }, [state]);

  const handleCleaningComplete = useCallback(
    (cleanBuffer: ArrayBuffer, originalHash: string, verification: VerificationResult) => {
      if (state.phase !== 'cleaning') return;

      const metadataFound = state.scanResult.findings.filter(
        (f) => !['PNG:iCCP', 'PNG:sRGB', 'PNG:gAMA', 'PNG:cHRM', 'WebP:ICCP'].includes(f.field),
      ).length;

      setState({
        phase: 'success',
        scanResult: state.scanResult,
        cleanResult: {
          cleanBuffer,
          originalHash,
          cleanHash: verification.cleanHash,
          metadataFound,
          metadataRemoved: verification.metadataRemaining,
        },
        verification,
      });
    },
    [state],
  );

  const handleScanComplete = useCallback((result: ScanResult) => {
    setState({ phase: 'scan-done', scanResult: result });
  }, []);

  const handleReset = useCallback(() => {
    setState({ phase: 'idle' });
  }, []);

  const handleError = useCallback((message: string) => {
    setState({ phase: 'error', message });
  }, []);

  return {
    state,
    handleFile,
    handleScanComplete,
    handleStartClean,
    handleCleaningComplete,
    handleReset,
    handleError,
  };
}

export { useFileProcessing as default };
