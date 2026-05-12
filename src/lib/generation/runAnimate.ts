// runAnimate — sprite-to-animation runner.
// Pure async function lifted from src/app/api/generate/route.ts.

import { getImageGenAdapter } from '@/lib/imageGen';
import {
  composeFramesHorizontally,
  detectAndSliceFrames,
} from '@/lib/imageGen/spritesheetSlicer';
import { qaFrameSheet } from '@/lib/imageGen/qa';
import { applyOutfitToSheet } from '@/lib/parts/compositor';
import { buildAnimatePrompt, pickAnimationLayout } from './prompts';
import { ACTION_PROMPT_PREFIX, VALID_FRAME_DURATIONS } from './validate';
import type { AnimateInput, AnimateResult, PartialImageHandler } from './types';

export async function runAnimate(
  body: AnimateInput,
  onPartialImage?: PartialImageHandler,
): Promise<AnimateResult> {
  const frameCount =
    body.framesDuration &&
    (VALID_FRAME_DURATIONS as readonly number[]).includes(body.framesDuration)
      ? body.framesDuration
      : 6;
  const frameSize = body.width ?? 64;
  const action = body.action;
  const motion = body.motionPrompt?.trim() ?? '';
  const layout = pickAnimationLayout(frameCount);

  const actionPrefix = ACTION_PROMPT_PREFIX[action] ?? '';
  const customMotion =
    action === 'custom_action' ? motion || 'smooth animation' : '';
  const prompt = buildAnimatePrompt({
    frameCount,
    layout,
    actionPrefix,
    extraMotion: customMotion || motion,
  });

  const referenceB64 = body.inputImage.replace(/^data:image\/[a-z]+;base64,/, '');
  const adapter = await getImageGenAdapter();

  const raw = await adapter.editWithReference({
    referenceImages: [referenceB64],
    prompt,
    canvasSize: { w: layout.canvasW, h: layout.canvasH },
    onPartialImage,
  });

  const frames = await detectAndSliceFrames(
    raw.rawBase64Image,
    { cols: layout.cols, rows: layout.rows },
    frameCount,
    frameSize,
  );

  // QA the per-frame array before stitching — sheet-level QA can't catch
  // size variation across frames once they've been packed into one image.
  const qaWarnings = await qaFrameSheet(frames);

  let composed = await composeFramesHorizontally(frames, frameSize);

  if (body.outfit && Object.keys(body.outfit).length > 0) {
    composed = await applyOutfitToSheet(composed, body.outfit, frameCount, frameSize);
  }

  return {
    success: true,
    imageUrl: `data:image/png;base64,${composed}`,
    prediction: {
      status: 'succeeded',
      cost: raw.cost,
      frameCount,
      layout: `${layout.cols}x${layout.rows}`,
      sourcePxPerFrame: `${Math.floor(layout.canvasW / layout.cols)}x${Math.floor(
        layout.canvasH / layout.rows,
      )}`,
    },
    qaWarnings,
  };
}
