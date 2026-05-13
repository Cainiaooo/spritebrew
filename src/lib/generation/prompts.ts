// Prompt-building helpers and animation grid layout selection.
// Lifted verbatim from src/app/api/generate/route.ts.

import type { StylePromptHints } from '@/lib/styleRegistry';

export interface AnimationLayout {
  cols: number;
  rows: number;
  canvasW: number;
  canvasH: number;
}

// Pack frames into a 2D grid that fills one of gpt-image-1's three supported
// canvas sizes. This gives ~512px per cell vs ~170px in a single-row 1024px
// strip — same API cost, ~9× more source pixels per frame.
export function pickAnimationLayout(frameCount: number): AnimationLayout {
  switch (frameCount) {
    case 4:
      return { cols: 2, rows: 2, canvasW: 1024, canvasH: 1024 };
    case 6:
      return { cols: 3, rows: 2, canvasW: 1536, canvasH: 1024 };
    case 8:
      return { cols: 4, rows: 2, canvasW: 1536, canvasH: 1024 };
    default:
      return { cols: frameCount, rows: 1, canvasW: 1536, canvasH: 1024 };
  }
}

export function buildAnimatePrompt(args: {
  frameCount: number;
  layout: AnimationLayout;
  actionPrefix: string;
  extraMotion: string;
}): string {
  const { frameCount, layout, actionPrefix, extraMotion } = args;
  const cellW = Math.floor(layout.canvasW / layout.cols);
  const cellH = Math.floor(layout.canvasH / layout.rows);
  const parts = [
    `Generate a ${frameCount}-frame ${actionPrefix} animation of this character.`,
    'Identity lock: do not redesign the character. Preserve the exact head shape, face, markings, color palette, outline weight, body proportions, outfit, and silhouette of the reference image. Only the pose changes from frame to frame.',
    `Output a single image arranged in a ${layout.cols}-column by ${layout.rows}-row grid of equally-sized cells (each cell ${cellW}×${cellH}px).`,
    'Frame order is reading order: left-to-right within each row, then top-to-bottom across rows.',
    // Layout guide constraints
    `Layout constraints: each cell is exactly ${cellW}×${cellH}px. The character must stay within the inner 80% safe zone of each cell (${Math.floor(cellW * 0.1)}px margin on each side). Center the character horizontally and align feet to a consistent baseline across all frames.`,
    'Scale lock: the character must occupy the same proportional area in every frame. Do not shrink or enlarge the character between frames — only the pose changes.',
    'Every cell has identical size; the character is centered in each cell at the same scale.',
    'Pixel art style. Use a fully transparent background (alpha 0) — no checker pattern, no white fill, no visible gridlines between cells.',
    'Do not draw speed lines, motion arcs, afterimages, smears, dust clouds, cast shadows, drop shadows, glow, halo, aura, text, labels, frame numbers, or floating symbols.',
    extraMotion,
  ];
  return parts.filter(Boolean).join(' ');
}

// Create New: we generate at the API canvas size (1024² / 1536×1024 / 1024×1536)
// and downsample to the user's target. The prompt mentions the target density
// so the model designs the silhouette to read clearly when downsampled, but
// avoids stating the literal output pixel count which the model treats as a
// raw size constraint.
//
// `DEFAULT_PIXEL_SPRITE_HINTS` provides the shared scaffolding (lighting /
// composition / negatives / extras). Each `GenerationStyle.promptHints`
// layers on top and wins on collision — a character entry can replace
// `composition` with "side view, full body visible" while still picking up
// the default lighting and extras.
export const DEFAULT_PIXEL_SPRITE_HINTS: Required<StylePromptHints> = {
  lighting: 'flat even lighting with no strong shadows',
  composition: 'subject centered, full body visible with small margin',
  avoid: 'text, labels, speed lines, borders, gradient background',
  extra: ['readable silhouette', 'high contrast edges'],
};

export function buildCreatePrompt(
  userPrompt: string,
  prefix: string,
  w: number,
  h: number,
  transparent: boolean,
  hints?: StylePromptHints,
): string {
  const merged: Required<StylePromptHints> = {
    lighting: hints?.lighting ?? DEFAULT_PIXEL_SPRITE_HINTS.lighting,
    composition: hints?.composition ?? DEFAULT_PIXEL_SPRITE_HINTS.composition,
    avoid: hints?.avoid ?? DEFAULT_PIXEL_SPRITE_HINTS.avoid,
    extra: hints?.extra ?? DEFAULT_PIXEL_SPRITE_HINTS.extra,
  };

  const parts: string[] = [
    prefix,
    userPrompt,
    `pixel art style, designed to read clearly when downsampled to a ${w}x${h} sprite`,
    merged.composition,
    `keep the subject within the inner 80% safe zone (leave ${Math.max(1, Math.round(w * 0.1))}px margin), do not let limbs or weapons touch the image edge`,
    merged.lighting,
  ];
  if (transparent) {
    parts.push('fully transparent background, no background color, no environment');
  }
  parts.push(`avoid: ${merged.avoid}`);
  if (merged.extra.length) {
    parts.push(...merged.extra);
  }
  return parts.filter(Boolean).join(', ');
}
