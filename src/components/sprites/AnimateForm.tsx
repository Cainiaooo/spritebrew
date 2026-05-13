'use client';

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import {
  UploadCloud,
  X,
  Check,
  Loader2,
  AlertCircle,
  Play,
  Lock,
} from 'lucide-react';
import { useSpriteStore } from '@/stores/spriteStore';
import Button from '@/components/ui/Button';
import CharacterAutoPrep from './CharacterAutoPrep';
import {
  STICKY_CTA_BAR_CLASS_NAME,
  STICKY_CTA_BAR_STYLE,
  STICKY_CTA_SPACER_CLASS_NAME,
} from './stickyCta';
import {
  getResolutionMode,
  ADVANCED_ANIM_RESOLUTION_PRESETS,
  ADVANCED_ANIM_DEFAULT_RESOLUTION,
} from '@/lib/styleRegistry';

const ACTIONS = [
  { id: 'walking', name: 'Walk', desc: 'Walking cycle animation' },
  { id: 'idle', name: 'Idle', desc: 'Breathing/subtle idle loop' },
  { id: 'attack', name: 'Attack', desc: 'Melee attack swing' },
  { id: 'jump', name: 'Jump', desc: 'Jump arc animation' },
  { id: 'crouch', name: 'Crouch', desc: 'Crouch/duck animation' },
  { id: 'destroy', name: 'Destroy', desc: 'Death/destruction animation' },
  { id: 'subtle_motion', name: 'Subtle Motion', desc: 'Wind, cape flutter, ambient' },
  { id: 'custom_action', name: 'Custom Action', desc: 'Describe any action' },
] as const;

/** Actions where the character needs margin for weapon swings / motion FX. */
const PADDING_ON_ACTIONS = new Set([
  'attack',
  'jump',
  'destroy',
  'custom_action',
]);

/** Map action id to the RD prompt_style for token cost lookup. */
const ACTION_STYLE_MAP: Record<string, string> = {
  walking: 'rd_advanced_animation__walking',
  idle: 'rd_advanced_animation__idle',
  attack: 'rd_advanced_animation__attack',
  jump: 'rd_advanced_animation__jump',
  crouch: 'rd_advanced_animation__crouch',
  destroy: 'rd_advanced_animation__destroy',
  subtle_motion: 'rd_advanced_animation__subtle_motion',
  custom_action: 'rd_advanced_animation__custom_action',
};

// Phase 6 narrows the v1 set to 4/6/8 — higher counts return in a later phase
// once frame consistency at higher counts is validated.
const FRAME_COUNTS = [4, 6, 8] as const;

const BG_COLORS = [
  { id: 'black', label: 'Black', color: '#000000' },
  { id: 'white', label: 'White', color: '#ffffff' },
  { id: 'green', label: 'Green', color: '#00ff00' },
  { id: 'magenta', label: 'Magenta', color: '#ff00ff' },
] as const;

interface AnimateFormProps {
  onGenerated: (dataUrl: string, prompt: string, style: string) => void;
}

export default function AnimateForm({ onGenerated }: AnimateFormProps) {
  const setGenerating = useSpriteStore((s) => s.setGenerating);
  const setGeneratingAction = useSpriteStore((s) => s.setGeneratingAction);
  const setGenerationError = useSpriteStore((s) => s.setGenerationError);
  const setGeneratedImage = useSpriteStore((s) => s.setGeneratedImage);
  const setGenerationStyle = useSpriteStore((s) => s.setGenerationStyle);
  const setOriginalCharacter = useSpriteStore((s) => s.setOriginalCharacter);
  const isGenerating = useSpriteStore((s) => s.isGenerating);
  const generationError = useSpriteStore((s) => s.generationError);

  // Character state
  const [characterDataUrl, setCharacterDataUrl] = useState<string | null>(null);
  const [charWidth, setCharWidth] = useState(0);
  const [charHeight, setCharHeight] = useState(0);
  const [hasAlpha, setHasAlpha] = useState(false);
  const [pendingDataUrl, setPendingDataUrl] = useState<string | null>(null);
  const [pendingWidth, setPendingWidth] = useState(0);
  const [pendingHeight, setPendingHeight] = useState(0);
  const [bgColor, setBgColor] = useState('#000000');
  const [paddingEnabled, setPaddingEnabled] = useState(false);
  const [characterSizePct, setCharacterSizePct] = useState(75);
  const [selectedAction, setSelectedAction] = useState('walking');
  const [frameCount, setFrameCount] = useState<number>(4);
  const [motionPrompt, setMotionPrompt] = useState('');
  const [selectedResolution, setSelectedResolution] = useState<number>(ADVANCED_ANIM_DEFAULT_RESOLUTION);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const actionPromptStyle = ACTION_STYLE_MAP[selectedAction] ?? 'rd_advanced_animation__walking';

  // Resolution mode for the currently selected action's prompt style.
  // Family B (rd_advanced_animation__*) always returns a 'variable' mode 32–256.
  // If a future action ever maps to a Family A style, the mode adapts.
  const currentMode = useMemo(
    () => getResolutionMode(actionPromptStyle) ?? { kind: 'variable' as const, min: 32 as const, max: 256 as const, default: ADVANCED_ANIM_DEFAULT_RESOLUTION },
    [actionPromptStyle]
  );

  // Auto-toggle animation padding based on selected action.
  useEffect(() => {
    setPaddingEnabled(PADDING_ON_ACTIONS.has(selectedAction));
  }, [selectedAction]);

  // When the selected action's mode changes, snap selectedResolution to its default/locked size.
  useEffect(() => {
    const newSize = currentMode.kind === 'locked' ? currentMode.size : currentMode.default;
    setSelectedResolution((prev) => (prev === newSize ? prev : newSize));
  }, [currentMode]);

  // When resolution changes after a character is already prepped, invalidate it
  // so the user re-runs Auto-Prep at the new size. This is simpler and more
  // reliable than trying to silently re-resize the prepped image.
  const handleResolutionChange = useCallback((newRes: number) => {
    if (newRes === selectedResolution) return;
    setSelectedResolution(newRes);
    // If character was already prepped at a different size, clear it
    if (characterDataUrl && (charWidth !== newRes || charHeight !== newRes)) {
      setCharacterDataUrl(null);
      setCharWidth(0);
      setCharHeight(0);
      setHasAlpha(false);
      // Re-show the pending image so Auto-Prep can re-run at new size
      // (only if we still have the original upload)
    }
  }, [selectedResolution, characterDataUrl, charWidth, charHeight]);

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    if (file.type !== 'image/png') {
      useSpriteStore.getState().setGenerationError('Please upload a PNG file.');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const img = new Image();
      img.onload = () => {
        setPendingDataUrl(dataUrl);
        setPendingWidth(img.naturalWidth);
        setPendingHeight(img.naturalHeight);
        setCharacterDataUrl(null);
        setCharWidth(0);
        setCharHeight(0);
        setHasAlpha(false);
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  }, []);

  const handleRemoveChar = useCallback(() => {
    setCharacterDataUrl(null);
    setCharWidth(0);
    setCharHeight(0);
    setHasAlpha(false);
    setPendingDataUrl(null);
    setPendingWidth(0);
    setPendingHeight(0);
  }, []);

  const handleAutoPrepAccept = useCallback(
    (preparedDataUrl: string, w: number, h: number) => {
      setCharacterDataUrl(preparedDataUrl);
      setCharWidth(w);
      setCharHeight(h);
      setHasAlpha(true);
      setPendingDataUrl(null);
      setPendingWidth(0);
      setPendingHeight(0);
    },
    []
  );

  const handleAutoPrepCancel = useCallback(() => {
    setPendingDataUrl(null);
    setPendingWidth(0);
    setPendingHeight(0);
  }, []);

  /** Convert the uploaded RGBA image to RGB by compositing onto bgColor */
  const convertToRgbBase64 = useCallback((): string | null => {
    if (!characterDataUrl) return null;

    const img = new Image();
    img.src = characterDataUrl;
    const canvas = document.createElement('canvas');
    canvas.width = charWidth;
    canvas.height = charHeight;
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;

    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, charWidth, charHeight);
    ctx.drawImage(img, 0, 0);

    return canvas.toDataURL('image/png').replace(/^data:image\/png;base64,/, '');
  }, [characterDataUrl, charWidth, charHeight, bgColor]);

  const handleGenerate = useCallback(async () => {
    if (!characterDataUrl || isGenerating) return;

    const rgbBase64 = convertToRgbBase64();
    if (!rgbBase64) return;

    setGenerating(true);
    setGeneratingAction(selectedAction);
    setGenerationError(null);
    setOriginalCharacter(characterDataUrl);

    try {
      const body: Record<string, unknown> = {
        mode: 'animate',
        inputImage: rgbBase64,
        action: selectedAction,
        width: selectedResolution,
        height: selectedResolution,
        framesDuration: frameCount,
      };

      if (motionPrompt.trim()) {
        body.motionPrompt = motionPrompt.trim();
      }

      const { fetchGenerationSSE } = await import('@/lib/sseClient');
      const data = await fetchGenerationSSE(body, {
        authToken: null,
        onPartialImage: (imageUrl) => {
          setGeneratedImage(imageUrl, imageUrl);
        },
      });

      if (!data.success) {
        setGenerationError(String(data.error ?? 'Animation failed — try again.'));
        return;
      }

      const dataUrl = data.imageUrl!;

      setGeneratedImage(dataUrl, dataUrl);
      setGenerationStyle(`any_animation_${selectedAction}`);
      onGenerated(dataUrl, motionPrompt.trim() || selectedAction, `any_animation_${selectedAction}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setGenerationError(`Connection failed — ${msg}`);
    } finally {
      setGenerating(false);
      setGeneratingAction(null);
    }
  }, [
    characterDataUrl, isGenerating, selectedAction, selectedResolution,
    frameCount, motionPrompt, convertToRgbBase64,
    setGenerating, setGeneratingAction, setGenerationError, setGeneratedImage,
    setGenerationStyle, setOriginalCharacter, onGenerated,
  ]);

  const sizeWarning = charWidth > 0 && (charWidth !== selectedResolution || charHeight !== selectedResolution);
  const isCustomAction = selectedAction === 'custom_action';
  const canGenerate = characterDataUrl && !sizeWarning && (!isCustomAction || motionPrompt.trim());

  return (
    <>
    <div className="space-y-6">
      {/* Character upload */}
      <div>
        <label className="block text-xs font-mono text-text-secondary uppercase tracking-wider mb-2">
          Your Character
        </label>

        {characterDataUrl ? (
          <div className="rounded-lg border border-border-default bg-bg-surface p-4">
            <div className="flex items-start gap-4">
              <div
                className="flex-shrink-0 rounded border border-border-subtle overflow-hidden"
                style={{
                  backgroundImage:
                    'linear-gradient(45deg, #2a2725 25%, transparent 25%), linear-gradient(-45deg, #2a2725 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #2a2725 75%), linear-gradient(-45deg, transparent 75%, #2a2725 75%)',
                  backgroundSize: '8px 8px',
                  backgroundPosition: '0 0, 0 4px, 4px -4px, -4px 0',
                }}
              >
                <img
                  src={characterDataUrl}
                  alt="Character"
                  className="block max-w-[128px] max-h-[128px]"
                  style={{ imageRendering: 'pixelated' }}
                />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-mono text-text-primary">Character ready</p>
                <p className="text-[10px] font-mono text-text-muted mt-1">
                  {charWidth}x{charHeight} · transparent background
                </p>
                <p className="text-[10px] font-mono text-green-400 mt-1">
                  Ready for animation
                </p>
              </div>
              <button
                onClick={handleRemoveChar}
                className="flex-shrink-0 p-1.5 rounded text-text-muted hover:text-text-primary hover:bg-bg-hover cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>
          </div>
        ) : pendingDataUrl ? null : (
          <div
            onClick={() => fileInputRef.current?.click()}
            className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed
              border-border-default bg-bg-surface py-12 px-8 cursor-pointer transition-all duration-200
              hover:border-border-strong hover:bg-bg-elevated"
          >
            <div className="flex items-center justify-center w-14 h-14 rounded-lg bg-bg-elevated mb-4">
              <UploadCloud size={28} className="text-text-muted" />
            </div>
            <p className="text-sm font-mono text-text-secondary mb-1">
              Drop your pixel art character here
            </p>
            <p className="text-[10px] font-mono text-text-muted mb-3">
              PNG only &middot; any size — we&apos;ll auto-crop and resize
            </p>
            <Button
              variant="secondary"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                fileInputRef.current?.click();
              }}
            >
              Browse files
            </Button>
          </div>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept=".png"
          onChange={handleFileUpload}
          className="hidden"
        />
      </div>

      {/* Resolution picker — placed before Auto-Prep so users choose size first.
          Picker rendering depends on the selected style's resolutionMode:
          - locked  → non-editable label
          - variable / variable_special → preset buttons */}
      <div>
        <label className="block text-xs font-mono text-text-secondary uppercase tracking-wider mb-2">
          Resolution
        </label>
        {currentMode.kind === 'locked' ? (
          <div className="inline-flex items-center gap-2 px-3 py-2 rounded bg-bg-elevated border border-border-default text-xs font-mono text-text-secondary">
            <Lock size={12} className="text-text-muted" />
            {currentMode.size}&times;{currentMode.size}
            <span className="text-[10px] text-text-muted">(locked for this style)</span>
          </div>
        ) : (
          <div className="flex gap-1.5">
            {(currentMode.kind === 'variable_special'
              ? currentMode.presets
              : (ADVANCED_ANIM_RESOLUTION_PRESETS as readonly number[])
            ).map((res) => (
              <button
                key={res}
                onClick={() => handleResolutionChange(res)}
                className={`px-3 py-1.5 rounded text-xs font-mono cursor-pointer transition-colors
                  ${selectedResolution === res
                    ? 'bg-accent-amber text-bg-primary'
                    : 'bg-bg-elevated text-text-secondary hover:bg-bg-hover border border-border-subtle'
                  }`}
              >
                {res}
              </button>
            ))}
          </div>
        )}
        <p className="text-[9px] font-mono text-text-muted/70 mt-1">
          {currentMode.kind === 'locked'
            ? 'This style is locked at this resolution. For higher resolutions, choose a Walking/Idle/Attack style instead.'
            : 'Larger = more detail. Cost is flat per generation — no resolution surcharge.'}
        </p>
      </div>

      {/* Auto-prep pipeline — resizes to selectedResolution × selectedResolution */}
      {pendingDataUrl && (
        <CharacterAutoPrep
          sourceDataUrl={pendingDataUrl}
          sourceWidth={pendingWidth}
          sourceHeight={pendingHeight}
          targetSize={selectedResolution}
          onAccept={handleAutoPrepAccept}
          onCancel={handleAutoPrepCancel}
          paddingEnabled={paddingEnabled}
          characterSizePct={characterSizePct}
          onPaddingEnabledChange={setPaddingEnabled}
          onCharacterSizePctChange={setCharacterSizePct}
        />
      )}

      {/* Background color for transparency */}
      {hasAlpha && characterDataUrl && (
        <div>
          <label className="block text-[10px] font-mono text-text-muted mb-2">
            Background fill for transparent areas
          </label>
          <div className="flex gap-2 items-center">
            {BG_COLORS.map((bg) => (
              <button
                key={bg.id}
                onClick={() => setBgColor(bg.color)}
                title={bg.label}
                className={`w-7 h-7 rounded border-2 cursor-pointer transition-all ${
                  bgColor === bg.color
                    ? 'border-accent-amber ring-1 ring-accent-amber'
                    : 'border-border-default hover:border-border-strong'
                }`}
                style={{ backgroundColor: bg.color }}
              />
            ))}
            <input
              type="color"
              value={bgColor}
              onChange={(e) => setBgColor(e.target.value)}
              className="w-7 h-7 rounded cursor-pointer border-0"
              title="Custom color"
            />
          </div>
        </div>
      )}

      {/* Action selector */}
      <div>
        <label className="block text-xs font-mono text-text-secondary uppercase tracking-wider mb-3">
          Animation Action
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {ACTIONS.map((action) => {
            const active = selectedAction === action.id;
            return (
              <button
                key={action.id}
                onClick={() => setSelectedAction(action.id)}
                className={`
                  text-left rounded-lg border p-3 transition-all duration-150 cursor-pointer
                  ${active
                    ? 'border-accent-amber bg-accent-amber-glow'
                    : 'border-border-default bg-bg-surface hover:border-border-strong hover:bg-bg-elevated'
                  }
                `}
              >
                <div className="flex items-center gap-2 mb-0.5">
                  <h3 className={`text-xs font-mono font-semibold ${active ? 'text-accent-amber' : 'text-text-primary'}`}>
                    {action.name}
                  </h3>
                  {active && <Check size={12} className="text-accent-amber" />}
                </div>
                <p className="text-[10px] font-mono text-text-muted">{action.desc}</p>
              </button>
            );
          })}
        </div>
      </div>

      {/* Frame count */}
      <div>
        <label className="block text-[10px] font-mono text-text-muted mb-2">
          Frame count
        </label>
        <div className="flex gap-1.5">
          {FRAME_COUNTS.map((fc) => (
            <button
              key={fc}
              onClick={() => setFrameCount(fc)}
              className={`px-3 py-1.5 rounded text-xs font-mono cursor-pointer transition-colors
                ${frameCount === fc
                  ? 'bg-accent-amber text-bg-primary'
                  : 'bg-bg-elevated text-text-secondary hover:bg-bg-hover border border-border-subtle'
                }`}
            >
              {fc}
            </button>
          ))}
        </div>
        <p className="text-[9px] font-mono text-text-muted mt-1">
          More frames = smoother animation, longer generation time
        </p>
      </div>

      {/* Motion prompt */}
      <div>
        <label className="block text-[10px] font-mono text-text-muted mb-1">
          Motion description {isCustomAction ? '(required)' : '(optional — less is more)'}
        </label>
        <textarea
          value={motionPrompt}
          onChange={(e) => setMotionPrompt(e.target.value)}
          placeholder="Keep short (2-4 words) or leave blank. e.g., walking forward, sword swing"
          rows={2}
          className="w-full rounded-lg bg-bg-elevated border border-border-default px-3 py-2
            text-xs font-mono text-text-primary placeholder:text-text-muted resize-none
            focus:outline-none focus:border-accent-amber"
        />
        <p className="text-[9px] font-mono text-text-muted/70 mt-1">
          For best character fidelity, leave blank or use minimal descriptions.
          Detailed prompts may alter your character&apos;s appearance.
        </p>
      </div>

      {/* Note about constraints */}
      <div className="text-[9px] font-mono text-text-muted/70 border-t border-border-subtle pt-3 space-y-1">
        <p>
          Generates a single-direction sprite strip — generate separately for each
          direction if you need a full 4-direction sheet.
        </p>
        <p>
          For best results, your character should be on a solid color background
          that contrasts with the character.
        </p>
      </div>

      {/* Error */}
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

      {/* Sticky-button bottom spacer — keeps the last form element clear of the fixed bar below */}
      <div className={STICKY_CTA_SPACER_CLASS_NAME} aria-hidden="true" />
    </div>

    {/* Sticky generate bar — viewport-fixed at bottom, sidebar-offset on desktop */}
    <div
      className={STICKY_CTA_BAR_CLASS_NAME}
      style={STICKY_CTA_BAR_STYLE}
    >
      <div className="max-w-5xl mx-auto">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-3">
          <p className="text-[10px] font-mono text-text-muted">
            {charWidth > 0
              ? `${selectedResolution}x${selectedResolution} · ${frameCount} frames`
              : `Upload a character to begin (${selectedResolution}x${selectedResolution})`}
          </p>
          <Button
            size="lg"
            onClick={handleGenerate}
            disabled={!canGenerate || isGenerating}
            className={`w-full sm:w-auto whitespace-nowrap ${!isGenerating && canGenerate ? 'animate-pulse' : ''}`}
          >
            {isGenerating ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Brewing...
              </>
            ) : (
              <>
                <Play size={16} />
                Generate Animation
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
    </>
  );
}
