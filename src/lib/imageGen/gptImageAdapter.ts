// OpenAI gpt-image adapter (gpt-image-2 / gpt-image-1.x).
//
// generate() → POST {base}/v1/images/generations
// editWithReference() → POST {base}/v1/images/edits (multipart with reference)
//
// The adapter no longer reads env directly — credentials (bearer + base URL +
// extra headers) are injected via a `ResolvedCredential`. Model / quality /
// request-mode env fallbacks still live here because they are per-adapter
// knobs, not per-credential knobs.
//
// Note: gpt-image-2 does NOT support `background: 'transparent'`; the param
// is omitted and our postProcess pipeline handles background removal.

import type {
  EditRequest,
  GenResult,
  GenerateRequest,
  ImageGenAdapter,
} from './types';
import type { ResolvedCredential } from './auth/types';
import { fetchWithRetry } from './retry';
import {
  extractImageBase64,
  extractImageUrl,
  parseMaybeJson,
  summarizeResponseShape,
} from './responseImage';
import {
  resolveImageQuality,
  validateGptImage2Constraints,
  validateQuality,
  validateReferenceImages,
  validateSize,
} from './validation';

const DEFAULT_MODEL = 'gpt-image-2';

export interface GptImageAdapterOptions {
  credential: ResolvedCredential;
  model?: string;
  quality?: 'low' | 'medium' | 'high' | 'auto';
}

export class GptImageAdapter implements ImageGenAdapter {
  private readonly credential: ResolvedCredential;
  private readonly model: string;
  private readonly quality: 'low' | 'medium' | 'high' | 'auto';

  constructor(opts: GptImageAdapterOptions) {
    this.credential = opts.credential;
    this.model = opts.model ?? process.env.OPENAI_IMAGE_MODEL ?? DEFAULT_MODEL;
    this.quality = resolveImageQuality(opts.quality);
  }

  private get generationsUrl(): string {
    return `${this.credential.endpointBase}/v1/images/generations`;
  }

  private get editsUrl(): string {
    return `${this.credential.endpointBase}/v1/images/edits`;
  }

  /** gpt-image-2 dropped `background: 'transparent'`. Older models still support it. */
  private supportsTransparentBackground(): boolean {
    return this.model.startsWith('gpt-image-1');
  }

  private async authHeader(): Promise<string> {
    if (this.credential.kind === 'codex-oauth' && this.credential.fetchBearer) {
      return `Bearer ${await this.credential.fetchBearer()}`;
    }
    if (!this.credential.bearer) {
      throw new Error('GptImageAdapter: credential has no bearer or fetchBearer.');
    }
    return `Bearer ${this.credential.bearer}`;
  }

  async generate(req: GenerateRequest): Promise<GenResult> {
    validateReferenceImages(req.referenceImages);
    if (req.referenceImages && req.referenceImages.length > 0) {
      return this.editWithReference({
        referenceImages: req.referenceImages,
        prompt: req.prompt,
        canvasSize: { w: req.width, h: req.height },
      });
    }

    const sizeStr = pickSize(req.width, req.height);
    const [canvasW, canvasH] = sizeStr.split('x').map(Number);
    validateSize(canvasW, canvasH);
    validateQuality(this.quality);
    validateGptImage2Constraints(this.model, {
      background: this.supportsTransparentBackground() ? 'transparent' : undefined,
    });
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
        Authorization: await this.authHeader(),
        'Content-Type': 'application/json',
        ...(this.credential.extraHeaders ?? {}),
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`OpenAI images.generate ${res.status}: ${text.slice(0, 300)}`);
    }

    const payload = await readResponsePayload(res);
    const b64 = await resolveImageBase64(payload, await this.authHeader());
    if (!b64) {
      throw new Error(
        `OpenAI returned no image data. Response shape: ${summarizeResponseShape(payload)}.`,
      );
    }

    const [w, h] = sizeStr.split('x').map(Number);
    return { rawBase64Image: b64, rawWidth: w, rawHeight: h };
  }

  async editWithReference(req: EditRequest): Promise<GenResult> {
    validateReferenceImages(req.referenceImages);
    if (!req.referenceImages.length) {
      throw new Error('GptImageAdapter.editWithReference: referenceImages is empty.');
    }
    const canvas = req.canvasSize ?? { w: 1024, h: 1024 };
    const sizeStr = pickSize(canvas.w, canvas.h);
    const [canvasW, canvasH] = sizeStr.split('x').map(Number);
    validateSize(canvasW, canvasH);
    validateQuality(this.quality);
    validateGptImage2Constraints(this.model, {
      background: this.supportsTransparentBackground() ? 'transparent' : undefined,
    });

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

    // OpenAI's /v1/images/edits accepts multiple reference images via
    // repeated `image[]` parts (up to 16 in gpt-image-2). Each blob gets a
    // unique filename so the server can distinguish them in logs.
    const multi = req.referenceImages.length > 1;
    req.referenceImages.forEach((b64, idx) => {
      const buf = Buffer.from(b64, 'base64');
      const blob = new Blob([new Uint8Array(buf)], { type: 'image/png' });
      const field = multi ? 'image[]' : 'image';
      form.append(field, blob, `reference-${idx + 1}.png`);
    });

    const res = await fetchWithRetry(this.editsUrl, {
      method: 'POST',
      headers: {
        Authorization: await this.authHeader(),
        ...(this.credential.extraHeaders ?? {}),
      },
      body: form,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`OpenAI images.edit ${res.status}: ${text.slice(0, 300)}`);
    }

    const payload = await readResponsePayload(res);
    const b64 = await resolveImageBase64(payload, await this.authHeader());
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

async function readResponsePayload(res: Response): Promise<unknown> {
  const text = await res.text();
  return parseMaybeJson(text);
}

async function resolveImageBase64(
  payload: unknown,
  authHeader: string,
): Promise<string | null> {
  const embedded = extractImageBase64(payload);
  if (embedded) return embedded;

  const url = extractImageUrl(payload);
  if (!url) return null;

  let res = await fetchWithRetry(url, {});
  if (res.status === 401 || res.status === 403) {
    res = await fetchWithRetry(url, {
      headers: { Authorization: authHeader },
    });
  }
  if (!res.ok) {
    throw new Error(`OpenAI image URL fetch ${res.status}.`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  return buf.toString('base64');
}
