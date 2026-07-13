import { useCallback, useRef, useState } from 'react';
import { useT } from '../i18n';

interface DropZoneProps {
  onFile: (file: File) => void;
  disabled?: boolean;
}

export function DropZone({ onFile, disabled = false }: DropZoneProps) {
  const t = useT();
  const [isDragOver, setIsDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!disabled) setIsDragOver(true);
    },
    [disabled],
  );

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);

      if (disabled) return;

      const files = e.dataTransfer.files;
      if (files.length === 1) {
        onFile(files[0]);
      }
    },
    [disabled, onFile],
  );

  const handleClick = useCallback(() => {
    if (!disabled) inputRef.current?.click();
  }, [disabled]);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (files && files.length === 1) {
        onFile(files[0]);
      }
      // Reset so the same file can be reselected
      if (inputRef.current) inputRef.current.value = '';
    },
    [onFile],
  );

  return (
    <div
      className={`
        relative w-full max-w-lg mx-auto mt-8
        border-2 border-dashed rounded-2xl
        transition-all duration-300 ease-out
        cursor-pointer select-none
        ${isDragOver ? 'border-buran-ice-dark bg-buran-ice-light scale-[1.02]' : 'border-buran-border bg-white hover:border-buran-ice-dark/50 hover:bg-buran-ice-light/30'}
        ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
      `}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={handleClick}
      role="button"
      tabIndex={0}
      aria-label={t.appDropPrompt}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleClick();
        }
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".jpg,.jpeg,.png,.webp,.heic,.heif,.pdf,.docx,.xlsx,.pptx,.zip"
        className="hidden"
        onChange={handleChange}
        disabled={disabled}
      />

      <div className="flex flex-col items-center py-12 px-6">
        {/* Upload icon */}
        <svg
          className={`w-12 h-12 mb-4 transition-colors duration-300 ${isDragOver ? 'text-buran-ice-dark' : 'text-buran-border'}`}
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth="1.5"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"
          />
        </svg>

        <p className="text-lg font-medium text-buran-text mb-1">
          {t.dropzoneTitle}
        </p>
        <p className="text-sm text-buran-text-secondary mb-4">
          {t.dropzoneOr}{' '}
          <span className="text-buran-ice-dark font-medium underline underline-offset-2">
            {t.dropzoneBrowse}
          </span>
        </p>

        <div className="flex gap-3 text-xs text-buran-text-secondary">
          <span className="px-2 py-1 bg-buran-ice-light rounded-full">{t.dropzoneFormats}</span>
          <span className="px-2 py-1 bg-buran-ice-light rounded-full">{t.dropzoneSizeLimit}</span>
        </div>
      </div>
    </div>
  );
}
