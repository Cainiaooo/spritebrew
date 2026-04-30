// Gemini 2.5 Flash Image adapter (a.k.a. "Nano Banana").
//
// Single endpoint :generateContent serves both text-only and image-conditioned
// requests. Transparent background is requested via prompt text — postProcess
// is responsible for enforcing it.

import type {
  EditRequest,
  GenResult,
  GenerateRequest,
  ImageGenAdapter,
} from './types';
import { fetchWithRetry } from './retry';

const MODEL = 'gemini-2.5-flash-image';
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

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
}

export class GeminiAdapter implements ImageGenAdapter {
  private readonly apiKey: string;

  constructor(apiKey?: string) {
    const key = apiKey ?? process.env.GEMINI_API_KEY;
    if (!key) throw new Error('GEMINI_API_KEY is not set.');
    this.apiKey = key;
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
    const body = { contents: [{ parts }] };

    const res = await fetchWithRetry(ENDPOINT, {
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
    const respParts = json.candidates?.[0]?.content?.parts ?? [];
    for (const p of respParts) {
      const inline = p.inlineData ?? p.inline_data;
      if (inline?.data) {
        return {
          rawBase64Image: inline.data,
          rawWidth: 1024,
          rawHeight: 1024,
        };
      }
    }
    throw new Error('Gemini returned no inline image data.');
  }
}
