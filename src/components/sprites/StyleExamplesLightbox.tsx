'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';
import type { GenerationStyle } from '@/lib/styleRegistry';

interface Props {
  style: GenerationStyle | null;
  onClose: () => void;
  onUseStyle: () => void;
}

export function StyleExamplesLightbox({ style, onClose, onUseStyle }: Props) {
  const [index, setIndex] = useState(0);

  const slides = useMemo(() => style?.examplePaths ?? [], [style]);
  const total = slides.length;

  // Reset index when style changes — use a ref to track previous id
  const styleId = style?.id;
  const [prevStyleId, setPrevStyleId] = useState(styleId);
  if (styleId !== prevStyleId) {
    setPrevStyleId(styleId);
    setIndex(0);
  }

  const prev = useCallback(() => setIndex((i) => (i > 0 ? i - 1 : i)), []);
  const next = useCallback(() => setIndex((i) => (i < total - 1 ? i + 1 : i)), [total]);

  // Keyboard navigation
  useEffect(() => {
    if (!style || total === 0) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') prev();
      else if (e.key === 'ArrowRight') next();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [style, total, onClose, prev, next]);

  if (!style || total === 0) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/90"
      onClick={onClose}
    >
      <div
        className="relative flex flex-col items-center gap-4 max-w-[90vw] max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Toolbar */}
        <div className="flex items-center gap-3 self-end">
          <button
            type="button"
            onClick={onUseStyle}
            className="px-3 py-1.5 rounded-md bg-amber-400 text-black font-semibold text-sm hover:bg-amber-300 transition-colors"
          >
            Use this style →
          </button>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-md text-white/70 hover:text-white hover:bg-white/10 transition-colors"
            aria-label="Close lightbox"
          >
            <X size={20} />
          </button>
        </div>

        {/* Image */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={slides[index]}
          alt={`${style.label} example ${index + 1}`}
          draggable={false}
          className="max-w-[85vw] max-h-[75vh] object-contain"
          style={{ imageRendering: 'pixelated' }}
        />

        {/* Navigation */}
        {total > 1 && (
          <div className="flex items-center gap-4">
            <button
              onClick={prev}
              disabled={index === 0}
              className="p-1.5 rounded-md text-white/70 hover:text-white hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              aria-label="Previous example"
            >
              <ChevronLeft size={20} />
            </button>
            <span className="text-xs font-mono text-white/60">
              {index + 1} / {total}
            </span>
            <button
              onClick={next}
              disabled={index === total - 1}
              className="p-1.5 rounded-md text-white/70 hover:text-white hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              aria-label="Next example"
            >
              <ChevronRight size={20} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
