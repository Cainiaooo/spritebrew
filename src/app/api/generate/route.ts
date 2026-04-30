// SSE-streaming API route for sprite generation.
//
// Local single-user deployment — auth/token/account-lock removed. The image
// backend is currently still Retro Diffusion; Phase 2 swaps it for the
// imageGenAdapter (GPT Image 2 / Gemini).

export const runtime = 'nodejs';

const LOCAL_USER_ID = 'local-user';

// ── Constants ──

const RD_API_URL = 'https://api.retrodiffusion.ai/v1/inferences';

// Animate My Character: action → rd_advanced_animation__* prompt_style
const VALID_ACTIONS = ['walking', 'idle', 'attack', 'jump', 'crouch', 'destroy', 'subtle_motion', 'custom_action'];
const VALID_FRAME_DURATIONS = [4, 6, 8, 10, 12, 16];

const ACTION_STYLE_MAP: Record<string, string> = {
  walking: 'rd_advanced_animation__walking',
  idle: 'rd_advanced_animation__idle',
  attack: 'rd_advanced_animation__attack',
  jump: 'rd_advanced_animation__jump',
  crouch: 'rd_advanced_animation__crouch',
  destroy: 'rd_advanced_animation__destroy',
  subtle_motion: 'rd_advanced_animation__subtle_motion',
  custom_action: 'rd_advanced_animation__custom_action',
};

const ACTION_PROMPT_PREFIX: Record<string, string> = {
  walking: 'walking animation, smooth steps',
  idle: 'idle breathing animation, subtle movement',
  attack: 'attack animation, melee swing',
  jump: 'jump animation, rising and falling',
  crouch: 'crouching animation, ducking down',
  destroy: 'death animation, falling and fading',
  subtle_motion: 'subtle ambient motion, wind effect',
  custom_action: '',
};

const FALLBACK_STYLE = 'animation__any_animation';

const RD_REFERENCE_IMAGES_PARAM = 'reference_images';
const RD_MAX_REFERENCE_IMAGES = 9;
// 12MB ceiling on total reference payload, expressed in base64 string length.
const REF_TOTAL_BASE64_BUDGET = 12 * 1024 * 1024 * 4 / 3;

interface GenerateBody {
  prompt?: string;
  // Create New fields
  promptStyle?: string;
  style?: string;
  width?: number;
  height?: number;
  removeBg?: boolean;
  referenceImages?: string[];
  // Animate My Character fields
  mode?: 'create' | 'animate';
  inputImage?: string;
  action?: string;
  motionPrompt?: string;
  framesDuration?: number;
}

// ── SSE helpers ──

const encoder = new TextEncoder();
function sseEvent(data: Record<string, unknown>): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(data)}\n\n`);
}
function sseComment(text: string): Uint8Array {
  return encoder.encode(`: ${text}\n\n`);
}
function sseDone(): Uint8Array {
  return encoder.encode('data: [DONE]\n\n');
}
function startHeartbeat(writer: WritableStreamDefaultWriter<Uint8Array>, ms = 15_000) {
  return setInterval(async () => {
    try { await writer.write(sseComment('heartbeat')); } catch { /* closed */ }
  }, ms);
}

// ── POST handler ──

import { getResolutionMode, GENERATION_STYLES } from '@/lib/styleRegistry';

export async function POST(request: Request) {
  let body: GenerateBody;
  try {
    body = await request.json();
  } catch {
    return Response.json({ success: false, error: 'Invalid request body.' }, { status: 400 });
  }

  const mode = body.mode ?? 'create';

  if (mode === 'create') {
    const err = validateCreateBody(body);
    if (err) return Response.json({ success: false, error: err }, { status: 400 });
  } else {
    const err = validateAnimateBody(body);
    if (err) return Response.json({ success: false, error: err }, { status: 400 });
  }

  // Open SSE stream
  const { readable, writable } = new TransformStream<Uint8Array>();
  const writer = writable.getWriter();

  (async () => {
    const heartbeat = startHeartbeat(writer);
    try {
      await writer.write(sseEvent({ type: 'status', message: 'Starting generation...' }));
      const result = mode === 'animate' ? await runAnimate(body) : await runCreate(body);
      await writer.write(sseEvent({ type: 'result', data: result }));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      await writer.write(sseEvent({ type: 'error', message })).catch(() => {});
    } finally {
      clearInterval(heartbeat);
      await writer.write(sseDone()).catch(() => {});
      await writer.close().catch(() => {});
    }
  })();

  // userId currently unused — referenced for future per-request logging hooks.
  void LOCAL_USER_ID;

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
        return `Width must be between ${mode.min} and ${mode.max} for this style. Got ${body.width}.`;
      }
      if (body.height < mode.min || body.height > mode.max) {
        return `Height must be between ${mode.min} and ${mode.max} for this style. Got ${body.height}.`;
      }
    }
  }

  if (body.referenceImages && body.referenceImages.length > 0) {
    const style = GENERATION_STYLES.find((s) => s.promptStyle === ps);
    if (!style?.supportsReferenceImages) {
      return `Style "${ps}" does not support reference images. Use a Pro style.`;
    }
    if (body.referenceImages.length > RD_MAX_REFERENCE_IMAGES) {
      return `Maximum ${RD_MAX_REFERENCE_IMAGES} reference images. Received ${body.referenceImages.length}.`;
    }
    for (let i = 0; i < body.referenceImages.length; i++) {
      const img = body.referenceImages[i];
      if (typeof img !== 'string' || img.length === 0) {
        return `Reference image ${i + 1} is not a valid string.`;
      }
      if (img.startsWith('data:')) {
        return `Reference image ${i + 1} includes a data: prefix. Strip it before sending.`;
      }
    }
    const totalSize = body.referenceImages.reduce((sum, img) => sum + img.length, 0);
    if (totalSize > REF_TOTAL_BASE64_BUDGET) {
      return 'Total reference image payload too large. Reduce image count or size.';
    }
  }

  return null;
}

function validateAnimateBody(body: GenerateBody): string | null {
  if (!body.inputImage) return 'An input image is required for animation. Please upload a character first.';
  if (!body.action || !VALID_ACTIONS.includes(body.action))
    return `Invalid action. Must be one of: ${VALID_ACTIONS.join(', ')}`;
  const w = body.width ?? 64;
  const h = body.height ?? 64;
  if (w !== h) return `Animation requires square dimensions. Got ${w}x${h}.`;

  const promptStyle = ACTION_STYLE_MAP[body.action] ?? FALLBACK_STYLE;
  const mode = getResolutionMode(promptStyle);
  if (mode) {
    if (mode.kind === 'locked') {
      if (w !== mode.size) {
        return `This style is locked at ${mode.size}x${mode.size}. Got ${w}x${h}.`;
      }
    } else {
      if (w < mode.min || w > mode.max) {
        return `Resolution must be between ${mode.min} and ${mode.max} for this style. Got ${w}.`;
      }
      if (mode.kind === 'variable_special' && !mode.presets.includes(w)) {
        return `Resolution must be one of: ${mode.presets.join(', ')}. Got ${w}.`;
      }
    }
  }
  return null;
}

// ── Runners ──
//
// NOTE: Phase 1 retains the Retro Diffusion direct call. Phase 2 replaces
// callRD() with imageGenAdapter (GPT Image 2 / Gemini) + Phase 3 post-process.

async function callRD(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const rdToken = process.env.RETRO_DIFFUSION_API_KEY;
  if (!rdToken) throw new Error('Retro Diffusion API key not configured.');

  const res = await fetch(RD_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-RD-Token': rdToken },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => 'Unknown');
    throw new Error(`Retro Diffusion error (${res.status}): ${errBody.slice(0, 300)}`);
  }

  const data = await res.json();
  if (!data.base64_images?.length) {
    throw new Error('Generation completed but no image was returned.');
  }

  return {
    success: true,
    imageUrl: `data:image/png;base64,${data.base64_images[0]}`,
    prediction: { status: 'succeeded' },
  };
}

async function runCreate(body: GenerateBody): Promise<Record<string, unknown>> {
  const promptStyle = body.promptStyle ?? body.style;
  const isAnimation = promptStyle?.startsWith('animation__');

  const payload: Record<string, unknown> = {
    prompt: body.prompt!.trim(),
    prompt_style: promptStyle,
    width: body.width,
    height: body.height,
    num_images: 1,
  };

  if (body.removeBg) payload.remove_bg = true;
  if (isAnimation) payload.return_spritesheet = true;

  if (body.referenceImages && body.referenceImages.length > 0) {
    payload[RD_REFERENCE_IMAGES_PARAM] = body.referenceImages;
  }

  return callRD(payload);
}

async function runAnimate(body: GenerateBody): Promise<Record<string, unknown>> {
  const { inputImage, action, framesDuration, motionPrompt } = body;
  const duration = framesDuration && VALID_FRAME_DURATIONS.includes(framesDuration) ? framesDuration : 4;
  const rawBase64 = inputImage!.replace(/^data:image\/[a-z]+;base64,/, '');
  const animSize = body.width ?? 64;

  const prefix = ACTION_PROMPT_PREFIX[action!] ?? '';
  const userMotion = motionPrompt?.trim() ?? '';
  const prompt = action === 'custom_action'
    ? (userMotion || 'smooth animation')
    : [prefix, userMotion].filter(Boolean).join(', ');

  const promptStyle = ACTION_STYLE_MAP[action!] ?? FALLBACK_STYLE;

  const payload: Record<string, unknown> = {
    prompt, width: animSize, height: animSize, num_images: 1,
    prompt_style: promptStyle, frames_duration: duration,
    return_spritesheet: true, input_image: rawBase64,
  };

  try {
    return await callRD(payload);
  } catch {
    if (promptStyle !== FALLBACK_STYLE) {
      payload.prompt_style = FALLBACK_STYLE;
      delete payload.frames_duration;
      return callRD(payload);
    }
    throw new Error('Animation generation failed.');
  }
}
