// runMapCreate — map generation POC.
// Generates a ground-only base tile and a dressed reference (base + props overlay).

import { getImageGenAdapter } from '@/lib/imageGen';
import { resizeBase64ImageIfNeeded } from './postprocess';
import type { MapCreateInput, MapCreateResult, PartialImageHandler } from './types';

const STYLE_PROMPTS: Record<MapCreateInput['style'], string> = {
  overworld: 'top-down pixel art overworld map tile, grass, paths, water edges',
  dungeon: 'top-down pixel art dungeon floor, stone tiles, cracks, torchlight',
  interior: 'top-down pixel art interior room, wooden floor, walls visible at edges',
  forest: 'top-down pixel art dense forest floor, trees, bushes, leaf litter',
  desert: 'top-down pixel art desert terrain, sand dunes, cacti, rocks',
};

export async function runMapCreate(
  body: MapCreateInput,
  onPartialImage?: PartialImageHandler,
): Promise<MapCreateResult> {
  const w = body.width ?? 512;
  const h = body.height ?? 512;
  const styleHint = STYLE_PROMPTS[body.style];
  const adapter = await getImageGenAdapter();

  // Step 1: ground-only base
  const basePrompt = `${styleHint}, ${body.prompt}, ground only, no props, no characters, no objects, seamless tileable, pixel art style`;
  const baseRaw = await adapter.generate({
    prompt: basePrompt,
    width: w,
    height: h,
    onPartialImage,
  });
  const normalizedBase = await resizeBase64ImageIfNeeded(
    baseRaw.rawBase64Image,
    baseRaw.rawWidth,
    baseRaw.rawHeight,
    w,
    h,
  );

  // Step 2: dressed reference (same scene + props for visual reference)
  const dressedPrompt = `${styleHint}, ${body.prompt}, with scattered props and decorations (barrels, crates, plants, furniture), top-down view, pixel art style`;
  const dressedRaw = await adapter.generate({
    prompt: dressedPrompt,
    width: w,
    height: h,
    referenceImages: [normalizedBase],
    onPartialImage,
  });
  const normalizedDressed = await resizeBase64ImageIfNeeded(
    dressedRaw.rawBase64Image,
    dressedRaw.rawWidth,
    dressedRaw.rawHeight,
    w,
    h,
  );

  return {
    success: true,
    baseImageUrl: `data:image/png;base64,${normalizedBase}`,
    dressedImageUrl: `data:image/png;base64,${normalizedDressed}`,
    prediction: {
      status: 'succeeded',
      cost: (baseRaw.cost ?? 0) + (dressedRaw.cost ?? 0),
    },
  };
}
