// Prompt-building helpers and animation grid layout selection.
// Lifted verbatim from src/app/api/generate/route.ts.

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
  const parts = [
    `Generate a ${frameCount}-frame ${actionPrefix} animation of this character.`,
    'Identity lock: do not redesign the character. Preserve the exact head shape, face, markings, color palette, outline weight, body proportions, outfit, and silhouette of the reference image. Only the pose changes from frame to frame.',
    `Output a single image arranged in a ${layout.cols}-column by ${layout.rows}-row grid of equally-sized cells.`,
    'Frame order is reading order: left-to-right within each row, then top-to-bottom across rows.',
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
export function buildCreatePrompt(
  userPrompt: string,
  prefix: string,
  w: number,
  h: number,
  transparent: boolean,
): string {
  const parts = [
    prefix,
    userPrompt,
    `pixel art style, designed to read clearly when downsampled to a ${w}x${h} sprite`,
    'subject centered with empty margin around it',
  ];
  if (transparent) {
    parts.push('fully transparent background, no background color, no environment');
  }
  return parts.join(', ');
}
