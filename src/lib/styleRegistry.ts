// Style registry — single source of truth for Create New tab styles.
//
// Phase 5 redesign: each entry now drives an LLM prompt prefix + a target
// palette size for postprocess quantization. The legacy `promptStyle`
// (Retro Diffusion key) is retained as an opaque id only — the new image
// adapter ignores it.

export type StyleCategory = 'characters' | 'items' | 'environments' | 'animations' | 'tiles' | 'ui';
export type StyleTier = 'fast' | 'plus' | 'pro' | 'animation';

export type ResolutionMode =
  | { kind: 'variable'; min: 32; max: 256; default: number }
  | { kind: 'variable_special'; min: number; max: number; default: number; presets: number[] }
  | { kind: 'locked'; size: number };

export interface GenerationStyle {
  id: string;
  label: string;
  description: string;
  /** Legacy id retained for routing; not sent to the new adapter. */
  promptStyle: string;
  /** Prepended to the user prompt when generating. */
  promptPrefix: string;
  tier: StyleTier;
  category: StyleCategory;
  defaultWidth: number;
  defaultHeight: number;
  minSize: number;
  maxSize: number;
  fixedSize: boolean;
  isAnimation: boolean;
  /** Optional palette-quantization target color count for postprocess. */
  paletteColors?: number;
  supportsRemoveBg: boolean;
  supportsReferenceImages?: boolean;
  resolutionMode?: ResolutionMode;
}

export const GENERATION_STYLES: GenerationStyle[] = [
  {
    id: 'character', label: 'Character', description: 'Game character sprite, side or three-quarter view',
    promptStyle: 'character', promptPrefix: 'pixel art game character, clean outlines, side view',
    tier: 'plus', category: 'characters',
    defaultWidth: 64, defaultHeight: 64, minSize: 16, maxSize: 256,
    fixedSize: false, isAnimation: false, paletteColors: 32,
    supportsRemoveBg: true, supportsReferenceImages: true,
  },
  {
    id: 'character-portrait', label: 'Character Portrait', description: 'Frontal portrait, dialog-style bust',
    promptStyle: 'character_portrait', promptPrefix: 'pixel art character portrait, frontal view, expressive face',
    tier: 'plus', category: 'characters',
    defaultWidth: 64, defaultHeight: 64, minSize: 32, maxSize: 256,
    fixedSize: false, isAnimation: false, paletteColors: 32,
    supportsRemoveBg: true, supportsReferenceImages: true,
  },
  {
    id: 'character-pro', label: 'Character (High Detail)', description: 'Larger sprite with more shading detail',
    promptStyle: 'character_pro', promptPrefix: 'detailed pixel art character, soft shading, modern style',
    tier: 'pro', category: 'characters',
    defaultWidth: 128, defaultHeight: 128, minSize: 64, maxSize: 256,
    fixedSize: false, isAnimation: false, paletteColors: 64,
    supportsRemoveBg: true, supportsReferenceImages: true,
  },
  {
    id: 'item', label: 'Item / Inventory', description: 'Single inventory item, transparent background',
    promptStyle: 'item', promptPrefix: 'pixel art inventory item, top-down view, clean silhouette',
    tier: 'plus', category: 'items',
    defaultWidth: 64, defaultHeight: 64, minSize: 16, maxSize: 128,
    fixedSize: false, isAnimation: false, paletteColors: 24,
    supportsRemoveBg: true, supportsReferenceImages: true,
  },
  {
    id: 'tile', label: 'Tile', description: 'Tileable terrain or environment tile',
    promptStyle: 'tile', promptPrefix: 'pixel art tileable texture tile, seamless edges',
    tier: 'plus', category: 'tiles',
    defaultWidth: 32, defaultHeight: 32, minSize: 16, maxSize: 128,
    fixedSize: false, isAnimation: false, paletteColors: 16,
    supportsRemoveBg: false, supportsReferenceImages: true,
  },
  {
    id: 'environment', label: 'Environment', description: 'Background scene or environment',
    promptStyle: 'environment', promptPrefix: 'pixel art environment, atmospheric background',
    tier: 'pro', category: 'environments',
    defaultWidth: 256, defaultHeight: 128, minSize: 96, maxSize: 256,
    fixedSize: false, isAnimation: false, paletteColors: 64,
    supportsRemoveBg: false, supportsReferenceImages: true,
  },
  {
    id: 'icon', label: 'Skill / UI Icon', description: 'Square ability or UI icon',
    promptStyle: 'icon', promptPrefix: 'pixel art skill icon, bold silhouette, centered',
    tier: 'fast', category: 'ui',
    defaultWidth: 64, defaultHeight: 64, minSize: 16, maxSize: 128,
    fixedSize: false, isAnimation: false, paletteColors: 16,
    supportsRemoveBg: true, supportsReferenceImages: true,
  },
  {
    id: 'animation-walk', label: 'Walk Cycle', description: 'Side-on walking animation, 6-frame sheet',
    promptStyle: 'animation__walk', promptPrefix: 'pixel art character walk cycle, side view, 6-frame sprite sheet, horizontal layout',
    tier: 'animation', category: 'animations',
    defaultWidth: 64, defaultHeight: 64, minSize: 32, maxSize: 96,
    fixedSize: true, isAnimation: true, paletteColors: 32,
    supportsRemoveBg: true, supportsReferenceImages: true,
    resolutionMode: { kind: 'locked', size: 64 },
  },
];

export function getStyleById(id: string): GenerationStyle | undefined {
  return GENERATION_STYLES.find((s) => s.id === id);
}

export function getStyleByPromptStyle(promptStyle: string): GenerationStyle | undefined {
  return GENERATION_STYLES.find((s) => s.promptStyle === promptStyle);
}

const TIER_LABELS: Record<StyleTier, string> = {
  pro: 'Pro',
  plus: 'Plus',
  fast: 'Fast',
  animation: 'Anim',
};

export function getTierLabel(tier: StyleTier): string {
  return TIER_LABELS[tier];
}

/** Animate-tab resolution presets (preserved for AnimateForm). */
export const ADVANCED_ANIM_RESOLUTION_PRESETS = [32, 64, 128, 256] as const;
export const ADVANCED_ANIM_DEFAULT_RESOLUTION = 64;
export const ADVANCED_ANIM_MIN_SIZE = 32;
export const ADVANCED_ANIM_MAX_SIZE = 256;

const ADVANCED_ANIM_VARIABLE_MODE: ResolutionMode = {
  kind: 'variable',
  min: 32,
  max: 256,
  default: ADVANCED_ANIM_DEFAULT_RESOLUTION,
};

export function getResolutionMode(promptStyle: string): ResolutionMode | null {
  if (promptStyle.startsWith('rd_advanced_animation__')) {
    return ADVANCED_ANIM_VARIABLE_MODE;
  }
  const style = GENERATION_STYLES.find((s) => s.promptStyle === promptStyle);
  return style?.resolutionMode ?? null;
}
