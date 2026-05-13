// runCreate — text-to-sprite generation runner.
// Pure async function lifted from src/app/api/generate/route.ts so both
// the SSE route and the Ageniti CLI action can reuse it.

import {
  GENERATION_STYLES,
  getStyleById,
  getStyleByPromptStyle,
} from '@/lib/styleRegistry';
import { getImageGenAdapter } from '@/lib/imageGen';
import { postProcessSprite } from '@/lib/imageGen/postProcess';
import { qaSingleSprite } from '@/lib/imageGen/qa';
import { applyOutfitBase64 } from '@/lib/parts/compositor';
import { buildCreatePrompt } from './prompts';
import {
  shouldUseMagentaPipeline,
  injectMagentaPrompt,
  removeMagentaBackground,
} from './postprocess';
import type { CreateInput, CreateResult, PartialImageHandler } from './types';

export async function runCreate(
  body: CreateInput,
  onPartialImage?: PartialImageHandler,
): Promise<CreateResult> {
  const w = body.width ?? 64;
  const h = body.height ?? 64;
  const styleKey = body.promptStyle ?? body.style;
  const style =
    (styleKey ? getStyleByPromptStyle(styleKey) ?? getStyleById(styleKey) : undefined) ??
    GENERATION_STYLES[0];

  const useMagenta = shouldUseMagentaPipeline() && (body.removeBg ?? true);

  let prompt = buildCreatePrompt(
    body.prompt.trim(),
    style.promptPrefix,
    w,
    h,
    useMagenta ? false : (body.removeBg ?? true),
    style.promptHints,
  );
  if (useMagenta) prompt = injectMagentaPrompt(prompt);

  const adapter = await getImageGenAdapter();
  const raw = await adapter.generate({
    prompt,
    width: w,
    height: h,
    referenceImages: body.referenceImages,
    onPartialImage,
  });

  const base64ForPostProcess = useMagenta
    ? await removeMagentaBackground(raw.rawBase64Image)
    : raw.rawBase64Image;

  let processed = await postProcessSprite(base64ForPostProcess, {
    targetWidth: w,
    targetHeight: h,
    paletteColors: style.paletteColors,
    removeBackground: useMagenta ? false : (body.removeBg ?? true),
  });

  if (body.outfit && Object.keys(body.outfit).length > 0) {
    processed = await applyOutfitBase64(processed, body.outfit);
  }

  const qaWarnings = await qaSingleSprite(processed);

  return {
    success: true,
    imageUrl: `data:image/png;base64,${processed}`,
    prediction: { status: 'succeeded', cost: raw.cost },
    qaWarnings,
  };
}
