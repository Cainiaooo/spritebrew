// Action: animate — turn an existing sprite into a multi-frame animation strip.

import { defineAction, s } from '@ageniti/core';
import { runAnimate } from '@/lib/generation/runAnimate';
import { validateAnimateBody, VALID_ACTIONS } from '@/lib/generation/validate';
import type { AnimateInput } from '@/lib/generation/types';

const outfitSchema = s
  .object({
    eyes: s.string().optional(),
    heads: s.string().optional(),
    body: s.string().optional(),
    top: s.string().optional(),
  })
  .optional()
  .describe('Optional Pixabots outfit overlay applied to every frame.');

export const animate = defineAction({
  name: 'animate',
  description:
    'Generate a multi-frame animation strip from an existing character sprite. Returns a horizontally composed PNG.',
  visibility: 'public',
  sideEffects: 'read',
  idempotency: 'non_idempotent',
  input: s.object({
    inputImage: s
      .string()
      .min(1)
      .describe(
        'Source sprite as raw base64 (no data: prefix). Must be square. Use the output of `generate` directly.',
      ),
    action: s
      .enum(VALID_ACTIONS)
      .describe('Animation action. Use custom_action with motionPrompt for free-form motion.'),
    framesDuration: s
      .number()
      .int()
      .optional()
      .describe('Frame count. Must be 4, 6 (default), or 8.'),
    motionPrompt: s
      .string()
      .optional()
      .describe('Extra motion description, useful with action=custom_action.'),
    width: s
      .number()
      .int()
      .optional()
      .describe('Per-frame square size in pixels. Defaults to 64. Must equal height.'),
    outfit: outfitSchema,
  }),
  output: s.object({
    imageBase64: s.string().describe('Horizontally composed strip as raw base64 PNG.'),
    cost: s.number().optional(),
    frameCount: s.number().int(),
    layout: s.string().describe('Source grid layout, e.g. "3x2".'),
    sourcePxPerFrame: s.string().describe('Source-canvas pixel resolution per frame.'),
    qaWarnings: s.array(s.object({ code: s.string(), message: s.string() })),
  }),
  async run(input, ctx) {
    const body: AnimateInput = {
      inputImage: input.inputImage,
      action: input.action,
      framesDuration: input.framesDuration,
      motionPrompt: input.motionPrompt,
      width: input.width,
      height: input.width, // animate enforces square; mirror width to height
      outfit: input.outfit as AnimateInput['outfit'],
    };
    const err = validateAnimateBody(body);
    if (err) throw new Error(err);

    ctx.logger.info('Starting animation', {
      action: input.action,
      framesDuration: input.framesDuration ?? 6,
      width: input.width ?? 64,
    });

    const result = await runAnimate(body, async (rawBase64Image) => {
      ctx.artifacts.add({
        type: 'partial-image',
        name: `partial-${Date.now()}.png`,
        mimeType: 'image/png',
        metadata: { base64: rawBase64Image },
      });
    });

    const imageBase64 = result.imageUrl.replace(/^data:image\/png;base64,/, '');
    return {
      imageBase64,
      cost: result.prediction.cost,
      frameCount: result.prediction.frameCount,
      layout: result.prediction.layout,
      sourcePxPerFrame: result.prediction.sourcePxPerFrame,
      qaWarnings: result.qaWarnings,
    };
  },
});
