// SSE-streaming API route for sprite generation.
//
// Local single-user deployment — no auth, no token economy.
// Image generation goes through src/lib/imageGen (GPT Image / Gemini),
// followed by postProcessSprite. Optional pixabots-parts overlay applied
// after the AI step when an outfit is provided.
//
// The pure-function runners (runCreate / runAnimate) live under
// src/lib/generation/ so the same logic can drive both this SSE route
// and the Ageniti CLI surface (see src/ageniti/).

export const runtime = 'nodejs';

import { runCreate } from '@/lib/generation/runCreate';
import { runAnimate } from '@/lib/generation/runAnimate';
import { validateCreateBody, validateAnimateBody } from '@/lib/generation/validate';
import type {
  CreateInput,
  AnimateInput,
  PartialImageHandler,
} from '@/lib/generation/types';

interface GenerateBody extends Partial<CreateInput>, Partial<AnimateInput> {
  mode?: 'create' | 'animate';
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
  const err =
    mode === 'animate'
      ? validateAnimateBody(body as AnimateInput)
      : validateCreateBody(body as CreateInput);
  if (err) return Response.json({ success: false, error: err }, { status: 400 });

  const { readable, writable } = new TransformStream<Uint8Array>();
  const writer = writable.getWriter();

  (async () => {
    const heartbeat = startHeartbeat(writer);
    try {
      await writer.write(sseEvent({ type: 'status', message: 'Starting generation...' }));
      const onPartialImage: PartialImageHandler = async (rawBase64Image) => {
        await writer.write(
          sseEvent({
            type: 'partial',
            imageUrl: `data:image/png;base64,${rawBase64Image}`,
          }),
        );
      };
      const result =
        mode === 'animate'
          ? await runAnimate(body as AnimateInput, onPartialImage)
          : await runCreate(body as CreateInput, onPartialImage);
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
