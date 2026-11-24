'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronRightIcon, PencilIcon } from '@/components/icons';

interface CameraCaptureProps {
  /** Called when the user confirms the photo they picked. */
  onCapture: (file: File) => void;
  onManualEntry?: () => void;
  /** True while the confirmed photo is being analysed. */
  processing?: boolean;
  statusMessage?: string;
}

/**
 * One button that opens the phone's own picker (which already offers
 * "Take photo" and "Photo library"), then a preview to confirm or retake.
 */
export default function CameraCapture({
  onCapture,
  onManualEntry,
  processing = false,
  statusMessage,
}: CameraCaptureProps) {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const openPicker = () => fileInputRef.current?.click();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files?.[0];
    e.target.value = '';
    if (!picked) return;
    setFile(picked);
    // HEIC can't be previewed in most browsers; it is converted before upload.
    const previewable = !/image\/hei[cf]/i.test(picked.type) && !/\.(heic|heif)$/i.test(picked.name);
    setPreviewUrl(previewable ? URL.createObjectURL(picked) : null);
  };

  const retake = () => {
    setFile(null);
    setPreviewUrl(null);
    openPicker();
  };

  return (
    <div className="space-y-4">
      {file ? (
        <div className="space-y-3">
          <div className="relative overflow-hidden rounded-3xl border border-line bg-black">
            {previewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={previewUrl}
                alt="Selected dashboard photo"
                className={`w-full max-h-[55vh] object-contain transition-opacity ${processing ? 'opacity-40' : ''}`}
              />
            ) : (
              <div className="flex h-56 items-center justify-center px-6 text-center text-sm text-white/80">
                {file.name}
              </div>
            )}

            {processing && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
                <div className="h-10 w-10 rounded-full border-4 border-white/30 border-t-white animate-spin" />
                <p className="text-sm font-semibold text-white">Reading your dashboard…</p>
                {statusMessage && <p className="text-xs text-white/85">{statusMessage}</p>}
              </div>
            )}
          </div>

          {!processing && (
            <>
              <p className="text-center text-xs text-muted">
                Make sure the trip distance and average mileage are sharp and readable.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={retake}
                  className="rounded-2xl border border-line bg-surface py-3.5 text-sm font-semibold text-ink hover:bg-surface-soft"
                >
                  Retake
                </button>
                <button
                  type="button"
                  onClick={() => onCapture(file)}
                  className="rounded-2xl bg-primary py-3.5 text-sm font-semibold text-on-primary hover:bg-primary-hover"
                >
                  Use photo
                </button>
              </div>
            </>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <button
            type="button"
            onClick={openPicker}
            className="flex w-full flex-col items-center gap-3 rounded-3xl border border-dashed border-primary-line bg-surface px-6 py-10 text-center hover:bg-primary-soft transition-colors"
          >
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-on-primary">
              <svg width="28" height="28" className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z" />
              </svg>
            </span>
            <span className="text-base font-bold text-ink">Scan dashboard</span>
            <span className="text-xs text-muted">Take a photo or choose one from your gallery</span>
          </button>

          {onManualEntry && (
            <>
              <div className="flex items-center gap-3 px-2" aria-hidden="true">
                <span className="h-px flex-1 bg-line" />
                <span className="text-[11px] font-medium uppercase tracking-wider text-muted">or</span>
                <span className="h-px flex-1 bg-line" />
              </div>
              <button
                type="button"
                onClick={onManualEntry}
                className="flex w-full items-center gap-3 rounded-2xl border border-line bg-surface p-4 text-left transition-colors hover:bg-surface-soft active:scale-[0.99]"
              >
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary">
                  <PencilIcon size={20} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-ink">Enter manually</span>
                  <span className="block text-xs text-muted">Type the distance and mileage yourself</span>
                </span>
                <ChevronRightIcon size={18} className="shrink-0 text-muted" />
              </button>
            </>
          )}
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,.heic,.heif"
        onChange={handleFileChange}
        className="hidden"
      />
    </div>
  );
}
