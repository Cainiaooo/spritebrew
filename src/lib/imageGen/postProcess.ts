// Post-processing pipeline: AI-generated 1024px high-res image →
// clean target-size pixel sprite with transparent background.
//
// Mirrors pixabots/scripts/process_spritesheet.py but in TypeScript via sharp.
// Steps: decode → corner-sample bg removal → trim → center → nearest-neighbor
// downsample → optional palette quantization (image-q) → PNG.

import sharp from 'sharp';
import {
  applyPaletteSync,
  buildPaletteSync,
  utils,
} from 'image-q';

export interface PostProcessOptions {
  targetWidth: number;
  targetHeight: number;
  paletteColors?: number;
  removeBackground?: boolean;
  bgTolerance?: number;
}

export async function postProcessSprite(
  rawBase64: string,
  opts: PostProcessOptions,
): Promise<string> {
  const buf = Buffer.from(rawBase64, 'base64');
  const cleaned = opts.removeBackground === false
    ? await ensureRgba(buf)
    : await removeCornerBackground(buf, opts.bgTolerance ?? 30);

  const trimmed = await sharp(cleaned)
    .trim({ threshold: 1 })
    .toBuffer()
    .catch(() => cleaned);

  const meta = await sharp(trimmed).metadata();
  const { width: tw, height: th } = meta;
  if (!tw || !th) throw new Error('postProcess: trimmed image has no dimensions.');

  const fitSize = Math.max(tw, th);
  const padded = await sharp(trimmed)
    .extend({
      top: Math.floor((fitSize - th) / 2),
      bottom: Math.ceil((fitSize - th) / 2),
      left: Math.floor((fitSize - tw) / 2),
      right: Math.ceil((fitSize - tw) / 2),
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .toBuffer();

  const resized = await sharp(padded)
    .resize(opts.targetWidth, opts.targetHeight, {
      kernel: 'nearest',
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();

  const finalBuf = opts.paletteColors
    ? await quantizePalette(resized, opts.paletteColors)
    : resized;

  return finalBuf.toString('base64');
}

// Sample the four corners, average them, then make any pixel within
// bgTolerance RGB-distance fully transparent. Mirrors pixabots' corner method.
async function removeCornerBackground(
  input: Buffer,
  bgTolerance: number,
): Promise<Buffer> {
  const img = sharp(input).ensureAlpha();
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;

  const margin = Math.max(1, Math.floor(Math.min(width, height) * 0.02));
  const samples: Array<[number, number, number]> = [];
  const sampleAt = (x: number, y: number) => {
    const idx = (y * width + x) * channels;
    samples.push([data[idx], data[idx + 1], data[idx + 2]]);
  };
  for (let y = 0; y < margin; y++) {
    for (let x = 0; x < margin; x++) {
      sampleAt(x, y);
      sampleAt(width - 1 - x, y);
      sampleAt(x, height - 1 - y);
      sampleAt(width - 1 - x, height - 1 - y);
    }
  }
  const bg = samples.reduce(
    (acc, [r, g, b]) => [acc[0] + r, acc[1] + g, acc[2] + b],
    [0, 0, 0],
  ).map((v) => v / samples.length) as [number, number, number];

  const tolSq = bgTolerance * bgTolerance;
  const out = Buffer.from(data);
  for (let i = 0; i < out.length; i += channels) {
    const dr = out[i] - bg[0];
    const dg = out[i + 1] - bg[1];
    const db = out[i + 2] - bg[2];
    if (dr * dr + dg * dg + db * db <= tolSq) {
      out[i + 3] = 0;
    }
  }

  return sharp(out, { raw: { width, height, channels } }).png().toBuffer();
}

async function ensureRgba(input: Buffer): Promise<Buffer> {
  return sharp(input).ensureAlpha().png().toBuffer();
}

async function quantizePalette(input: Buffer, colors: number): Promise<Buffer> {
  const { data, info } = await sharp(input)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height } = info;

  const inPC = utils.PointContainer.fromUint8Array(
    new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
    width,
    height,
  );
  const palette = buildPaletteSync([inPC], { colors });
  const outPC = applyPaletteSync(inPC, palette);
  const outBytes = outPC.toUint8Array();

  return sharp(Buffer.from(outBytes), {
    raw: { width, height, channels: 4 },
  })
    .png()
    .toBuffer();
}
