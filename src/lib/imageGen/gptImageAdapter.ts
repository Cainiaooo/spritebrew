// OpenAI gpt-image-2 adapter (also compatible with gpt-image-1).
//
// generate() → POST {base}/v1/images/generations (text-only, falls back to
// edits when reference images are supplied)
// editWithReference() → POST {base}/v1/images/edits (multipart with reference)
//
// Configurable via env:
//   OPENAI_BASE_URL    e.g. https://api.openai.com (default)
//                      or a relay like https://your-relay.com
//   OPENAI_API_KEY
//   OPENAI_IMAGE_MODEL e.g. gpt-image-2 (default), gpt-image-1, gpt-image-1.5
//
// Note: gpt-image-2 does NOT support `background: 'transparent'`; the param
// is omitted and our postProcess pipeline handles background removal.

import type {
  EditRequest,
  GenResult,
  GenerateRequest,
  ImageGenAdapter,
} from './types';
import { fetchWithRetry } from './retry';
import {
  extractImageBase64,
  extractImageUrl,
  parseMaybeJson,
  summarizeResponseShape,
} from './responseImage';

const DEFAULT_BASE_URL = 'https://api.openai.com';
const DEFAULT_MODEL = 'gpt-image-2';

export interface GptImageAdapterOptions {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  quality?: 'low' | 'medium' | 'high' | 'auto';
}

export class GptImageAdapter implements ImageGenAdapter {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly quality: 'low' | 'medium' | 'high' | 'auto';

  constructor(opts: GptImageAdapterOptions = {}) {
    const key = opts.apiKey ?? process.env.OPENAI_API_KEY;
    if (!key) throw new Error('OPENAI_API_KEY is not set.');
    this.apiKey = key;
    this.baseUrl = trimSlash(opts.baseUrl ?? process.env.OPENAI_BASE_URL ?? DEFAULT_BASE_URL);
    this.model = opts.model ?? process.env.OPENAI_IMAGE_MODEL ?? DEFAULT_MODEL;
    this.quality = opts.quality ?? 'medium';
  }

  private get generationsUrl(): string {
    return `${this.baseUrl}/v1/images/generations`;
  }

  private get editsUrl(): string {
    return `${this.baseUrl}/v1/images/edits`;
  }

  /** gpt-image-2 dropped `background: 'transparent'`. Older models still support it. */
  private supportsTransparentBackground(): boolean {
    return this.model.startsWith('gpt-image-1');
  }

  async generate(req: GenerateRequest): Promise<GenResult> {
    if (req.referenceImages && req.referenceImages.length > 0) {
      return this.editWithReference({
        referenceImage: req.referenceImages[0],
        prompt: req.prompt,
        canvasSize: { w: req.width, h: req.height },
      });
    }

    const sizeStr = pickSize(req.width, req.height);
    const body: Record<string, unknown> = {
      model: this.model,
      prompt: req.prompt,
      size: sizeStr,
      quality: this.quality,
      output_format: 'png',
      n: 1,
    };
    if (this.supportsTransparentBackground()) {
      body.background = 'transparent';
    }

    const res = await fetchWithRetry(this.generationsUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`OpenAI images.generate ${res.status}: ${text.slice(0, 300)}`);
    }

    const payload = await readResponsePayload(res);
    const b64 = await resolveImageBase64(payload, this.apiKey);
    if (!b64) {
      throw new Error(
        `OpenAI returned no image data. Response shape: ${summarizeResponseShape(payload)}.`,
      );
    }

    const [w, h] = sizeStr.split('x').map(Number);
    return { rawBase64Image: b64, rawWidth: w, rawHeight: h };
  }

  async editWithReference(req: EditRequest): Promise<GenResult> {
    const canvas = req.canvasSize ?? { w: 1024, h: 1024 };
    const sizeStr = pickSize(canvas.w, canvas.h);

    const form = new FormData();
    form.append('model', this.model);
    form.append('prompt', req.prompt);
    form.append('size', sizeStr);
    form.append('quality', this.quality);
    form.append('output_format', 'png');
    form.append('n', '1');
    if (this.supportsTransparentBackground()) {
      form.append('background', 'transparent');
    }

    const buf = Buffer.from(req.referenceImage, 'base64');
    const blob = new Blob([new Uint8Array(buf)], { type: 'image/png' });
    form.append('image', blob, 'reference.png');

    const res = await fetchWithRetry(this.editsUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}` },
      body: form,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`OpenAI images.edit ${res.status}: ${text.slice(0, 300)}`);
    }

    const payload = await readResponsePayload(res);
    const b64 = await resolveImageBase64(payload, this.apiKey);
    if (!b64) {
      throw new Error(
        `OpenAI edit returned no image data. Response shape: ${summarizeResponseShape(payload)}.`,
      );
    }

    const [w, h] = sizeStr.split('x').map(Number);
    return { rawBase64Image: b64, rawWidth: w, rawHeight: h };
  }
}

// Pick the closest preset size for the requested aspect ratio.
// gpt-image-2 supports more sizes but the three canonical presets
// (1024² / 1536×1024 / 1024×1536) are also valid and downstream pipeline
// (slicer / postProcess) is tuned for them.
function pickSize(w: number, h: number): string {
  const ratio = w / h;
  if (ratio > 1.3) return '1536x1024';
  if (ratio < 0.77) return '1024x1536';
  return '1024x1024';
}

function trimSlash(s: string): string {
  return s.replace(/\/+$/, '');
}

async function readResponsePayload(res: Response): Promise<unknown> {
  const text = await res.text();
  return parseMaybeJson(text);
}

async function resolveImageBase64(
  payload: unknown,
  apiKey: string,
): Promise<string | null> {
  const embedded = extractImageBase64(payload);
  if (embedded) return embedded;

  const url = extractImageUrl(payload);
  if (!url) return null;

  let res = await fetchWithRetry(url, {});
  if (res.status === 401 || res.status === 403) {
    res = await fetchWithRetry(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
  }
  if (!res.ok) {
    throw new Error(`OpenAI image URL fetch ${res.status}.`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  return buf.toString('base64');
}
