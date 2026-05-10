// Pure-function validators for create/animate input bodies.
// Lifted verbatim from src/app/api/generate/route.ts so they can be reused
// by both the Next.js route and the Ageniti CLI surface.

import { getResolutionMode } from '@/lib/styleRegistry';
import { PARTS, type Outfit, type PartCategory } from '@/lib/parts/catalog';
import type { CreateInput, AnimateInput } from './types';

export const VALID_ACTIONS = [
  'walking',
  'idle',
  'attack',
  'jump',
  'crouch',
  'destroy',
  'subtle_motion',
  'custom_action',
] as const;

export const VALID_FRAME_DURATIONS = [4, 6, 8] as const;

export const ACTION_PROMPT_PREFIX: Record<string, string> = {
  walking: 'walking animation, smooth steps',
  idle: 'idle breathing animation, subtle motion',
  attack: 'attack animation, melee swing',
  jump: 'jump animation, rising and falling',
  crouch: 'crouching animation, ducking down',
  destroy: 'death animation, falling and fading',
  subtle_motion: 'subtle ambient motion',
  custom_action: '',
};

export const MAX_REFERENCE_IMAGES = 4;
export const REF_TOTAL_BASE64_BUDGET = (12 * 1024 * 1024 * 4) / 3;

export function validateCreateBody(body: CreateInput): string | null {
  if (!body.prompt?.trim()) return 'Prompt is required.';
  const ps = body.promptStyle ?? body.style;
  if (!ps) return 'Style is required.';

  const mode = getResolutionMode(ps);
  if (mode && body.width !== undefined && body.height !== undefined) {
    if (mode.kind === 'locked') {
      if (body.width !== mode.size || body.height !== mode.size) {
        return `This style is locked at ${mode.size}x${mode.size}. Got ${body.width}x${body.height}.`;
      }
    } else {
      if (body.width < mode.min || body.width > mode.max) {
        return `Width must be between ${mode.min} and ${mode.max}. Got ${body.width}.`;
      }
      if (body.height < mode.min || body.height > mode.max) {
        return `Height must be between ${mode.min} and ${mode.max}. Got ${body.height}.`;
      }
    }
  }

  if (body.referenceImages?.length) {
    if (body.referenceImages.length > MAX_REFERENCE_IMAGES) {
      return `Maximum ${MAX_REFERENCE_IMAGES} reference images.`;
    }
    for (let i = 0; i < body.referenceImages.length; i++) {
      const img = body.referenceImages[i];
      if (typeof img !== 'string' || img.length === 0) {
        return `Reference image ${i + 1} is not a valid string.`;
      }
      if (img.startsWith('data:')) {
        return `Reference image ${i + 1} includes data: prefix. Strip it before sending.`;
      }
    }
    const total = body.referenceImages.reduce((s, img) => s + img.length, 0);
    if (total > REF_TOTAL_BASE64_BUDGET) {
      return 'Total reference image payload too large.';
    }
  }

  if (body.outfit) {
    const outfitErr = validateOutfit(body.outfit);
    if (outfitErr) return outfitErr;
  }

  return null;
}

export function validateAnimateBody(body: AnimateInput): string | null {
  if (!body.inputImage) return 'An input image is required for animation.';
  if (!body.action || !(VALID_ACTIONS as readonly string[]).includes(body.action)) {
    return `Invalid action. Must be one of: ${VALID_ACTIONS.join(', ')}`;
  }
  const w = body.width ?? 64;
  const h = body.height ?? 64;
  if (w !== h) return `Animation requires square dimensions. Got ${w}x${h}.`;
  if (
    body.framesDuration &&
    !(VALID_FRAME_DURATIONS as readonly number[]).includes(body.framesDuration)
  ) {
    return `Frame count must be one of: ${VALID_FRAME_DURATIONS.join(', ')}.`;
  }
  if (body.outfit) {
    const outfitErr = validateOutfit(body.outfit);
    if (outfitErr) return outfitErr;
  }
  return null;
}

export function validateOutfit(outfit: Outfit): string | null {
  for (const [cat, name] of Object.entries(outfit)) {
    if (!name) continue;
    const c = cat as PartCategory;
    if (!(c in PARTS)) return `Unknown outfit category: ${cat}`;
    if (!PARTS[c].some((p) => p.name === name)) {
      return `Unknown ${cat} part: ${name}`;
    }
  }
  return null;
}
