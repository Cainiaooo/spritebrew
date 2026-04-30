// Google Gemini image-generation adapter.
//
// Default model: Nano Banana 2 (gemini-3.1-flash-image-preview, 2026-03 release).
// Older models (gemini-2.5-flash-image, gemini-3-pro-image-preview) work with
// the same code by overriding GEMINI_IMAGE_MODEL.
//
// Critical: Gemini requires `responseModalities: ['TEXT', 'IMAGE']` in the
// generationConfig — without it the model returns text only.
//
// Configurable via env:
//   GEMINI_BASE_URL    e.g. https://generativelanguage.googleapis.com (default)
//                      or a relay
//   GEMINI_API_KEY
//   GEMINI_IMAGE_MODEL e.g. gemini-3.1-flash-image-preview (default)

import sharp from 'sharp';
import type {
  EditRequest,
  GenResult,
  GenerateRequest,
  ImageGenAdapter,
} from './types';
import { fetchWithRetry } from './retry';

const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com';
const DEFAULT_MODEL = 'gemini-3.1-flash-image-preview';

const TRANSPARENT_BG_HINT =
  'on a fully transparent background (alpha channel, no background color, no checkerboard)';

interface GeminiPart {
  text?: string;
  inlineData?: { mimeType: string; data: string };
  inline_data?: { mime_type: string; data: string };
}

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: GeminiPart[] };
  }>;
  error?: { message?: string };
}

export interface GeminiAdapterOptions {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}

export class GeminiAdapter implements ImageGenAdapter {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly model: string;

  constructor(opts: GeminiAdapterOptions = {}) {
    const key = opts.apiKey ?? process.env.GEMINI_API_KEY;
    if (!key) throw new Error('GEMINI_API_KEY is not set.');
    this.apiKey = key;
    this.baseUrl = trimSlash(opts.baseUrl ?? process.env.GEMINI_BASE_URL ?? DEFAULT_BASE_URL);
    this.model = opts.model ?? process.env.GEMINI_IMAGE_MODEL ?? DEFAULT_MODEL;
  }

  private get endpoint(): string {
    return `${this.baseUrl}/v1beta/models/${this.model}:generateContent`;
  }

  async generate(req: GenerateRequest): Promise<GenResult> {
    const parts: GeminiPart[] = [
      { text: `${req.prompt}, ${TRANSPARENT_BG_HINT}` },
    ];
    for (const ref of req.referenceImages ?? []) {
      parts.push({ inline_data: { mime_type: 'image/png', data: ref } });
    }
    return this.callApi(parts);
  }

  async editWithReference(req: EditRequest): Promise<GenResult> {
    const parts: GeminiPart[] = [
      { text: `${req.prompt}, ${TRANSPARENT_BG_HINT}` },
      { inline_data: { mime_type: 'image/png', data: req.referenceImage } },
    ];
    return this.callApi(parts);
  }

  private async callApi(parts: GeminiPart[]): Promise<GenResult> {
    const body = {
      contents: [{ parts }],
      // Required: without this Gemini returns text only and we get no image.
      generationConfig: {
        responseModalities: ['TEXT', 'IMAGE'],
      },
    };

    const res = await fetchWithRetry(this.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': this.apiKey,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Gemini ${res.status}: ${text.slice(0, 300)}`);
    }

    const json = (await res.json()) as GeminiResponse;
    if (json.error?.message) {
      throw new Error(`Gemini error: ${json.error.message}`);
    }

    const respParts = json.candidates?.[0]?.content?.parts ?? [];
    for (const p of respParts) {
      const inline = p.inlineData ?? p.inline_data;
      if (inline?.data) {
        const meta = await sharp(Buffer.from(inline.data, 'base64')).metadata();
        return {
          rawBase64Image: inline.data,
          rawWidth: meta.width ?? 1024,
          rawHeight: meta.height ?? 1024,
        };
      }
    }
    throw new Error('Gemini returned no inline image data (model may have responded with text only).');
  }
}

function trimSlash(s: string): string {
  return s.replace(/\/+$/, '');
}
