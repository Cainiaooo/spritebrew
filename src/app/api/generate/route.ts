// SSE-streaming API route for sprite generation.
//
// Local single-user deployment — no auth, no token economy.
// Image generation goes through src/lib/imageGen (GPT Image / Gemini),
// followed by postProcessSprite. Optional pixabots-parts overlay applied
// after the AI step when an outfit is provided.

export const runtime = 'nodejs';

import { getStyleByPromptStyle, getStyleById, getResolutionMode, GENERATION_STYLES } from '@/lib/styleRegistry';
import { getImageGenAdapter } from '@/lib/imageGen';
import { postProcessSprite } from '@/lib/imageGen/postProcess';
import {
  composeFramesHorizontally,
  detectAndSliceFrames,
} from '@/lib/imageGen/spritesheetSlicer';
import {
  applyOutfitBase64,
  applyOutfitToSheet,
} from '@/lib/parts/compositor';
import { PARTS, type Outfit, type PartCategory } from '@/lib/parts/catalog';

// ── Constants ──

const VALID_ACTIONS = ['walking', 'idle', 'attack', 'jump', 'crouch', 'destroy', 'subtle_motion', 'custom_action'];
const VALID_FRAME_DURATIONS = [4, 6, 8];

const ACTION_PROMPT_PREFIX: Record<string, string> = {
  walking: 'walking animation, smooth steps',
  idle: 'idle breathing animation, subtle motion',
  attack: 'attack animation, melee swing',
  jump: 'jump animation, rising and falling',
  crouch: 'crouching animation, ducking down',
  destroy: 'death animation, falling and fading',
  subtle_motion: 'subtle ambient motion',
  custom_action: '',
};

const MAX_REFERENCE_IMAGES = 4;
const REF_TOTAL_BASE64_BUDGET = 12 * 1024 * 1024 * 4 / 3;

interface GenerateBody {
  prompt?: string;
  promptStyle?: string;
  style?: string;
  width?: number;
  height?: number;
  removeBg?: boolean;
  referenceImages?: string[];
  outfit?: Outfit;
  mode?: 'create' | 'animate';
  inputImage?: string;
  action?: string;
  motionPrompt?: string;
  framesDuration?: number;
}

// ── SSE helpers ──

const encoder = new TextEncoder();
const sseEvent = (data: Record<string, unknown>): Uint8Array =>
  encoder.encode(`data: ${JSON.stringify(data)}\n\n`);
const sseComment = (text: string): Uint8Array =>
  encoder.encode(`: ${text}\n\n`);
const sseDone = (): Uint8Array => encoder.encode('data: [DONE]\n\n');

function startHeartbeat(writer: WritableStreamDefaultWriter<Uint8Array>, ms = 15_000) {
  return setInterval(async () => {
    try {
      await writer.write(sseComment('heartbeat'));
    } catch {
      /* closed */
    }
  }, ms);
}

// ── POST ──

export async function POST(request: Request) {
  let body: GenerateBody;
  try {
    body = await request.json();
  } catch {
    return Response.json({ success: false, error: 'Invalid request body.' }, { status: 400 });
  }

  const mode = body.mode ?? 'create';
  const err = mode === 'animate' ? validateAnimateBody(body) : validateCreateBody(body);
  if (err) return Response.json({ success: false, error: err }, { status: 400 });

  const { readable, writable } = new TransformStream<Uint8Array>();
  const writer = writable.getWriter();

  (async () => {
    const heartbeat = startHeartbeat(writer);
    try {
      await writer.write(sseEvent({ type: 'status', message: 'Starting generation...' }));
      const result = mode === 'animate' ? await runAnimate(body) : await runCreate(body);
      await writer.write(sseEvent({ type: 'result', data: result }));
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Unknown error';
      await writer.write(sseEvent({ type: 'error', message })).catch(() => {});
    } finally {
      clearInterval(heartbeat);
      await writer.write(sseDone()).catch(() => {});
      await writer.close().catch(() => {});
    }
  })();

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}

// ── Validation ──

function validateCreateBody(body: GenerateBody): string | null {
  if (!body.prompt?.trim()) return 'Prompt is required.';
  const ps = body.promptStyle ?? body.style;
  if (!ps) return 'Style is required.';

  const mode = getResolutionMode(ps);
  if (mode && body.width !== undefined && body.height !== undefined) {
    if (mode.kind === 'locked') {
      if (body.width !== mode.size || body.height !== mode.size) {
        return `This style is locked at ${mode.size}x${mode.size}. Got ${body.width}x${body.height}.`;
      }
    } else {
      if (body.width < mode.min || body.width > mode.max) {
        return `Width must be between ${mode.min} and ${mode.max}. Got ${body.width}.`;
      }
      if (body.height < mode.min || body.height > mode.max) {
        return `Height must be between ${mode.min} and ${mode.max}. Got ${body.height}.`;
      }
    }
  }

  if (body.referenceImages?.length) {
    if (body.referenceImages.length > MAX_REFERENCE_IMAGES) {
      return `Maximum ${MAX_REFERENCE_IMAGES} reference images.`;
    }
    for (let i = 0; i < body.referenceImages.length; i++) {
      const img = body.referenceImages[i];
      if (typeof img !== 'string' || img.length === 0) {
        return `Reference image ${i + 1} is not a valid string.`;
      }
      if (img.startsWith('data:')) {
        return `Reference image ${i + 1} includes data: prefix. Strip it before sending.`;
      }
    }
    const total = body.referenceImages.reduce((s, img) => s + img.length, 0);
    if (total > REF_TOTAL_BASE64_BUDGET) {
      return 'Total reference image payload too large.';
    }
  }

  if (body.outfit) {
    const outfitErr = validateOutfit(body.outfit);
    if (outfitErr) return outfitErr;
  }

  return null;
}

function validateAnimateBody(body: GenerateBody): string | null {
  if (!body.inputImage) return 'An input image is required for animation.';
  if (!body.action || !VALID_ACTIONS.includes(body.action)) {
    return `Invalid action. Must be one of: ${VALID_ACTIONS.join(', ')}`;
  }
  const w = body.width ?? 64;
  const h = body.height ?? 64;
  if (w !== h) return `Animation requires square dimensions. Got ${w}x${h}.`;
  if (body.framesDuration && !VALID_FRAME_DURATIONS.includes(body.framesDuration)) {
    return `Frame count must be one of: ${VALID_FRAME_DURATIONS.join(', ')}.`;
  }
  if (body.outfit) {
    const outfitErr = validateOutfit(body.outfit);
    if (outfitErr) return outfitErr;
  }
  return null;
}

function validateOutfit(outfit: Outfit): string | null {
  for (const [cat, name] of Object.entries(outfit)) {
    if (!name) continue;
    const c = cat as PartCategory;
    if (!(c in PARTS)) return `Unknown outfit category: ${cat}`;
    if (!PARTS[c].some((p) => p.name === name)) {
      return `Unknown ${cat} part: ${name}`;
    }
  }
  return null;
}

// ── Runners ──

async function runCreate(body: GenerateBody): Promise<Record<string, unknown>> {
  const w = body.width ?? 64;
  const h = body.height ?? 64;
  const styleKey = body.promptStyle ?? body.style;
  const style =
    (styleKey ? getStyleByPromptStyle(styleKey) ?? getStyleById(styleKey) : undefined) ??
    GENERATION_STYLES[0];

  const prompt = buildCreatePrompt(body.prompt!.trim(), style.promptPrefix, w, h, body.removeBg ?? true);

  const adapter = getImageGenAdapter();
  const raw = await adapter.generate({
    prompt,
    width: w,
    height: h,
    referenceImages: body.referenceImages,
  });

  let processed = await postProcessSprite(raw.rawBase64Image, {
    targetWidth: w,
    targetHeight: h,
    paletteColors: style.paletteColors,
    removeBackground: body.removeBg ?? true,
  });

  if (body.outfit && Object.keys(body.outfit).length > 0) {
    processed = await applyOutfitBase64(processed, body.outfit);
  }

  return {
    success: true,
    imageUrl: `data:image/png;base64,${processed}`,
    prediction: { status: 'succeeded', cost: raw.cost },
  };
}

async function runAnimate(body: GenerateBody): Promise<Record<string, unknown>> {
  const frameCount = body.framesDuration && VALID_FRAME_DURATIONS.includes(body.framesDuration)
    ? body.framesDuration
    : 6;
  const frameSize = body.width ?? 64;
  const action = body.action!;
  const motion = body.motionPrompt?.trim() ?? '';

  const actionPrefix = ACTION_PROMPT_PREFIX[action] ?? '';
  const customMotion = action === 'custom_action' ? (motion || 'smooth animation') : '';
  const promptParts = [
    `${frameCount}-frame ${actionPrefix} sprite sheet of this character`,
    'horizontal layout, evenly spaced frames',
    `each frame ${frameSize}x${frameSize} pixels`,
    'pixel art style, transparent background',
    'character must remain visually identical across all frames',
    customMotion || motion,
  ].filter(Boolean);
  const prompt = promptParts.join(', ');

  const referenceB64 = body.inputImage!.replace(/^data:image\/[a-z]+;base64,/, '');
  const adapter = getImageGenAdapter();

  const raw = await adapter.editWithReference({
    referenceImage: referenceB64,
    prompt,
    canvasSize: { w: frameCount * 256, h: 256 },
  });

  const frames = await detectAndSliceFrames(raw.rawBase64Image, frameCount, frameSize);
  let composed = await composeFramesHorizontally(frames, frameSize);

  if (body.outfit && Object.keys(body.outfit).length > 0) {
    composed = await applyOutfitToSheet(composed, body.outfit, frameCount, frameSize);
  }

  return {
    success: true,
    imageUrl: `data:image/png;base64,${composed}`,
    prediction: { status: 'succeeded', cost: raw.cost, frameCount },
  };
}

// ── Helpers ──

function buildCreatePrompt(userPrompt: string, prefix: string, w: number, h: number, transparent: boolean): string {
  const parts = [prefix, userPrompt, `${w}x${h} pixels`];
  if (transparent) parts.push('transparent background');
  return parts.join(', ');
}
