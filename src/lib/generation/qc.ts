// Frame-level QC for animation strips.
// Detects edge-touching content and inter-frame area inconsistency.
// Returns qaWarnings that supplement the existing qa.ts checks.

import sharp from 'sharp';
import type { QaWarning } from '@/lib/imageGen/qa';

const ALPHA_THRESHOLD = 16;
const AREA_VARIATION_LIMIT = 0.15; // ±15%

/**
 * Check if non-transparent pixels touch the 1px border of a frame.
 * Returns a warning if content bleeds to the edge (likely clipped).
 */
async function checkEdgeTouch(b64: string, frameIndex: number): Promise<QaWarning | null> {
  const buf = Buffer.from(b64, 'base64');
  const { data, info } = await sharp(buf)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;

  let edgeOpaque = 0;
  const edgeTotal = 2 * (width + height) - 4;

  for (let x = 0; x < width; x++) {
    if (data[(x) * channels + 3] > ALPHA_THRESHOLD) edgeOpaque++;
    if (data[((height - 1) * width + x) * channels + 3] > ALPHA_THRESHOLD) edgeOpaque++;
  }
  for (let y = 1; y < height - 1; y++) {
    if (data[(y * width) * channels + 3] > ALPHA_THRESHOLD) edgeOpaque++;
    if (data[(y * width + width - 1) * channels + 3] > ALPHA_THRESHOLD) edgeOpaque++;
  }

  const ratio = edgeOpaque / edgeTotal;
  if (ratio > 0.1) {
    return {
      code: 'qc.edge_touch',
      message: `Frame ${frameIndex + 1}: ${(ratio * 100).toFixed(0)}% of edge pixels are opaque — content may be clipped.`,
    };
  }
  return null;
}

/** Count non-transparent pixels in a frame. */
async function measureArea(b64: string): Promise<number> {
  const buf = Buffer.from(b64, 'base64');
  const { data, info } = await sharp(buf)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { channels } = info;
  let count = 0;
  for (let i = 3; i < data.length; i += channels) {
    if (data[i] > ALPHA_THRESHOLD) count++;
  }
  return count;
}

/**
 * Run edge-touch and area-consistency QC on an array of frame base64 strings.
 */
export async function qcFrames(
  frames: string[],
  opts?: {
    edgeCheckFrames?: string[];
    areaCheckFrames?: string[];
  },
): Promise<QaWarning[]> {
  if (frames.length < 2) return [];

  const edgeCheckFrames = opts?.edgeCheckFrames ?? frames;
  const areaCheckFrames = opts?.areaCheckFrames ?? frames;
  if (edgeCheckFrames.length !== frames.length || areaCheckFrames.length !== frames.length) {
    throw new Error('qcFrames: frame arrays must have matching lengths.');
  }

  const warnings: QaWarning[] = [];

  // Edge-touch uses raw frame cells; trim/recenter/resize makes normal
  // non-square sprites touch the output square edges and causes false positives.
  const edgeResults = await Promise.all(
    edgeCheckFrames.map((f, i) => checkEdgeTouch(f, i)),
  );
  for (const w of edgeResults) {
    if (w) warnings.push(w);
  }

  // Area consistency
  const areas = await Promise.all(areaCheckFrames.map(measureArea));
  const nonZero = areas.filter((a) => a > 0);
  if (nonZero.length >= 2) {
    const mean = nonZero.reduce((a, b) => a + b, 0) / nonZero.length;
    for (let i = 0; i < areas.length; i++) {
      if (areas[i] === 0) continue;
      const deviation = Math.abs(areas[i] - mean) / mean;
      if (deviation > AREA_VARIATION_LIMIT) {
        warnings.push({
          code: 'qc.area_inconsistent',
          message: `Frame ${i + 1}: area deviates ${(deviation * 100).toFixed(0)}% from mean (limit ±${(AREA_VARIATION_LIMIT * 100).toFixed(0)}%).`,
        });
      }
    }
  }

  return warnings;
}
