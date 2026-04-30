// OpenAI gpt-image-1 adapter.
//
// generate() → POST /v1/images/generations (text-only)
// editWithReference() → POST /v1/images/edits (multipart with reference)
//
// Returns a 1024x1024 base64 PNG; downstream postProcess shrinks to target size.

import type {
  EditRequest,
  GenResult,
  GenerateRequest,
  ImageGenAdapter,
} from './types';
import { fetchWithRetry } from './retry';

const GENERATIONS_URL = 'https://api.openai.com/v1/images/generations';
const EDITS_URL = 'https://api.openai.com/v1/images/edits';
const MODEL = 'gpt-image-1';

export class GptImageAdapter implements ImageGenAdapter {
  private readonly apiKey: string;

  constructor(apiKey?: string) {
    const key = apiKey ?? process.env.OPENAI_API_KEY;
    if (!key) throw new Error('OPENAI_API_KEY is not set.');
    this.apiKey = key;
  }

  async generate(req: GenerateRequest): Promise<GenResult> {
    if (req.referenceImages && req.referenceImages.length > 0) {
      return this.editWithReference({
        referenceImage: req.referenceImages[0],
        prompt: req.prompt,
        canvasSize: { w: req.width, h: req.height },
      });
    }

    const sizeStr = pickGenerateSize(req.width, req.height);
    const body = {
      model: MODEL,
      prompt: req.prompt,
      size: sizeStr,
      quality: 'medium',
      background: 'transparent',
      n: 1,
    };

    const res = await fetchWithRetry(GENERATIONS_URL, {
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

    const json = (await res.json()) as {
      data?: Array<{ b64_json?: string }>;
    };
    const b64 = json.data?.[0]?.b64_json;
    if (!b64) throw new Error('OpenAI returned no image data.');

    const [w, h] = sizeStr.split('x').map(Number);
    return { rawBase64Image: b64, rawWidth: w, rawHeight: h };
  }

  async editWithReference(req: EditRequest): Promise<GenResult> {
    const canvas = req.canvasSize ?? { w: 1024, h: 1024 };
    const sizeStr = pickEditSize(canvas.w, canvas.h);

    const form = new FormData();
    form.append('model', MODEL);
    form.append('prompt', req.prompt);
    form.append('size', sizeStr);
    form.append('quality', 'medium');
    form.append('background', 'transparent');
    form.append('n', '1');

    const buf = Buffer.from(req.referenceImage, 'base64');
    const blob = new Blob([new Uint8Array(buf)], { type: 'image/png' });
    form.append('image', blob, 'reference.png');

    const res = await fetchWithRetry(EDITS_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}` },
      body: form,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`OpenAI images.edit ${res.status}: ${text.slice(0, 300)}`);
    }

    const json = (await res.json()) as {
      data?: Array<{ b64_json?: string }>;
    };
    const b64 = json.data?.[0]?.b64_json;
    if (!b64) throw new Error('OpenAI edit returned no image data.');

    const [w, h] = sizeStr.split('x').map(Number);
    return { rawBase64Image: b64, rawWidth: w, rawHeight: h };
  }
}

// gpt-image-1 only accepts {1024×1024, 1536×1024, 1024×1536}.
// Pick the closest supported size for the requested aspect ratio.
function pickEditSize(w: number, h: number): string {
  const ratio = w / h;
  if (ratio > 1.3) return '1536x1024';
  if (ratio < 0.77) return '1024x1536';
  return '1024x1024';
}

// Same constraint applies to images.generations — same picker.
function pickGenerateSize(w: number, h: number): string {
  return pickEditSize(w, h);
}
