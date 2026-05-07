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
import {
  extractImageBase64,
  parseMaybeJson,
} from './responseImage';

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
      bestImage = pickBestImage(bestImage, extractImageFromSseEvent(event));
    }
  }

  bestImage = pickBestImage(bestImage, extractImageFromSseEvent(buffer));
  bestImage = pickBestImage(bestImage, extractImageBase64(parseMaybeJson(buffer)));

  return bestImage;
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

function extractImageFromSseEvent(event: string): string | null {
  const dataLines = event
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim());
  if (dataLines.length === 0) {
    return extractImageBase64(parseMaybeJson(event));
  }

  let best: string | null = null;
  for (const line of dataLines) {
    if (!line || line === '[DONE]') continue;
    best = pickBestImage(best, extractImageBase64(parseMaybeJson(line)));
  }
  return best;
}

function pickBestImage(current: string | null, next: string | null): string | null {
  if (!next) return current;
  return !current || next.length > current.length ? next : current;
}
