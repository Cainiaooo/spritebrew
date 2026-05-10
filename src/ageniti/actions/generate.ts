// Action: generate — text-to-sprite single-frame generation.
//
// Wraps src/lib/generation/runCreate. Streams partial-image artifacts so
// CLI/--ndjson consumers see in-progress frames as they arrive from the
// underlying image adapter.

import { defineAction, s } from '@ageniti/core';
import { runCreate } from '@/lib/generation/runCreate';
import { validateCreateBody } from '@/lib/generation/validate';
import type { CreateInput } from '@/lib/generation/types';

const outfitSchema = s
  .object({
    eyes: s.string().optional(),
    heads: s.string().optional(),
    body: s.string().optional(),
    top: s.string().optional(),
  })
  .optional()
  .describe('Optional Pixabots outfit overlay. Use parts_list to discover valid names.');

export const generate = defineAction({
  name: 'generate',
  description:
    'Generate a single pixel-art sprite from a text prompt. Returns a base64-encoded PNG.',
  visibility: 'public',
  sideEffects: 'read',
  idempotency: 'non_idempotent',
  input: s.object({
    prompt: s.string().min(1).describe('Subject description, e.g. "a cute red dragon"'),
    style: s
      .string()
      .optional()
      .describe(
        'Style id from styles_list (e.g. "character", "icon", "tile"). Defaults to first style.',
      ),
    width: s
      .number()
      .int()
      .optional()
      .describe('Output width in pixels. Defaults to 64. Must satisfy the style\'s resolutionMode.'),
    height: s
      .number()
      .int()
      .optional()
      .describe('Output height in pixels. Defaults to 64.'),
    removeBg: s
      .boolean()
      .default(true)
      .describe('Whether to remove the background after generation. Default true.'),
    referenceImages: s
      .array(s.string())
      .optional()
      .describe(
        'Optional 1-4 reference images as raw base64 (no data: prefix). Total payload <16MB.',
      ),
    outfit: outfitSchema,
  }),
  output: s.object({
    imageBase64: s.string().describe('PNG sprite as raw base64 (no data: prefix).'),
    cost: s.number().optional().describe('Provider-reported cost in USD if known.'),
    qaWarnings: s
      .array(s.object({ code: s.string(), message: s.string() }))
      .describe('Non-fatal QA warnings flagged after postprocessing.'),
  }),
  async run(input, ctx) {
    const body: CreateInput = {
      prompt: input.prompt,
      style: input.style,
      width: input.width,
      height: input.height,
      removeBg: input.removeBg,
      referenceImages: input.referenceImages,
      outfit: input.outfit as CreateInput['outfit'],
    };
    const err = validateCreateBody(body);
    if (err) throw new Error(err);

    ctx.logger.info('Starting generation', {
      style: input.style,
      width: input.width,
      height: input.height,
    });

    const result = await runCreate(body, async (rawBase64Image) => {
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
      qaWarnings: result.qaWarnings,
    };
  },
});
