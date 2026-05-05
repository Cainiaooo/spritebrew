// OpenAI Responses-API adapter for relay stations that route image
// generation through `/v1/responses` instead of `/v1/images/generations`.
//
// Some Chinese-region relay providers (co.yes.vg, similar) only expose
// the unified Responses API and encode the output size in the model name
// (`gpt-image-1024x1536`). Their request shape is the OpenAI Responses
// API: `{model, input: [{type:'message', role:'user', content:[…]}],
// stream: true, store: false}`, and the image arrives streamed in SSE
// events (typically `response.image_generation_call.partial_image` /
// `response.image_generation_call.completed`).
//
// generate() and editWithReference() both go through one POST to
// /v1/responses. Reference images are attached as `input_image` content
// blocks alongside the prompt text.
//
// Configurable via env (reuses the existing OPENAI_* vars):
//   OPENAI_BASE_URL      e.g. https://co.yes.vg
//   OPENAI_API_KEY       e.g. team-xxxx (relay token)
//   OPENAI_IMAGE_MODEL   model prefix; default 'gpt-image' (size suffix
//                        is appended automatically: gpt-image-1024x1024,
//                        gpt-image-1536x1024, gpt-image-1024x1536)

import type {
  EditRequest,
  GenResult,
  GenerateRequest,
  ImageGenAdapter,
} from './types';
import { fetchWithRetry } from './retry';

const DEFAULT_BASE_URL = 'https://api.openai.com';
const DEFAULT_MODEL_PREFIX = 'gpt-image';

export interface GptImageResponsesAdapterOptions {
  apiKey?: string;
  baseUrl?: string;
  modelPrefix?: string;
}

interface ResponsesContentBlock {
  type: 'input_text' | 'input_image';
  text?: string;
  image_url?: string;
}

export class GptImageResponsesAdapter implements ImageGenAdapter {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly modelPrefix: string;

  constructor(opts: GptImageResponsesAdapterOptions = {}) {
    const key = opts.apiKey ?? process.env.OPENAI_API_KEY;
    if (!key) throw new Error('OPENAI_API_KEY is not set.');
    this.apiKey = key;
    this.baseUrl = trimSlash(
      opts.baseUrl ?? process.env.OPENAI_BASE_URL ?? DEFAULT_BASE_URL,
    );
    this.modelPrefix =
      opts.modelPrefix ?? process.env.OPENAI_IMAGE_MODEL ?? DEFAULT_MODEL_PREFIX;
  }

  private get url(): string {
    return `${this.baseUrl}/v1/responses`;
  }

  async generate(req: GenerateRequest): Promise<GenResult> {
    const size = pickSize(req.width, req.height);
    const content: ResponsesContentBlock[] = [
      { type: 'input_text', text: req.prompt },
    ];
    if (req.referenceImages?.length) {
      for (const img of req.referenceImages) {
        content.push({ type: 'input_image', image_url: ensureDataUri(img) });
      }
    }
    return this.callResponses(size, content);
  }

  async editWithReference(req: EditRequest): Promise<GenResult> {
    const canvas = req.canvasSize ?? { w: 1024, h: 1024 };
    const size = pickSize(canvas.w, canvas.h);
    const content: ResponsesContentBlock[] = [
      { type: 'input_text', text: req.prompt },
      { type: 'input_image', image_url: ensureDataUri(req.referenceImage) },
    ];
    return this.callResponses(size, content);
  }

  private async callResponses(
    size: string,
    content: ResponsesContentBlock[],
  ): Promise<GenResult> {
    const model = `${this.modelPrefix}-${size}`;
    const body = {
      model,
      input: [{ type: 'message', role: 'user', content }],
      stream: true,
      store: false,
    };

    const res = await fetchWithRetry(this.url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`OpenAI responses ${res.status}: ${text.slice(0, 300)}`);
    }
    if (!res.body) {
      throw new Error('OpenAI responses returned no body.');
    }

    const b64 = await consumeResponsesStream(res.body);
    if (!b64) {
      throw new Error('OpenAI responses stream ended without an image.');
    }
    const [w, h] = size.split('x').map(Number);
    return { rawBase64Image: b64, rawWidth: w, rawHeight: h };
  }
}

// Walk the streamed JSON looking for image base64 in any of the known
// field names. Different relays put the image in different places
// (`partial_image_b64`, `b64_json`, `image_b64`, etc.) but they all
// share the convention of using one of those keys at SOME nesting depth.
// We accept any of them and prefer the longest (= final/largest image).
const IMAGE_KEY_NAMES = new Set([
  'partial_image_b64',
  'b64_json',
  'image_b64',
  'image_base64',
  'b64',
]);

async function consumeResponsesStream(
  body: ReadableStream<Uint8Array>,
): Promise<string | null> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let bestImage: string | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const events = buffer.split('\n\n');
    buffer = events.pop() ?? '';

    for (const event of events) {
      const dataLines = event
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim());
      if (dataLines.length === 0) continue;
      const raw = dataLines.join('');
      if (!raw || raw === '[DONE]') continue;

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        continue;
      }

      const candidate = extractImageB64(parsed);
      if (candidate && (!bestImage || candidate.length > bestImage.length)) {
        bestImage = candidate;
      }
    }
  }

  return bestImage;
}

function extractImageB64(obj: unknown): string | null {
  let best: string | null = null;
  const visit = (v: unknown, key?: string) => {
    if (typeof v === 'string') {
      if (key && IMAGE_KEY_NAMES.has(key) && v.length > 100) {
        const cleaned = v.replace(/\s/g, '');
        if (!best || cleaned.length > best.length) best = cleaned;
      }
      return;
    }
    if (Array.isArray(v)) {
      for (const item of v) visit(item);
      return;
    }
    if (v !== null && typeof v === 'object') {
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        visit(val, k);
      }
    }
  };
  visit(obj);
  return best;
}

// Closest preset size for the requested aspect ratio. Matches the
// downstream slicer / postProcess pipeline tuning.
function pickSize(w: number, h: number): string {
  const ratio = w / h;
  if (ratio > 1.3) return '1536x1024';
  if (ratio < 0.77) return '1024x1536';
  return '1024x1024';
}

function ensureDataUri(b64OrUri: string): string {
  return b64OrUri.startsWith('data:')
    ? b64OrUri
    : `data:image/png;base64,${b64OrUri}`;
}

function trimSlash(s: string): string {
  return s.replace(/\/+$/, '');
}
