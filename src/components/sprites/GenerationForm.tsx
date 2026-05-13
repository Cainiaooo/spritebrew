'use client';

import { useState, useCallback, useEffect, useMemo } from 'react';
import { Sparkles, X, Check, Loader2, AlertCircle, ChevronDown, ChevronRight, Maximize2 } from 'lucide-react';
import { useSpriteStore } from '@/stores/spriteStore';
import Button from '@/components/ui/Button';
import ReferenceImagesPanel from '@/components/sprites/ReferenceImagesPanel';
import OutfitPicker from '@/components/sprites/OutfitPicker';
import { StyleExamplesLightbox } from './StyleExamplesLightbox';
import {
  GENERATION_STYLES,
  getStyleById,
  getTierLabel,
  type GenerationStyle,
  type StyleCategory,
} from '@/lib/styleRegistry';

const EXAMPLE_PROMPTS = [
  'pixel art knight with sword',
  'small goblin with wooden club',
  'wizard with blue robe and staff',
  'skeleton warrior with shield',
  'cute slime monster',
  'robot with laser gun',
];

const CATEGORY_LABELS: Record<StyleCategory, string> = {
  characters: 'Characters',
  items: 'Items',
  animations: 'Animations',
  tiles: 'Tiles',
  ui: 'UI',
  environments: 'Environments',
};

const GROUPED_STYLES = (() => {
  const groups: Partial<Record<StyleCategory, GenerationStyle[]>> = {};
  for (const style of GENERATION_STYLES) {
    (groups[style.category] ??= []).push(style);
  }
  return groups;
})();

const TIER_COLORS: Record<string, string> = {
  pro: 'text-purple-400 border-purple-400/30',
  plus: 'text-accent-amber border-accent-amber/30',
  fast: 'text-green-400 border-green-400/30',
  animation: 'text-accent-teal border-accent-teal/30',
};

interface GenerationFormProps {
  onGenerated: (imageUrl: string, prompt: string, style: string) => void;
}

export default function GenerationForm({ onGenerated }: GenerationFormProps) {
  const setGenerating = useSpriteStore((s) => s.setGenerating);
  const setGeneratingAction = useSpriteStore((s) => s.setGeneratingAction);
  const setGenerationError = useSpriteStore((s) => s.setGenerationError);
  const setGeneratedImage = useSpriteStore((s) => s.setGeneratedImage);
  const setGenerationStyle = useSpriteStore((s) => s.setGenerationStyle);
  const isGenerating = useSpriteStore((s) => s.isGenerating);
  const generationError = useSpriteStore((s) => s.generationError);

  const outfit = useSpriteStore((s) => s.outfit);
  const setOutfit = useSpriteStore((s) => s.setOutfit);

  const [prompt, setPrompt] = useState('');
  const [selectedStyleId, setSelectedStyleId] = useState(GENERATION_STYLES[0].id);
  const [customWidth, setCustomWidth] = useState(GENERATION_STYLES[0].defaultWidth);
  const [customHeight, setCustomHeight] = useState(GENERATION_STYLES[0].defaultHeight);
  const [removeBg, setRemoveBg] = useState(true);
  const [referenceImages, setReferenceImages] = useState<string[]>([]);
  // Per-category collapse state — empty Set = all expanded (default).
  const [collapsedCategories, setCollapsedCategories] = useState<Set<StyleCategory>>(new Set());
  // Style whose examples are open in the lightbox carousel. null = closed.
  const [lightboxStyle, setLightboxStyle] = useState<GenerationStyle | null>(null);

  const toggleCategory = (category: StyleCategory) => {
    setCollapsedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  };

  const selectedStyle = useMemo(
    () => getStyleById(selectedStyleId) ?? GENERATION_STYLES[0],
    [selectedStyleId]
  );

  const referencesEnabled = selectedStyle.supportsReferenceImages === true;

  useEffect(() => {
    setCustomWidth(selectedStyle.defaultWidth);
    setCustomHeight(selectedStyle.defaultHeight);
    setRemoveBg(selectedStyle.supportsRemoveBg && selectedStyle.category !== 'tiles');
  }, [selectedStyle]);

  const effectiveWidth = selectedStyle.fixedSize ? selectedStyle.defaultWidth : customWidth;
  const effectiveHeight = selectedStyle.fixedSize ? selectedStyle.defaultHeight : customHeight;

  const handleGenerate = useCallback(async () => {
    if (!prompt.trim() || isGenerating) return;

    setGenerating(true);
    setGeneratingAction(null);
    setGenerationError(null);

    try {
      const body: Record<string, unknown> = {
        prompt: prompt.trim(),
        promptStyle: selectedStyle.promptStyle,
        width: effectiveWidth,
        height: effectiveHeight,
      };

      if (removeBg && selectedStyle.supportsRemoveBg) {
        body.removeBg = true;
      }

      if (referenceImages.length > 0 && referencesEnabled) {
        body.referenceImages = referenceImages;
      }

      if (outfit && Object.keys(outfit).length > 0) {
        body.outfit = outfit;
      }

      const { fetchGenerationSSE } = await import('@/lib/sseClient');
      const data = await fetchGenerationSSE(body, {
        authToken: null,
        onPartialImage: (imageUrl) => {
          setGeneratedImage(imageUrl, imageUrl);
        },
      });

      if (!data.success) {
        setGenerationError(String(data.error ?? 'Generation failed — try a different prompt.'));
        return;
      }

      const dataUrl = data.imageUrl!;
      setGeneratedImage(dataUrl, dataUrl);
      setGenerationStyle(selectedStyleId);
      onGenerated(dataUrl, prompt.trim(), selectedStyleId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setGenerationError(`Connection failed — ${msg}`);
    } finally {
      setGenerating(false);
      setGeneratingAction(null);
    }
  }, [
    prompt, selectedStyle, selectedStyleId, effectiveWidth, effectiveHeight,
    removeBg, referenceImages, referencesEnabled, outfit, isGenerating,
    setGenerating, setGeneratingAction, setGenerationError, setGeneratedImage,
    setGenerationStyle, onGenerated,
  ]);

  return (
    <div className="space-y-6">
      <div>
        <label className="block text-xs font-mono text-text-secondary uppercase tracking-wider mb-2">
          {selectedStyle.isAnimation ? 'Describe the character to animate' : 'Describe what to generate'}
        </label>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={
            selectedStyle.isAnimation
              ? "Describe the character. Keep it simple — 'knight with sword', 'goblin with club'."
              : "Describe what you want to generate. Be specific about style and details."
          }
          rows={3}
          className="w-full rounded-lg bg-bg-elevated border border-border-default px-4 py-3
            text-sm font-mono text-text-primary placeholder:text-text-muted resize-none
            focus:outline-none focus:border-accent-amber"
        />
        <div className="flex flex-wrap gap-1.5 mt-3">
          {EXAMPLE_PROMPTS.map((ex) => (
            <button
              key={ex}
              onClick={() => setPrompt(ex)}
              className="px-2.5 py-1 rounded text-[10px] font-mono bg-bg-elevated text-text-muted
                border border-border-subtle hover:bg-bg-hover hover:text-text-secondary cursor-pointer
                transition-colors"
            >
              {ex}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-xs font-mono text-text-secondary uppercase tracking-wider mb-3">
          Style
          <span className="text-text-muted font-normal ml-2">
            ({GENERATION_STYLES.length} styles across {Object.keys(GROUPED_STYLES).length} categories)
          </span>
        </label>
        <div className="space-y-3 max-h-[360px] overflow-y-auto pr-1">
          {(Object.entries(GROUPED_STYLES) as [StyleCategory, GenerationStyle[]][]).map(
            ([category, styles]) => (
              <div key={category}>
                <button
                  type="button"
                  onClick={() => toggleCategory(category)}
                  className="flex items-center gap-1 w-full text-left text-[10px] font-mono text-text-muted uppercase tracking-wider mb-1.5 cursor-pointer hover:text-text-secondary transition-colors"
                >
                  {collapsedCategories.has(category) ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                  {CATEGORY_LABELS[category]}
                  <span className="text-text-muted/50 ml-1">({styles.length})</span>
                </button>
                {!collapsedCategories.has(category) && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                  {styles.map((style) => {
                    const active = selectedStyleId === style.id;
                    return (
                      <button
                        key={style.id}
                        onClick={() => setSelectedStyleId(style.id)}
                        className={`text-left rounded-lg border px-3 py-2 transition-all duration-150 cursor-pointer
                          ${active
                            ? 'border-accent-amber bg-accent-amber-glow'
                            : 'border-border-default bg-bg-surface hover:border-border-strong hover:bg-bg-elevated'
                          }`}
                      >
                        <div className="flex items-center gap-1.5">
                          {style.examplePaths?.[0] && (
                            /* eslint-disable-next-line @next/next/no-img-element */
                            <img
                              src={style.examplePaths[0]}
                              alt=""
                              className="w-6 h-6 rounded flex-shrink-0 object-cover"
                              style={{ imageRendering: 'pixelated' }}
                            />
                          )}
                          <h3 className={`text-[11px] font-mono font-semibold truncate ${active ? 'text-accent-amber' : 'text-text-primary'}`}>
                            {style.label}
                          </h3>
                          {active && <Check size={10} className="text-accent-amber flex-shrink-0" />}
                          {style.examplePaths && style.examplePaths.length > 0 && (
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); setLightboxStyle(style); }}
                              className="ml-auto p-0.5 rounded text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors flex-shrink-0"
                              aria-label={`View ${style.label} examples`}
                              title="View examples"
                            >
                              <Maximize2 size={10} />
                            </button>
                          )}
                          <span className={`${style.examplePaths?.length ? '' : 'ml-auto'} text-[8px] font-mono px-1.5 py-0.5 rounded border flex-shrink-0 ${TIER_COLORS[style.tier] ?? 'text-text-muted border-border-subtle'}`}>
                            {getTierLabel(style.tier)}
                          </span>
                        </div>
                        <p className="text-[9px] font-mono text-text-muted mt-0.5 truncate">
                          {style.description}
                        </p>
                      </button>
                    );
                  })}
                </div>
                )}
              </div>
            )
          )}
        </div>
        <p className="text-[9px] font-mono text-text-muted mt-2">
          For animating an existing character, use the Animate My Character tab.
        </p>
      </div>

      <ReferenceImagesPanel
        referenceImages={referenceImages}
        onChange={setReferenceImages}
        enabled={referencesEnabled}
      />

      <OutfitPicker value={outfit} onChange={setOutfit} />

      <div>
        <label className="block text-[10px] font-mono text-text-muted mb-1">
          Size: {effectiveWidth}x{effectiveHeight}
          {selectedStyle.fixedSize && (
            <span className="ml-2 text-text-muted/60">(fixed for this style)</span>
          )}
        </label>
        {!selectedStyle.fixedSize ? (
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-[9px] font-mono text-text-muted mb-1">Width</label>
              <input
                type="number"
                min={selectedStyle.minSize}
                max={selectedStyle.maxSize}
                value={customWidth}
                onChange={(e) => setCustomWidth(Math.max(selectedStyle.minSize, Math.min(selectedStyle.maxSize, Number(e.target.value))))}
                className="w-full rounded bg-bg-elevated border border-border-default px-3 py-1.5
                  text-xs font-mono text-text-primary focus:outline-none focus:border-accent-amber"
              />
            </div>
            <div className="flex-1">
              <label className="block text-[9px] font-mono text-text-muted mb-1">Height</label>
              <input
                type="number"
                min={selectedStyle.minSize}
                max={selectedStyle.maxSize}
                value={customHeight}
                onChange={(e) => setCustomHeight(Math.max(selectedStyle.minSize, Math.min(selectedStyle.maxSize, Number(e.target.value))))}
                className="w-full rounded bg-bg-elevated border border-border-default px-3 py-1.5
                  text-xs font-mono text-text-primary focus:outline-none focus:border-accent-amber"
              />
            </div>
          </div>
        ) : (
          <p className="text-[9px] font-mono text-text-muted">
            This style uses fixed {effectiveWidth}x{effectiveHeight} dimensions.
          </p>
        )}
      </div>

      {selectedStyle.supportsRemoveBg && (
        <label className="flex items-center gap-2 text-xs font-mono text-text-secondary cursor-pointer">
          <input
            type="checkbox"
            checked={removeBg}
            onChange={(e) => setRemoveBg(e.target.checked)}
            className="accent-[var(--accent-amber)] cursor-pointer"
          />
          Remove background (transparent output)
        </label>
      )}

      {generationError && (
        <div className="flex items-start gap-2 rounded-lg bg-red-500/10 border border-red-500/20 px-4 py-3">
          <AlertCircle size={14} className="text-red-400 flex-shrink-0 mt-0.5" />
          <p className="text-xs font-mono text-red-400">{generationError}</p>
          <button
            onClick={() => setGenerationError(null)}
            className="ml-auto text-red-400 hover:text-red-300 cursor-pointer flex-shrink-0"
          >
            <X size={12} />
          </button>
        </div>
      )}

      <div className="flex items-center justify-between">
        <p className="text-[10px] font-mono text-text-muted">
          {effectiveWidth}x{effectiveHeight}px
        </p>
        <Button
          size="lg"
          onClick={handleGenerate}
          disabled={!prompt.trim() || isGenerating}
          className={!isGenerating && prompt.trim() ? 'animate-pulse' : ''}
        >
          {isGenerating ? (
            <>
              <Loader2 size={16} className="animate-spin" />
              Brewing...
            </>
          ) : (
            <>
              <Sparkles size={16} />
              {selectedStyle.isAnimation ? 'Generate Animation' : 'Generate Sprite'}
            </>
          )}
        </Button>
      </div>

      <StyleExamplesLightbox
        style={lightboxStyle}
        onClose={() => setLightboxStyle(null)}
        onUseStyle={() => {
          if (lightboxStyle) setSelectedStyleId(lightboxStyle.id);
          setLightboxStyle(null);
        }}
      />
    </div>
  );
}
