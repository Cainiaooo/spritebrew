// Action: bundle — generate a group of related assets in one request.

import { defineAction, s } from '@ageniti/core';
import { runCreate } from '@/lib/generation/runCreate';
import { runAnimate } from '@/lib/generation/runAnimate';
import { BUNDLE_PRESETS, BUNDLE_TYPES } from '@/lib/generation/bundles';
import { validateCreateBody, validateAnimateBody } from '@/lib/generation/validate';
import type { CreateInput, AnimateInput, QaWarning } from '@/lib/generation/types';

export const bundle = defineAction({
  name: 'bundle',
  description:
    'Generate a bundle of related sprite assets in one call. E.g. a spell bundle produces cast + projectile + impact sprites.',
  visibility: 'public',
  sideEffects: 'read',
  idempotency: 'non_idempotent',
  input: s.object({
    type: s.enum(BUNDLE_TYPES).describe('Bundle preset: unit, spell, combat, or character_full.'),
    prompt: s.string().min(1).describe('Base subject description, e.g. "ice wizard"'),
    style: s.string().optional().describe('Style id from styles_list. Defaults to the first style.'),
    width: s.number().int().optional().describe('Sprite width in pixels. Defaults to 64.'),
    height: s.number().int().optional().describe('Sprite height in pixels. Defaults to 64.'),
  }),
  output: s.object({
    assets: s.array(
      s.object({
        name: s.string().describe('Asset name within the bundle (e.g. "idle", "cast").'),
        imageBase64: s.string().describe('PNG as raw base64.'),
        type: s.enum(['sprite', 'animation']).describe('Whether this is a single frame or strip.'),
        frameCount: s.number().int().optional().describe('Frame count if animation.'),
        qaWarnings: s.array(s.object({ code: s.string(), message: s.string() })),
      }),
    ),
    bundleType: s.string(),
    totalCost: s.number().optional(),
  }),
  async run(input, ctx) {
    const steps = BUNDLE_PRESETS[input.type];
    const width = input.width ?? 64;
    const height = input.height ?? 64;
    const assets: Array<{
      name: string;
      imageBase64: string;
      type: 'sprite' | 'animation';
      frameCount?: number;
      qaWarnings: QaWarning[];
    }> = [];
    let totalCost = 0;
    let baseImageBase64: string | undefined;

    ctx.logger.info('Starting bundle', { type: input.type, steps: steps.length });

    for (const step of steps) {
      ctx.logger.info(`Bundle step: ${step.name}`, { stepType: step.type });

      if (step.type === 'generate') {
        const body: CreateInput = {
          prompt: input.prompt + (step.promptSuffix ?? ''),
          style: input.style,
          width,
          height,
          removeBg: true,
        };
        const err = validateCreateBody(body);
        if (err) throw new Error(`Bundle step "${step.name}" validation failed: ${err}`);

        const result = await runCreate(body, async (rawBase64Image) => {
          ctx.artifacts.add({
            type: 'partial-image',
            name: `${step.name}-partial-${Date.now()}.png`,
            mimeType: 'image/png',
            metadata: { base64: rawBase64Image },
          });
        });

        const imageBase64 = result.imageUrl.replace(/^data:image\/png;base64,/, '');
        if (!baseImageBase64) baseImageBase64 = imageBase64;
        totalCost += result.prediction.cost ?? 0;
        if (step.emit !== false) {
          assets.push({
            name: step.name,
            imageBase64,
            type: 'sprite',
            qaWarnings: result.qaWarnings,
          });
        }
      } else {
        // animate — uses the first generated sprite as input
        if (!baseImageBase64) {
          throw new Error(`Bundle step "${step.name}" requires a prior generate step.`);
        }
        const body: AnimateInput = {
          inputImage: baseImageBase64,
          action: step.action!,
          framesDuration: step.framesDuration,
          motionPrompt: step.motionPrompt,
          width,
          height: width, // animate requires square
        };
        const err = validateAnimateBody(body);
        if (err) throw new Error(`Bundle step "${step.name}" validation failed: ${err}`);

        const result = await runAnimate(body, async (rawBase64Image) => {
          ctx.artifacts.add({
            type: 'partial-image',
            name: `${step.name}-partial-${Date.now()}.png`,
            mimeType: 'image/png',
            metadata: { base64: rawBase64Image },
          });
        });

        const imageBase64 = result.imageUrl.replace(/^data:image\/png;base64,/, '');
        totalCost += result.prediction.cost ?? 0;
        assets.push({
          name: step.name,
          imageBase64,
          type: 'animation',
          frameCount: result.prediction.frameCount,
          qaWarnings: result.qaWarnings,
        });
      }
    }

    return {
      assets,
      bundleType: input.type,
      totalCost: totalCost || undefined,
    };
  },
});
