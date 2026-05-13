// composePreview — layer base map + props at specified positions into a preview image.

import sharp from 'sharp';
import type { ComposePreviewInput, ComposePreviewResult } from './types';

export async function composePreview(
  input: ComposePreviewInput,
): Promise<ComposePreviewResult> {
  const { width, height } = input;
  const baseBuf = Buffer.from(input.baseImage, 'base64');

  // Resize base to target dimensions
  let composite = sharp(baseBuf).resize(width, height, { kernel: 'nearest', fit: 'cover' });

  // Build overlay list
  const overlays: sharp.OverlayOptions[] = [];
  for (const prop of input.props) {
    const propBuf = Buffer.from(prop.imageBase64, 'base64');
    let overlayInput: Buffer | sharp.Sharp = sharp(propBuf);
    if (prop.scale && prop.scale !== 1) {
      const meta = await sharp(propBuf).metadata();
      const sw = Math.round((meta.width ?? 64) * prop.scale);
      const sh = Math.round((meta.height ?? 64) * prop.scale);
      overlayInput = sharp(propBuf).resize(sw, sh, { kernel: 'nearest' });
    }
    const finalBuf = await (overlayInput as sharp.Sharp).png().toBuffer();
    overlays.push({ input: finalBuf, left: prop.x, top: prop.y });
  }

  const result = await composite.composite(overlays).png().toBuffer();
  return {
    success: true,
    composedImageUrl: `data:image/png;base64,${result.toString('base64')}`,
  };
}
