// Runtime validators for gpt-image-2 parameters.
//
// These mirror the constraints OpenAI's image endpoints enforce so callers
// see a clear client-side error *before* the network round-trip. Anything
// here that passes should succeed on the server's own validation layer.
//
// Validators throw `ImageGenValidationError`; the adapter layer catches that
// type and surfaces it to the user with no retry.

import sharp from 'sharp';

import {
  MAX_REFERENCE_IMAGES,
  REF_TOTAL_BASE64_BUDGET,
} from './referenceLimits';

export class ImageGenValidationError extends Error {
  constructor(message: string, readonly field?: string) {
    super(message);
    this.name = 'ImageGenValidationError';
  }
}

// ─── gpt-image-2 size constraints ──

const SIZE_MULTIPLE_OF = 16;
const SIZE_MAX_EDGE = 3840;
const SIZE_MAX_ASPECT_RATIO = 3;
const SIZE_MIN_TOTAL_PIXELS = 655_360;
const SIZE_MAX_TOTAL_PIXELS = 8_294_400;

/** Validate a WxH pair against the current gpt-image-2 resolution rules. */
export function validateSize(width: number, height: number): void {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new ImageGenValidationError(
      `size: width and height must be positive integers, got ${width}x${height}.`,
      'size',
    );
  }
  if (width % SIZE_MULTIPLE_OF !== 0 || height % SIZE_MULTIPLE_OF !== 0) {
    throw new ImageGenValidationError(
      `size: both edges must be multiples of ${SIZE_MULTIPLE_OF}; got ${width}x${height}.`,
      'size',
    );
  }
  const longEdge = Math.max(width, height);
  const shortEdge = Math.min(width, height);
  if (longEdge > SIZE_MAX_EDGE) {
    throw new ImageGenValidationError(
      `size: longest edge must be ≤ ${SIZE_MAX_EDGE}px; got ${longEdge}.`,
      'size',
    );
  }
  if (shortEdge === 0 || longEdge / shortEdge > SIZE_MAX_ASPECT_RATIO) {
    throw new ImageGenValidationError(
      `size: aspect ratio must not exceed ${SIZE_MAX_ASPECT_RATIO}:1; got ${width}x${height} (${(longEdge / shortEdge).toFixed(2)}:1).`,
      'size',
    );
  }
  const pixels = width * height;
  if (pixels < SIZE_MIN_TOTAL_PIXELS || pixels > SIZE_MAX_TOTAL_PIXELS) {
    throw new ImageGenValidationError(
      `size: total pixels must be between ${SIZE_MIN_TOTAL_PIXELS} and ${SIZE_MAX_TOTAL_PIXELS}; got ${pixels} (${width}x${height}).`,
      'size',
    );
  }
}

// ─── quality ──

export type QualityLevel = 'low' | 'medium' | 'high' | 'auto';
export const SUPPORTED_QUALITY: readonly QualityLevel[] = ['low', 'medium', 'high', 'auto'];

export function validateQuality(quality: string): QualityLevel {
  const q = quality.trim().toLowerCase();
  if ((SUPPORTED_QUALITY as readonly string[]).includes(q)) return q as QualityLevel;
  throw new ImageGenValidationError(
    `quality: expected one of ${SUPPORTED_QUALITY.join(' | ')}; got '${quality}'.`,
    'quality',
  );
}

/**
 * Default image quality for all adapters when neither the caller nor the
 * environment overrides it.
 *
 * Why `'high'`: SpriteBrew produces pixel-art sprites whose silhouette /
 * edge clarity matters at the final downscale step; `high` gives the
 * cleanest input for the post-process pipeline. Downstream users can
 * override via `OPENAI_IMAGE_QUALITY` without touching code.
 */
export const DEFAULT_IMAGE_QUALITY: QualityLevel = 'high';

/** Name of the env var adapters read. Centralized for doc & test reuse. */
export const OPENAI_IMAGE_QUALITY_ENV_VAR = 'OPENAI_IMAGE_QUALITY';

/**
 * Resolve the effective quality level for an adapter call. Precedence:
 *   1. explicit override (adapter constructor option or per-request arg)
 *   2. env `OPENAI_IMAGE_QUALITY`
 *   3. `DEFAULT_IMAGE_QUALITY`
 *
 * Unknown env values are treated as "no override" rather than throwing —
 * we never want a typo in `.env.local` to hard-fail generation when a
 * safe default exists. Callers that want to fail loudly should call
 * `validateQuality()` on the return value.
 */
export function resolveImageQuality(override?: string | null): QualityLevel {
  const candidate = override ?? process.env[OPENAI_IMAGE_QUALITY_ENV_VAR];
  if (!candidate) return DEFAULT_IMAGE_QUALITY;
  const normalized = candidate.trim().toLowerCase();
  if ((SUPPORTED_QUALITY as readonly string[]).includes(normalized)) {
    return normalized as QualityLevel;
  }
  return DEFAULT_IMAGE_QUALITY;
}

// ─── gpt-image-2 model-level constraints ──

const GPT_IMAGE_2 = 'gpt-image-2';

export interface GptImage2Inputs {
  background?: string;
  inputFidelity?: string;
}

/**
 * gpt-image-2 disallows `background: 'transparent'` and any `input_fidelity`
 * value (the model always processes inputs at high fidelity).
 */
export function validateGptImage2Constraints(model: string, inputs: GptImage2Inputs): void {
  if (model.trim().toLowerCase() !== GPT_IMAGE_2) return;
  if (inputs.background && inputs.background.trim().toLowerCase() === 'transparent') {
    throw new ImageGenValidationError(
      `background: '${GPT_IMAGE_2}' does not support transparent backgrounds. Use 'auto' or 'opaque', or switch to a model that supports transparency (e.g. gpt-image-1).`,
      'background',
    );
  }
  if (inputs.inputFidelity && inputs.inputFidelity.trim() !== '') {
    throw new ImageGenValidationError(
      `input_fidelity: '${GPT_IMAGE_2}' always processes inputs at high fidelity; do not send this parameter.`,
      'input_fidelity',
    );
  }
}

// ─── reference images ──

export function validateReferenceImages(refs: string[] | undefined): void {
  if (!refs || refs.length === 0) return;
  if (refs.length > MAX_REFERENCE_IMAGES) {
    throw new ImageGenValidationError(
      `referenceImages: at most ${MAX_REFERENCE_IMAGES} images, got ${refs.length}.`,
      'referenceImages',
    );
  }
  let total = 0;
  for (let i = 0; i < refs.length; i++) {
    const img = refs[i];
    if (typeof img !== 'string' || img.length === 0) {
      throw new ImageGenValidationError(
        `referenceImages[${i}]: not a non-empty string.`,
        'referenceImages',
      );
    }
    if (img.startsWith('data:')) {
      throw new ImageGenValidationError(
        `referenceImages[${i}]: includes data: prefix. Strip it before sending.`,
        'referenceImages',
      );
    }
    total += img.length;
  }
  if (total > REF_TOTAL_BASE64_BUDGET) {
    throw new ImageGenValidationError(
      `referenceImages: total payload ${total} bytes exceeds budget ${REF_TOTAL_BASE64_BUDGET}.`,
      'referenceImages',
    );
  }
}

// ─── mask compatibility ──

/**
 * Validate that a mask image matches the edit target: same format, same
 * dimensions, and has an alpha channel. Uses `sharp` to read metadata.
 *
 * Callers pass Buffers; the function is pure so adapters can run it before
 * committing to a fetch.
 */
export async function validateMask(
  sourceImage: Buffer,
  maskImage: Buffer,
): Promise<void> {
  const [src, mask] = await Promise.all([
    sharp(sourceImage).metadata(),
    sharp(maskImage).metadata(),
  ]);

  if (!src.format || !mask.format) {
    throw new ImageGenValidationError(
      'mask: failed to determine image format; mask or source may not be a valid image.',
      'mask',
    );
  }
  if (normalizeFormat(src.format) !== normalizeFormat(mask.format)) {
    throw new ImageGenValidationError(
      `mask: format mismatch — source is ${src.format}, mask is ${mask.format}. Use the same format for both.`,
      'mask',
    );
  }
  if (!src.width || !src.height || !mask.width || !mask.height) {
    throw new ImageGenValidationError(
      'mask: missing width/height in image metadata.',
      'mask',
    );
  }
  if (src.width !== mask.width || src.height !== mask.height) {
    throw new ImageGenValidationError(
      `mask: dimensions must match source (${src.width}x${src.height}); got ${mask.width}x${mask.height}.`,
      'mask',
    );
  }
  if (!mask.hasAlpha) {
    throw new ImageGenValidationError(
      'mask: must include an alpha channel. Save your mask as PNG with transparency.',
      'mask',
    );
  }
}

function normalizeFormat(fmt: string): string {
  const f = fmt.toLowerCase();
  return f === 'jpg' || f === 'jpe' ? 'jpeg' : f;
}
