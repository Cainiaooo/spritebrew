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

/**
 * Per-style overrides for the shared pixel-sprite prompt scaffolding.
 *
 * `buildCreatePrompt` merges these on top of `DEFAULT_PIXEL_SPRITE_HINTS`
 * (defined in `src/lib/generation/prompts.ts`) so individual styles can
 * tighten composition / lighting / negative constraints without rewriting
 * the whole prompt template.
 */
export interface StylePromptHints {
  /** Overrides the default lighting clause. */
  lighting?: string;
  /** Overrides the default composition clause. */
  composition?: string;
  /** Overrides the default "avoid:" clause (category-specific negatives). */
  avoid?: string;
  /** Extra free-form bullets appended at the end of the prompt. */
  extra?: string[];
}

export interface GenerationStyle {
  id: string;
  label: string;
  description: string;
  /**
   * Public paths to static example images for this style. Index 0 is the hero
   * thumbnail shown in the style card; full array is shown in the lightbox.
   * Undefined for styles without curated examples.
   */
  examplePaths?: string[];
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
  /** Optional per-style overrides for `buildCreatePrompt` scaffolding. */
  promptHints?: StylePromptHints;
}

// Shared "is NOT what" baseline. Models reach for painterly / 3D / glossy
// renderings whenever the user description sounds elaborate; suppressing
// those up front keeps the output legible as pixel art at the target size.
// Per-style negatives layer on top of this with category-specific bans.
const PIXEL_BASELINE_NEGATIVE =
  'NOT painterly rendering, NOT 3D rendering, NOT anime key art, NOT glossy app-icon treatment, NOT realistic textures, NOT soft gradients, NOT high-detail antialiasing';

const PIXEL_BASELINE_POSITIVE =
  'pixel art, visible stepped pixel edges, limited palette, flat cel shading';

const STYLE_EXAMPLE_PATHS: Record<string, string[]> = {
  character: ['/style-examples/character-adventurer.svg'],
  'character-portrait': ['/style-examples/character-portrait-commander.svg'],
  'character-pro': ['/style-examples/character-pro-knight.svg'],
  item: ['/style-examples/item-relic.svg'],
  tile: ['/style-examples/tile-grassland.svg'],
  environment: ['/style-examples/environment-sunset-ruins.svg'],
  icon: ['/style-examples/icon-emberburst.svg'],
  'animation-walk': ['/style-examples/animation-walk-cycle.svg'],
};

export const GENERATION_STYLES: GenerationStyle[] = [
  {
    id: 'character', label: 'Character', description: 'Game character sprite, side or three-quarter view',
    examplePaths: STYLE_EXAMPLE_PATHS.character,
    promptStyle: 'character',
    promptPrefix: [
      'pixel art game character, clean readable silhouette, side or three-quarter view',
      'thick dark 1-2px outline, compact proportions',
      PIXEL_BASELINE_POSITIVE,
      PIXEL_BASELINE_NEGATIVE,
      'no portrait crop or close-up, no environment scenery',
      'no text labels, UI panels, speech bubbles, glow, halo, or floating symbols',
    ].join(', '),
    tier: 'plus', category: 'characters',
    defaultWidth: 64, defaultHeight: 64, minSize: 16, maxSize: 256,
    fixedSize: false, isAnimation: false, paletteColors: 32,
    supportsRemoveBg: true, supportsReferenceImages: true,
    promptHints: {
      composition: 'side or three-quarter view, full body visible with margin',
      avoid:
        'portrait crop, close-up, environment scenery, text labels, UI panels, speech bubbles, glow, halo, floating symbols',
    },
  },
  {
    id: 'character-portrait', label: 'Character Portrait', description: 'Frontal portrait, dialog-style bust',
    examplePaths: STYLE_EXAMPLE_PATHS['character-portrait'],
    promptStyle: 'character_portrait',
    promptPrefix: [
      'pixel art character portrait, frontal head-and-shoulders bust, expressive face',
      'thick dark outline, simple readable features',
      PIXEL_BASELINE_POSITIVE,
      PIXEL_BASELINE_NEGATIVE,
      'no full body, no legs, no environment or background scenery',
      'no speech bubbles, no thought bubbles, no text labels, no UI frame',
    ].join(', '),
    tier: 'plus', category: 'characters',
    defaultWidth: 64, defaultHeight: 64, minSize: 32, maxSize: 256,
    fixedSize: false, isAnimation: false, paletteColors: 32,
    supportsRemoveBg: true, supportsReferenceImages: true,
  },
  {
    id: 'character-pro', label: 'Character (High Detail)', description: 'Larger sprite with more shading detail',
    examplePaths: STYLE_EXAMPLE_PATHS['character-pro'],
    promptStyle: 'character_pro',
    promptPrefix: [
      'detailed pixel art character with multi-step cel shading',
      'still pixel art — visible stepped edges, limited palette, hand-placed pixels',
      'two to three shadow steps allowed, single highlight step allowed',
      PIXEL_BASELINE_NEGATIVE,
      'no environment scenery, no UI overlays, no text or labels',
      'no glow, halo, aura, motion lines, or floating effects',
    ].join(', '),
    tier: 'pro', category: 'characters',
    defaultWidth: 128, defaultHeight: 128, minSize: 64, maxSize: 256,
    fixedSize: false, isAnimation: false, paletteColors: 64,
    supportsRemoveBg: true, supportsReferenceImages: true,
  },
  {
    id: 'item', label: 'Item / Inventory', description: 'Single inventory item, transparent background',
    examplePaths: STYLE_EXAMPLE_PATHS.item,
    promptStyle: 'item',
    promptPrefix: [
      'pixel art inventory item, single object, three-quarter or top-down view',
      'clean silhouette, thick dark outline, centered',
      PIXEL_BASELINE_POSITIVE,
      PIXEL_BASELINE_NEGATIVE,
      'no character holding the item, no hands, no environment',
      'no shadow ground patch, no glow, no sparkles, no rarity beams, no text labels',
    ].join(', '),
    tier: 'plus', category: 'items',
    defaultWidth: 64, defaultHeight: 64, minSize: 16, maxSize: 128,
    fixedSize: false, isAnimation: false, paletteColors: 24,
    supportsRemoveBg: true, supportsReferenceImages: true,
    promptHints: {
      composition: 'single object centered, three-quarter or top-down view',
      lighting: 'flat even lighting, single soft shadow step',
      avoid:
        'character holding item, hands, environment, shadow ground patch, glow, sparkles, rarity beams, text labels',
    },
  },
  {
    id: 'tile', label: 'Tile', description: 'Tileable terrain or environment tile',
    examplePaths: STYLE_EXAMPLE_PATHS.tile,
    promptStyle: 'tile',
    promptPrefix: [
      'pixel art tileable texture tile, seamless edges that match the opposite edge',
      'fills the entire canvas edge-to-edge with no margin',
      'uniform texture density across the tile, no focal subject',
      PIXEL_BASELINE_POSITIVE,
      PIXEL_BASELINE_NEGATIVE,
      'no characters, no creatures, no inventory items, no UI overlays',
      'no visible tile borders, no grid lines, no edge frames, no text',
    ].join(', '),
    tier: 'plus', category: 'tiles',
    defaultWidth: 32, defaultHeight: 32, minSize: 16, maxSize: 128,
    fixedSize: false, isAnimation: false, paletteColors: 16,
    supportsRemoveBg: false, supportsReferenceImages: true,
  },
  {
    id: 'environment', label: 'Environment', description: 'Background scene or environment',
    examplePaths: STYLE_EXAMPLE_PATHS.environment,
    promptStyle: 'environment',
    promptPrefix: [
      'pixel art environment background, atmospheric scene, multiple depth layers',
      'clear horizon, readable foreground / midground / background separation',
      PIXEL_BASELINE_POSITIVE,
      PIXEL_BASELINE_NEGATIVE,
      'no character or creature subject, no inventory items',
      'no UI overlays, no minimap, no text labels, no isometric grid lines',
    ].join(', '),
    tier: 'pro', category: 'environments',
    defaultWidth: 256, defaultHeight: 128, minSize: 96, maxSize: 256,
    fixedSize: false, isAnimation: false, paletteColors: 64,
    supportsRemoveBg: false, supportsReferenceImages: true,
  },
  {
    id: 'icon', label: 'Skill / UI Icon', description: 'Square ability or UI icon',
    examplePaths: STYLE_EXAMPLE_PATHS.icon,
    promptStyle: 'icon',
    promptPrefix: [
      'pixel art skill icon, bold centered silhouette, readable at small sizes',
      'high-contrast color blocking, single focal subject',
      'thick dark 1-2px outline framing the subject',
      PIXEL_BASELINE_POSITIVE,
      PIXEL_BASELINE_NEGATIVE,
      'no full character body, no environment, no scenery',
      'no text, no numbers, no decorative borders or frame',
    ].join(', '),
    tier: 'fast', category: 'ui',
    defaultWidth: 64, defaultHeight: 64, minSize: 16, maxSize: 128,
    fixedSize: false, isAnimation: false, paletteColors: 16,
    supportsRemoveBg: true, supportsReferenceImages: true,
  },
  {
    id: 'animation-walk', label: 'Walk Cycle', description: 'Side-on walking animation, 6-frame sheet',
    examplePaths: STYLE_EXAMPLE_PATHS['animation-walk'],
    promptStyle: 'animation__walk',
    promptPrefix: [
      'pixel art character walk cycle, side view, 6-frame sprite sheet, horizontal layout',
      'every cell identical size, character centered in each cell at the same scale',
      'frame order is reading order left-to-right, smooth gait progression',
      PIXEL_BASELINE_POSITIVE,
      PIXEL_BASELINE_NEGATIVE,
      'no speed lines, motion arcs, dust clouds, afterimages, or smears',
      'no cast shadows, drop shadows, oval floor shadows, glow, or halo',
      'no visible cell borders, no gridlines between frames, no frame numbers or labels',
    ].join(', '),
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
