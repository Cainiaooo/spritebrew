// Magenta chroma-key pipeline for transparent background generation.
// When quality=low or transparency is unreliable, we instruct the model to
// render on a solid #FF00FF background, then strip it here via color-distance
// flood-fill. Inspired by agent-sprite-forge's remove_bg_magenta approach.

import sharp from 'sharp';

const MAGENTA: [number, number, number] = [255, 0, 255];
const DEFAULT_TOLERANCE = 40;

/**
 * Remove magenta (#FF00FF) background from a raw base64 image.
 * Uses a border-seeded flood fill so only background-connected pixels
 * within `tolerance` Euclidean RGB distance of magenta become transparent.
 */
export async function removeMagentaBackground(
  rawBase64: string,
  tolerance = DEFAULT_TOLERANCE,
): Promise<string> {
  const buf = Buffer.from(rawBase64, 'base64');
  const { data, info } = await sharp(buf)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;

  const tolSq = tolerance * tolerance;
  const out = Buffer.from(data);
  const visited = new Uint8Array(width * height);
  const queue: number[] = [];
  let head = 0;

  const matchesMagenta = (pixelIndex: number): boolean => {
    const offset = pixelIndex * channels;
    const dr = out[offset] - MAGENTA[0];
    const dg = out[offset + 1] - MAGENTA[1];
    const db = out[offset + 2] - MAGENTA[2];
    return dr * dr + dg * dg + db * db <= tolSq;
  };

  const enqueue = (x: number, y: number) => {
    if (x < 0 || x >= width || y < 0 || y >= height) return;
    const pixelIndex = y * width + x;
    if (visited[pixelIndex]) return;
    if (!matchesMagenta(pixelIndex)) return;
    visited[pixelIndex] = 1;
    queue.push(pixelIndex);
  };

  for (let x = 0; x < width; x++) {
    enqueue(x, 0);
    enqueue(x, height - 1);
  }
  for (let y = 1; y < height - 1; y++) {
    enqueue(0, y);
    enqueue(width - 1, y);
  }

  while (head < queue.length) {
    const pixelIndex = queue[head++];
    const x = pixelIndex % width;
    const y = Math.floor(pixelIndex / width);
    out[pixelIndex * channels + 3] = 0;

    enqueue(x - 1, y);
    enqueue(x + 1, y);
    enqueue(x, y - 1);
    enqueue(x, y + 1);
  }

  const result = await sharp(out, { raw: { width, height, channels } })
    .png()
    .toBuffer();
  return result.toString('base64');
}

/** Returns true if the env quality is 'low' — signals magenta pipeline. */
export function shouldUseMagentaPipeline(): boolean {
  const q = process.env.OPENAI_IMAGE_QUALITY?.trim().toLowerCase();
  return q === 'low';
}

/** Append magenta-background instruction to a prompt string. */
export function injectMagentaPrompt(prompt: string): string {
  return `${prompt}, solid #FF00FF magenta background, no gradient, no environment`;
}
