'use client';

import {
  useRef,
  useState,
  useCallback,
  useEffect,
  type DragEvent,
} from 'react';
import { X, ImagePlus, AlertCircle } from 'lucide-react';

import { MAX_REFERENCE_IMAGES } from '@/lib/imageGen/referenceLimits';

interface ReferenceImagesPanelProps {
  /** Array of base64 PNG strings (no `data:` prefix), preprocessed and ready for API submission */
  referenceImages: string[];
  /** Setter — replaces the array */
  onChange: (images: string[]) => void;
  /** When false, render a "switch to a Pro style" hint and disable upload affordance.
   *  Existing references are preserved (not auto-cleared) when this goes false. */
  enabled: boolean;
}

const MAX_LONGEST_EDGE = 256;
const MAX_BASE64_CHARS = 1_400_000;
const ACCEPTED_MIME = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif'];
const ACCEPTED_EXT = /\.(png|jpe?g|webp|gif)$/i;
// Neutral grey flatten — least bias toward bright/dark output. Tweakable later
// if empirical results show a different background works better.
const NEUTRAL_BG = '#808080';

async function preprocessFile(file: File): Promise<string> {
  if (!ACCEPTED_MIME.includes(file.type) && !ACCEPTED_EXT.test(file.name)) {
    throw new Error('Only PNG, JPG, WEBP, and GIF supported.');
  }

  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('Could not read image file.'));
      i.src = url;
    });

    const longest = Math.max(img.width, img.height);
    const scale = longest > MAX_LONGEST_EDGE ? MAX_LONGEST_EDGE / longest : 1;
    const newW = Math.max(1, Math.floor(img.width * scale));
    const newH = Math.max(1, Math.floor(img.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = newW;
    canvas.height = newH;
    const ctx = canvas.getContext('2d', { willReadFrequently: false });
    if (!ctx) throw new Error('Canvas not available.');
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = NEUTRAL_BG;
    ctx.fillRect(0, 0, newW, newH);
    ctx.drawImage(img, 0, 0, newW, newH);

    const dataUrl = canvas.toDataURL('image/png');
    const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');
    if (base64.length > MAX_BASE64_CHARS) {
      throw new Error('Image too large after preprocessing. Try a smaller source.');
    }
    return base64;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export default function ReferenceImagesPanel({
  referenceImages,
  onChange,
  enabled,
}: ReferenceImagesPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 4000);
    return () => clearTimeout(t);
  }, [error]);

  const handleFiles = useCallback(
    async (incoming: FileList | null) => {
      if (!enabled || !incoming || incoming.length === 0) return;

      let files = Array.from(incoming);
      const remaining = MAX_REFERENCE_IMAGES - referenceImages.length;
      if (files.length > remaining) {
        setError(
          `Maximum ${MAX_REFERENCE_IMAGES} reference images. Only the first ${remaining} added.`,
        );
        files = files.slice(0, remaining);
      }

      const accumulator: string[] = [];
      for (const f of files) {
        try {
          const b64 = await preprocessFile(f);
          accumulator.push(b64);
        } catch (e) {
          const msg = e instanceof Error ? e.message : 'Could not process image.';
          setError(msg);
        }
      }

      if (accumulator.length > 0) {
        onChange([...referenceImages, ...accumulator]);
      }

      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    },
    [enabled, referenceImages, onChange]
  );

  const onRemove = (index: number) => {
    const next = [...referenceImages];
    next.splice(index, 1);
    onChange(next);
  };

  const triggerFilePicker = () => {
    if (!enabled) return;
    fileInputRef.current?.click();
  };

  const onDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (!enabled) return;
    e.preventDefault();
    setIsDragging(true);
  };

  const onDragLeave = (e: DragEvent<HTMLDivElement>) => {
    if (!enabled) return;
    e.preventDefault();
    setIsDragging(false);
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    if (!enabled) return;
    e.preventDefault();
    setIsDragging(false);
    void handleFiles(e.dataTransfer.files);
  };

  const count = referenceImages.length;

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="block text-xs font-mono text-text-secondary uppercase tracking-wider">
          Reference Images
          <span className="text-text-muted font-normal normal-case ml-2">(optional)</span>
        </label>
        <span className={`text-[10px] font-mono ${count > 0 ? 'text-accent-amber' : 'text-text-muted'}`}>
          {count} / {MAX_REFERENCE_IMAGES}
        </span>
      </div>

      <p className="text-[10px] font-mono text-text-muted leading-relaxed mb-3">
        Up to {MAX_REFERENCE_IMAGES} images that guide the style, palette, and design feel of your
        sprite.
        References do NOT preserve a specific character&apos;s identity across new poses.
      </p>

      {!enabled && (
        <div className="rounded-lg bg-bg-elevated border border-border-subtle px-3 py-2 mb-3">
          <p className="text-[10px] font-mono text-text-muted leading-relaxed">
            Reference images only work with Pro styles. Switch to a Pro style to enable uploads.
          </p>
          {count > 0 && (
            <p className="text-[10px] font-mono text-amber-300/80 leading-relaxed mt-1">
              Your {count} reference image{count === 1 ? '' : 's'} won&apos;t be used with the
              current style. They&apos;ll be sent if you switch back to a Pro style.
            </p>
          )}
        </div>
      )}

      <input
        type="file"
        accept="image/png,image/jpeg,image/jpg,image/webp,image/gif"
        multiple
        ref={fileInputRef}
        onChange={(e) => void handleFiles(e.target.files)}
        style={{ display: 'none' }}
      />

      {count === 0 ? (
        <div
          onClick={triggerFilePicker}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          aria-disabled={!enabled}
          className={`rounded-lg border-2 border-dashed px-4 py-6 flex flex-col items-center justify-center gap-1.5 transition-colors ${
            !enabled
              ? 'border-border-subtle bg-bg-surface/30 opacity-60 cursor-not-allowed'
              : isDragging
                ? 'border-accent-amber bg-accent-amber-glow cursor-pointer'
                : 'border-border-default bg-bg-surface hover:border-border-strong hover:bg-bg-elevated cursor-pointer'
          }`}
        >
          <ImagePlus size={20} className={enabled ? 'text-text-secondary' : 'text-text-muted'} />
          <p className={`text-xs font-mono ${enabled ? 'text-text-secondary' : 'text-text-muted'}`}>
            Add Images
          </p>
          <p className="text-[10px] font-mono text-text-muted">
            Drop images or click to browse · {MAX_REFERENCE_IMAGES} max · PNG/JPG/WEBP
          </p>
        </div>
      ) : (
        <div
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          className={`rounded-lg p-1 transition-all ${
            isDragging && enabled ? 'ring-2 ring-accent-amber/50' : ''
          }`}
        >
          <div className="grid grid-cols-3 gap-2">
            {referenceImages.map((img, i) => (
              <div
                key={i}
                className="relative w-24 h-24 rounded border border-border-default bg-bg-elevated overflow-hidden"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`data:image/png;base64,${img}`}
                  alt={`Reference ${i + 1}`}
                  className="pixel-art-render w-full h-full object-contain"
                />
                <button
                  type="button"
                  onClick={() => onRemove(i)}
                  className="absolute top-1 right-1 rounded-full bg-bg-primary/90 hover:bg-red-500/90
                    text-text-primary p-0.5 cursor-pointer opacity-90 hover:opacity-100 transition-colors"
                  aria-label={`Remove reference ${i + 1}`}
                >
                  <X size={10} />
                </button>
              </div>
            ))}
            {count < MAX_REFERENCE_IMAGES && (
              <button
                type="button"
                onClick={triggerFilePicker}
                disabled={!enabled}
                className={`w-24 h-24 rounded border-2 border-dashed flex flex-col items-center justify-center gap-1 transition-colors ${
                  !enabled
                    ? 'border-border-subtle bg-bg-surface/30 opacity-60 cursor-not-allowed'
                    : 'border-border-default bg-bg-surface hover:border-border-strong hover:bg-bg-elevated cursor-pointer'
                }`}
              >
                <ImagePlus size={16} className={enabled ? 'text-text-secondary' : 'text-text-muted'} />
                <span className={`text-[9px] font-mono ${enabled ? 'text-text-secondary' : 'text-text-muted'}`}>
                  Add More
                </span>
              </button>
            )}
          </div>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2 mt-2">
          <AlertCircle size={12} className="text-red-400 flex-shrink-0 mt-0.5" />
          <p className="text-[10px] font-mono text-red-400 leading-relaxed">{error}</p>
        </div>
      )}
    </div>
  );
}
