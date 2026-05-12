// CodexOAuthAdapter — talk to `chatgpt.com/backend-api/codex/responses`
// using a ChatGPT Plus/Pro user's Codex OAuth access_token (from ~/.codex/
// auth.json). The request body is the Responses API with the
// `image_generation` tool; authentication is the codex-tui client's Bearer
// token plus `Originator: codex-tui` and a codex-tui User-Agent.
//
// This adapter does not hit api.openai.com at all. Image generation runs
// against ChatGPT subscription quota, not API billing.
//
// On HTTP 401 it asks the injected CodexTokenStore for a fresh access_token
// (forceRefresh) and retries once. If the refresh fails (refresh_token
// already rotated, etc.) the store surfaces `CodexReauthRequiredError` which
// we propagate as-is so the caller prints a clear "run `codex login`" hint.
//
// If the server answers 4xx with "tool choice ... image_generation ... not
// found ... tools" we drop `tool_choice` and retry the same request once
// (matches the upstream codex-tui client behavior).

import type {
  EditRequest,
  GenResult,
  GenerateRequest,
  ImageGenAdapter,
  PartialImageHandler,
} from './types';
import type { ResolvedCredential } from './auth/types';
import {
  consumeResponsesStream,
} from './gptImageResponsesAdapter';
import {
  CodexReauthRequiredError,
  CodexTokenStore,
} from './auth/codexTokenStore';
import { getTokenStoreForHome } from './auth/resolver';
import { fetchWithRetry } from './retry';
import {
  resolveImageQuality,
  validateQuality,
  validateReferenceImages,
  validateSize,
} from './validation';

const DEFAULT_MAIN_MODEL = 'gpt-5.5';
const DEFAULT_IMAGE_TOOL_MODEL = 'gpt-image-2';

export interface CodexOAuthAdapterOptions {
  credential: ResolvedCredential;
  mainModel?: string;
  imageToolModel?: string;
  quality?: 'low' | 'medium' | 'high' | 'auto';
}

interface ResponsesContentBlock {
  type: 'input_text' | 'input_image';
  text?: string;
  image_url?: string;
}

type ImageAction = 'generate' | 'edit';

export class CodexOAuthAdapter implements ImageGenAdapter {
  private readonly credential: ResolvedCredential;
  private readonly mainModel: string;
  private readonly imageToolModel: string;
  private readonly quality: 'low' | 'medium' | 'high' | 'auto';

  constructor(opts: CodexOAuthAdapterOptions) {
    if (opts.credential.kind !== 'codex-oauth' || !opts.credential.fetchBearer) {
      throw new Error(
        'CodexOAuthAdapter requires a codex-oauth ResolvedCredential with fetchBearer.',
      );
    }
    this.credential = opts.credential;
    this.mainModel = opts.mainModel ?? process.env.CODEX_MAIN_MODEL ?? DEFAULT_MAIN_MODEL;
    this.imageToolModel =
      opts.imageToolModel ?? process.env.OPENAI_IMAGE_MODEL ?? DEFAULT_IMAGE_TOOL_MODEL;
    this.quality = resolveImageQuality(opts.quality);
  }

  private get url(): string {
    return `${this.credential.endpointBase}/responses`;
  }

  async generate(req: GenerateRequest): Promise<GenResult> {
    validateReferenceImages(req.referenceImages);
    const size = pickSize(req.width, req.height);
    const [canvasW, canvasH] = size.split('x').map(Number);
    validateSize(canvasW, canvasH);
    validateQuality(this.quality);
    const content: ResponsesContentBlock[] = [{ type: 'input_text', text: req.prompt }];
    const hasRefs = !!req.referenceImages?.length;
    if (hasRefs) {
      for (const img of req.referenceImages!) {
        content.push({ type: 'input_image', image_url: ensureDataUri(img) });
      }
    }
    return this.callResponses({
      size,
      content,
      action: hasRefs ? 'edit' : 'generate',
      onPartialImage: req.onPartialImage,
    });
  }

  async editWithReference(req: EditRequest): Promise<GenResult> {
    validateReferenceImages(req.referenceImages);
    if (!req.referenceImages.length) {
      throw new Error(
        'CodexOAuthAdapter.editWithReference: referenceImages is empty.',
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
    return this.callResponses({
      size,
      content,
      action: 'edit',
      onPartialImage: req.onPartialImage,
    });
  }

  private async callResponses(args: {
    size: string;
    content: ResponsesContentBlock[];
    action: ImageAction;
    onPartialImage?: PartialImageHandler;
  }): Promise<GenResult> {
    const { size, content, action, onPartialImage } = args;

    const buildBody = (withToolChoice: boolean): Record<string, unknown> => ({
      instructions:
        "You are an image generation assistant. Follow the user's prompt and return the generated image.",
      stream: true,
      reasoning: { effort: 'medium', summary: 'auto' },
      parallel_tool_calls: true,
      include: ['reasoning.encrypted_content'],
      model: this.mainModel,
      store: false,
      ...(withToolChoice ? { tool_choice: 'auto' } : {}),
      input: [{ type: 'message', role: 'user', content }],
      tools: [
        {
          type: 'image_generation',
          action,
          model: this.imageToolModel,
          size,
          quality: this.quality,
        },
      ],
    });

    let droppedToolChoice = false;
    let refreshedOnce = false;
    let body = buildBody(true);

    // Two levels of retry wrapping a single network send:
    //   inner-loop: tool_choice fallback (once) — body-level retry
    //   outer-loop: 401-once-retry via force-refresh — header-level retry
    //
    // We cap at 3 total network attempts which is enough to cover
    // (tool_choice drop) + (401 refresh) + (actual send).
    for (let attempt = 0; attempt < 3; attempt++) {
      const bearer = await this.credential.fetchBearer!();
      const headers: Record<string, string> = {
        Authorization: `Bearer ${bearer}`,
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        Connection: 'Keep-Alive',
        ...(this.credential.extraHeaders ?? {}),
      };
      if (this.credential.userAgent) headers['User-Agent'] = this.credential.userAgent;

      const res = await fetchWithRetry(this.url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });

      if (res.status === 401 && !refreshedOnce) {
        // Try to force-refresh once. The token store may be cached in the
        // module-level resolver map; if not available, just propagate 401.
        const store = this.tokenStore();
        if (store) {
          try {
            await store.forceRefresh();
            refreshedOnce = true;
            // Consume error body so the socket can close.
            await res.text().catch(() => '');
            continue;
          } catch (err) {
            if (err instanceof CodexReauthRequiredError) throw err;
            throw new Error(
              `Codex access_token refresh failed after 401: ${(err as Error).message}.`,
            );
          }
        }
      }

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        if (!droppedToolChoice && shouldRetryWithoutToolChoice(text)) {
          droppedToolChoice = true;
          body = buildBody(false);
          continue;
        }
        if (res.status === 401) {
          throw new CodexReauthRequiredError(
            `Codex backend rejected access_token after refresh retry. Run \`codex login\` and restart.`,
          );
        }
        throw new Error(
          `Codex /responses ${res.status}: ${text.slice(0, 300) || '<empty body>'}`,
        );
      }

      if (!res.body) {
        throw new Error('Codex /responses returned no body.');
      }

      const b64 = await consumeResponsesStream(res.body, onPartialImage);
      if (!b64) {
        throw new Error('Codex /responses stream ended without an image.');
      }
      const [w, h] = size.split('x').map(Number);
      return { rawBase64Image: b64, rawWidth: w, rawHeight: h };
    }

    throw new Error('Codex /responses exhausted retry budget without a successful response.');
  }

  private tokenStore(): CodexTokenStore | undefined {
    return getTokenStoreForHome();
  }
}

function shouldRetryWithoutToolChoice(raw: string): boolean {
  const msg = raw.toLowerCase();
  return (
    msg.includes('tool choice') &&
    msg.includes('image_generation') &&
    msg.includes('not found') &&
    msg.includes('tools')
  );
}

function pickSize(w: number, h: number): string {
  const ratio = w / h;
  if (ratio > 1.3) return '1536x1024';
  if (ratio < 0.77) return '1024x1536';
  return '1024x1024';
}

function ensureDataUri(b64OrUri: string): string {
  return b64OrUri.startsWith('data:') ? b64OrUri : `data:image/png;base64,${b64OrUri}`;
}
