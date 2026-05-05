// Pre-export QA checks. Mirrors Codex Pet's validate_atlas.py +
// inspect_frames.py at MVP scope: catch obvious "the model returned
// garbage" failures (all-transparent frame, all-filled frame, background
// not removed, frames at wildly different sizes) and surface them as
// soft warnings on the result. v1 does not block — the user still gets
// the image and can decide. v2 may promote specific codes to hard errors.

import sharp from 'sharp';

export interface QaWarning {
  code: string;
  message: string;
}

const ALPHA_OPAQUE_THRESHOLD = 16;
const DENSITY_FLOOR = 0.05;
const DENSITY_CEIL = 0.95;
const BBOX_VARIATION_LIMIT = 0.30;
const CORNER_SIZE = 4;
const CORNER_OPAQUE_RATIO_LIMIT = 0.5;

/**
 * Run alpha-density + corner-transparency checks on one processed sprite.
 * Returns warnings; empty array means clean.
 */
export async function qaSingleSprite(b64: string, label = 'sprite'): Promise<QaWarning[]> {
  const buf = Buffer.from(b64, 'base64');
  return qaBuffer(buf, label);
}

async function qaBuffer(buf: Buffer, label: string): Promise<QaWarning[]> {
  const warnings: QaWarning[] = [];
  const { data, info } = await sharp(buf)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;

  let nonTransparent = 0;
  for (let i = 3; i < data.length; i += channels) {
    if (data[i] > ALPHA_OPAQUE_THRESHOLD) nonTransparent++;
  }
  const density = nonTransparent / (width * height);
  if (density < DENSITY_FLOOR) {
    warnings.push({
      code: 'qa.empty_frame',
      message: `${label} is nearly empty (${(density * 100).toFixed(1)}% non-transparent, floor ${(DENSITY_FLOOR * 100).toFixed(0)}%). The model may have returned a blank image.`,
    });
  } else if (density > DENSITY_CEIL) {
    warnings.push({
      code: 'qa.no_transparency',
      message: `${label} is fully filled (${(density * 100).toFixed(1)}% non-transparent, ceiling ${(DENSITY_CEIL * 100).toFixed(0)}%). Background removal likely failed.`,
    });
  }

  const cs = Math.min(CORNER_SIZE, width, height);
  if (cs >= 2) {
    const checkCorner = (x0: number, y0: number, name: string) => {
      let opaque = 0;
      for (let y = y0; y < y0 + cs; y++) {
        for (let x = x0; x < x0 + cs; x++) {
          const idx = (y * width + x) * channels + 3;
          if (data[idx] > ALPHA_OPAQUE_THRESHOLD * 2) opaque++;
        }
      }
      if (opaque > cs * cs * CORNER_OPAQUE_RATIO_LIMIT) {
        warnings.push({
          code: 'qa.corner_opaque',
          message: `${label} ${name} corner is mostly opaque — background not cleanly removed.`,
        });
      }
    };
    checkCorner(0, 0, 'top-left');
    checkCorner(width - cs, 0, 'top-right');
    checkCorner(0, height - cs, 'bottom-left');
    checkCorner(width - cs, height - cs, 'bottom-right');
  }

  return warnings;
}

/**
 * Run per-frame checks plus cross-frame bounding-box consistency. Catches the
 * case where the AI ignored "identical scale" and drew the character at
 * varying sizes across the sheet.
 */
export async function qaFrameSheet(frames: string[]): Promise<QaWarning[]> {
  if (frames.length === 0) return [];
  if (frames.length === 1) return qaSingleSprite(frames[0], 'frame 1');

  const warnings: QaWarning[] = [];
  for (let i = 0; i < frames.length; i++) {
    const fw = await qaSingleSprite(frames[i], `frame ${i + 1}`);
    warnings.push(...fw);
  }

  const bboxes = await Promise.all(frames.map(measureBbox));
  const widths = bboxes.map((b) => b.w).filter((w) => w > 0);
  const heights = bboxes.map((b) => b.h).filter((h) => h > 0);
  if (widths.length >= 2 && heights.length >= 2) {
    const meanW = widths.reduce((a, b) => a + b, 0) / widths.length;
    const meanH = heights.reduce((a, b) => a + b, 0) / heights.length;
    const stdW = Math.sqrt(
      widths.map((w) => (w - meanW) ** 2).reduce((a, b) => a + b, 0) / widths.length,
    );
    const stdH = Math.sqrt(
      heights.map((h) => (h - meanH) ** 2).reduce((a, b) => a + b, 0) / heights.length,
    );
    const wRatio = meanW > 0 ? stdW / meanW : 0;
    const hRatio = meanH > 0 ? stdH / meanH : 0;
    if (wRatio > BBOX_VARIATION_LIMIT || hRatio > BBOX_VARIATION_LIMIT) {
      warnings.push({
        code: 'qa.bbox_inconsistent',
        message: `Frame sizes vary across the sheet (width σ/μ ${(wRatio * 100).toFixed(0)}%, height σ/μ ${(hRatio * 100).toFixed(0)}%, limit ${(BBOX_VARIATION_LIMIT * 100).toFixed(0)}%). The character may not be drawn at identical scale per frame.`,
      });
    }
  }

  return warnings;
}

async function measureBbox(b64: string): Promise<{ w: number; h: number }> {
  const buf = Buffer.from(b64, 'base64');
  const { data, info } = await sharp(buf)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;

  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * channels + 3;
      if (data[idx] > ALPHA_OPAQUE_THRESHOLD) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return { w: 0, h: 0 };
  return { w: maxX - minX + 1, h: maxY - minY + 1 };
}
