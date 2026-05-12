// OpenAI Responses-API adapter for relay stations that route image
// generation through `/v1/responses` instead of `/v1/images/generations`.
//
// Some relay providers only expose the unified Responses API and encode
// the output size in the model name (`gpt-image-1024x1536`). Their request
// shape is the OpenAI Responses API:
// `{model, input: [{type:'message', role:'user', content:[…]}], stream: true,
// store: false}`, and the image arrives streamed in SSE events (typically
// `response.image_generation_call.partial_image` /
// `response.image_generation_call.completed`).
//
// generate() and editWithReference() both go through one POST to
// /v1/responses. Reference images are attached as `input_image` content
// blocks alongside the prompt text.
//
// Credentials (bearer + base URL + extra headers) come from an injected
// `ResolvedCredential` — the adapter no longer reads env for auth.
// Model prefix / request mode / quality still come from env.
//
//   OPENAI_IMAGE_MODEL           model prefix; default 'gpt-image'
//                                (size suffix is appended automatically:
//                                gpt-image-1024x1024, etc.)
//   OPENAI_RESPONSES_IMAGE_MODE  'model-size' default, or 'image-tool' for
//                                relays that follow the Responses
//                                `tools:[{type:'image_generation'}]` shape.

import type {
  EditRequest,
  GenResult,
  GenerateRequest,
  ImageGenAdapter,
  PartialImageHandler,
} from './types';
import type { ResolvedCredential } from './auth/types';
import { fetchWithRetry } from './retry';
import {
  extractImageBase64,
  parseMaybeJson,
} from './responseImage';
import {
  resolveImageQuality,
  validateQuality,
  validateReferenceImages,
  validateSize,
} from './validation';

const DEFAULT_MODEL_PREFIX = 'gpt-image';

export interface GptImageResponsesAdapterOptions {
  credential: ResolvedCredential;
  modelPrefix?: string;
  requestMode?: 'model-size' | 'image-tool';
  quality?: 'low' | 'medium' | 'high' | 'auto';
}

interface ResponsesContentBlock {
  type: 'input_text' | 'input_image';
  text?: string;
  image_url?: string;
}

export class GptImageResponsesAdapter implements ImageGenAdapter {
  private readonly credential: ResolvedCredential;
  private readonly modelPrefix: string;
  private readonly requestMode: 'model-size' | 'image-tool';
  private readonly quality: 'low' | 'medium' | 'high' | 'auto';

  constructor(opts: GptImageResponsesAdapterOptions) {
    this.credential = opts.credential;
    this.modelPrefix =
      opts.modelPrefix ?? process.env.OPENAI_IMAGE_MODEL ?? DEFAULT_MODEL_PREFIX;
    this.requestMode = pickRequestMode(opts.requestMode);
    this.quality = resolveImageQuality(opts.quality);
  }

  private get url(): string {
    return `${this.credential.endpointBase}/v1/responses`;
  }

  private async authHeader(): Promise<string> {
    if (this.credential.kind === 'codex-oauth' && this.credential.fetchBearer) {
      return `Bearer ${await this.credential.fetchBearer()}`;
    }
    if (!this.credential.bearer) {
      throw new Error('GptImageResponsesAdapter: credential has no bearer or fetchBearer.');
    }
    return `Bearer ${this.credential.bearer}`;
  }

  async generate(req: GenerateRequest): Promise<GenResult> {
    validateReferenceImages(req.referenceImages);
    const size = pickSize(req.width, req.height);
    const [canvasW, canvasH] = size.split('x').map(Number);
    validateSize(canvasW, canvasH);
    validateQuality(this.quality);
    const content: ResponsesContentBlock[] = [
      { type: 'input_text', text: req.prompt },
    ];
    if (req.referenceImages?.length) {
      for (const img of req.referenceImages) {
        content.push({ type: 'input_image', image_url: ensureDataUri(img) });
      }
    }
    const textOnlyInput = req.referenceImages?.length ? null : req.prompt;
    return this.callResponses(size, content, textOnlyInput, req.onPartialImage);
  }

  async editWithReference(req: EditRequest): Promise<GenResult> {
    validateReferenceImages(req.referenceImages);
    if (!req.referenceImages.length) {
      throw new Error(
        'GptImageResponsesAdapter.editWithReference: referenceImages is empty.',
      );
    }
    const canvas = req.canvasSize ?? { w: 1024, h: 1024 };
    const size = pickSize(canvas.w, canvas.h);
    const [canvasW, canvasH] = size.split('x').map(Number);
    validateSize(canvasW, canvasH);
    validateQuality(this.quality);
    const content: ResponsesContentBlock[] = [
      { type: 'input_text', text: req.prompt },
    ];
    for (const img of req.referenceImages) {
      content.push({ type: 'input_image', image_url: ensureDataUri(img) });
    }
    return this.callResponses(size, content, null, req.onPartialImage);
  }

  private async callResponses(
    size: string,
    content: ResponsesContentBlock[],
    textOnlyInput: string | null,
    onPartialImage?: PartialImageHandler,
  ): Promise<GenResult> {
    const model =
      this.requestMode === 'model-size' ? `${this.modelPrefix}-${size}` : this.modelPrefix;
    const body =
      this.requestMode === 'image-tool'
        ? buildImageToolBody(model, size, content, textOnlyInput, this.quality)
        : {
            model,
            input: [{ type: 'message', role: 'user', content }],
            stream: true,
            store: false,
          };

    const res = await fetchWithRetry(this.url, {
      method: 'POST',
      headers: {
        Authorization: await this.authHeader(),
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        ...(this.credential.extraHeaders ?? {}),
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

    const b64 = await consumeResponsesStream(res.body, onPartialImage);
    if (!b64) {
      throw new Error('OpenAI responses stream ended without an image.');
    }
    const [w, h] = size.split('x').map(Number);
    return { rawBase64Image: b64, rawWidth: w, rawHeight: h };
  }
}

export async function consumeResponsesStream(
  body: ReadableStream<Uint8Array>,
  onPartialImage?: PartialImageHandler,
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
      const candidate = extractImageFromSseEvent(event);
      if (candidate && candidate !== bestImage) {
        await onPartialImage?.(candidate);
      }
      bestImage = pickBestImage(bestImage, candidate);
    }
  }

  const tailCandidate =
    extractImageFromSseEvent(buffer) ?? extractImageBase64(parseMaybeJson(buffer));
  if (tailCandidate && tailCandidate !== bestImage) {
    await onPartialImage?.(tailCandidate);
  }
  bestImage = pickBestImage(bestImage, tailCandidate);

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

function buildImageToolBody(
  model: string,
  size: string,
  content: ResponsesContentBlock[],
  textOnlyInput: string | null,
  quality: 'low' | 'medium' | 'high' | 'auto',
): Record<string, unknown> {
  const tool: Record<string, unknown> = {
    type: 'image_generation',
    quality,
    output_format: 'png',
  };
  if (size !== 'auto') {
    tool.size = size;
  }

  return {
    model,
    input: textOnlyInput ?? [{ role: 'user', content }],
    tools: [tool],
    stream: true,
    store: false,
  };
}

function pickRequestMode(
  override?: 'model-size' | 'image-tool',
): 'model-size' | 'image-tool' {
  if (override) return override;
  const raw = process.env.OPENAI_RESPONSES_IMAGE_MODE?.trim();
  return raw === 'image-tool' ? 'image-tool' : 'model-size';
}

export function extractImageFromSseEvent(event: string): string | null {
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

export function pickBestImage(current: string | null, next: string | null): string | null {
  if (!next) return current;
  return !current || next.length > current.length ? next : current;
}
