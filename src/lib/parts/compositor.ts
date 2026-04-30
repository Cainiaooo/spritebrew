// Server-only compositor: overlay pixabots parts onto an AI-generated character.
//
// Adapted from pixabots/packages/extended/src/compositor.ts. Reads parts PNGs
// from public/parts/ via the filesystem (Next.js node runtime).

import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
import {
  LAYER_ORDER,
  PARTS,
  type Outfit,
  type PartCategory,
  type PartOption,
} from './catalog';

const PARTS_ROOT = path.join(process.cwd(), 'public', 'parts');

/** Resolve the on-disk path for a single frame of a part. */
function resolvePartFrame(category: PartCategory, partName: string, frameIndex: number): string | null {
  const flat = path.join(PARTS_ROOT, category, `${partName}.png`);
  if (fs.existsSync(flat)) return flat;

  const sub = path.join(PARTS_ROOT, category, partName);
  if (fs.existsSync(sub) && fs.statSync(sub).isDirectory()) {
    const files = fs.readdirSync(sub).filter((f) => f.endsWith('.png')).sort();
    if (files.length === 0) return null;
    const idx = Math.max(0, Math.min(frameIndex, files.length - 1));
    return path.join(sub, files[idx]);
  }
  return null;
}

/** Apply an outfit to a single base PNG buffer. */
export async function applyOutfitToFrame(
  baseBuffer: Buffer,
  outfit: Outfit,
  frameIndex = 0,
): Promise<Buffer> {
  const baseMeta = await sharp(baseBuffer).metadata();
  const targetSize = Math.max(baseMeta.width ?? 64, baseMeta.height ?? 64);

  const overlays: sharp.OverlayOptions[] = [];

  // Apply parts in canonical layer order so eyes always render on top.
  for (const cat of LAYER_ORDER) {
    const partName = outfit[cat];
    if (!partName) continue;

    const part = PARTS[cat].find((p) => p.name === partName);
    if (!part) continue;

    const partFrame = resolveFrameForPart(part, frameIndex);
    const partPath = resolvePartFrame(cat, part.name, partFrame);
    if (!partPath) continue;

    const partBuf = await sharp(partPath)
      .resize(targetSize, targetSize, { kernel: 'nearest', fit: 'contain' })
      .png()
      .toBuffer();

    overlays.push({ input: partBuf, left: 0, top: 0 });
  }

  if (overlays.length === 0) return baseBuffer;

  return sharp(baseBuffer)
    .ensureAlpha()
    .composite(overlays)
    .png()
    .toBuffer();
}

/** Pick a sub-frame inside the part's animation, given a global frame index. */
function resolveFrameForPart(part: PartOption, globalFrame: number): number {
  if (!part.frames || part.frames <= 1) return 0;
  if (part.kind === 'blink') {
    // Closed only on a small subset of frames (basic schedule, every 8th).
    return globalFrame > 0 && globalFrame % 8 === 0 ? 1 : 0;
  }
  return globalFrame % part.frames;
}

/**
 * Apply outfit to every frame of a horizontal sprite-sheet base64.
 * Used by Animate flow to keep parts attached across frames.
 */
export async function applyOutfitToSheet(
  sheetBase64: string,
  outfit: Outfit,
  frameCount: number,
  frameSize: number,
): Promise<string> {
  const sheetBuf = Buffer.from(sheetBase64, 'base64');
  const meta = await sharp(sheetBuf).metadata();
  const sheetW = meta.width ?? frameCount * frameSize;
  const sheetH = meta.height ?? frameSize;
  const stepX = Math.floor(sheetW / frameCount);

  const composedFrames: Buffer[] = [];
  for (let i = 0; i < frameCount; i++) {
    const left = i * stepX;
    const width = i === frameCount - 1 ? sheetW - left : stepX;
    const slice = await sharp(sheetBuf)
      .extract({ left, top: 0, width, height: sheetH })
      .resize(frameSize, frameSize, { kernel: 'nearest', fit: 'contain' })
      .png()
      .toBuffer();
    composedFrames.push(await applyOutfitToFrame(slice, outfit, i));
  }

  const composite: sharp.OverlayOptions[] = composedFrames.map((buf, i) => ({
    input: buf,
    left: i * frameSize,
    top: 0,
  }));

  const out = await sharp({
    create: {
      width: frameCount * frameSize,
      height: frameSize,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(composite)
    .png()
    .toBuffer();

  return out.toString('base64');
}

/** Convenience: same as applyOutfitToFrame but accepts/returns base64. */
export async function applyOutfitBase64(
  base64: string,
  outfit: Outfit,
): Promise<string> {
  const out = await applyOutfitToFrame(Buffer.from(base64, 'base64'), outfit, 0);
  return out.toString('base64');
}
