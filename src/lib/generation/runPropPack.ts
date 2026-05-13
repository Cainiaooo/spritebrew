// runPropPack — generate a 3×3 grid of props on magenta background,
// then extract each cell as an individual transparent PNG.

import sharp from 'sharp';
import { getImageGenAdapter } from '@/lib/imageGen';
import { removeMagentaBackground, resizeBase64ImageIfNeeded } from './postprocess';
import type { PropPackInput, PropPackResult, PartialImageHandler } from './types';

const GRID = 3;

export async function runPropPack(
  body: PropPackInput,
  onPartialImage?: PartialImageHandler,
): Promise<PropPackResult> {
  const cellSize = body.width ?? body.height ?? 128;
  const canvasSize = cellSize * GRID;
  const adapter = await getImageGenAdapter();

  const prompt = [
    `A ${GRID}x${GRID} grid of pixel art props/objects: ${body.prompt}.`,
    `Each cell is ${cellSize}x${cellSize}px, objects centered in each cell.`,
    'Solid #FF00FF magenta background, no gradient, no shadows.',
    'Top-down perspective, pixel art style, each prop is distinct.',
  ].join(' ');

  const raw = await adapter.generate({
    prompt,
    width: canvasSize,
    height: canvasSize,
    referenceImages: [body.dressedImage],
    onPartialImage,
  });

  // Slice into cells and remove magenta from each
  const props: PropPackResult['props'] = [];
  const normalizedSheet = await resizeBase64ImageIfNeeded(
    raw.rawBase64Image,
    raw.rawWidth,
    raw.rawHeight,
    canvasSize,
    canvasSize,
  );
  const fullBuf = Buffer.from(normalizedSheet, 'base64');

  for (let row = 0; row < GRID; row++) {
    for (let col = 0; col < GRID; col++) {
      const cellB64 = await sharp(fullBuf)
        .extract({ left: col * cellSize, top: row * cellSize, width: cellSize, height: cellSize })
        .png()
        .toBuffer()
        .then((b) => b.toString('base64'));

      const transparent = await removeMagentaBackground(cellB64);
      const idx = row * GRID + col;
      props.push({
        id: `prop_${idx}`,
        imageUrl: `data:image/png;base64,${transparent}`,
        label: `prop ${idx + 1}`,
      });
    }
  }

  return {
    success: true,
    props,
    prediction: { status: 'succeeded', cost: raw.cost },
  };
}
