// Slice a raw multi-frame sprite sheet (returned by editWithReference) into
// individual frames, then run each frame through postProcessSprite.
//
// Strategy: assume horizontal even layout — divide sheet width by frame count,
// process each slice independently, return N base64 PNGs.

import sharp from 'sharp';
import { postProcessSprite } from './postProcess';

export async function detectAndSliceFrames(
  rawBase64: string,
  expectedFrameCount: number,
  targetFrameSize: number,
  paletteColors?: number,
): Promise<string[]> {
  if (expectedFrameCount < 1) {
    throw new Error(`detectAndSliceFrames: invalid frame count ${expectedFrameCount}`);
  }

  const buf = Buffer.from(rawBase64, 'base64');
  const meta = await sharp(buf).metadata();
  const w = meta.width;
  const h = meta.height;
  if (!w || !h) throw new Error('detectAndSliceFrames: input has no dimensions.');

  const frameW = Math.floor(w / expectedFrameCount);
  const frames: string[] = [];

  for (let i = 0; i < expectedFrameCount; i++) {
    const left = i * frameW;
    const width = i === expectedFrameCount - 1 ? w - left : frameW;
    const sliceBuf = await sharp(buf)
      .extract({ left, top: 0, width, height: h })
      .png()
      .toBuffer();

    const sliceB64 = sliceBuf.toString('base64');
    const processed = await postProcessSprite(sliceB64, {
      targetWidth: targetFrameSize,
      targetHeight: targetFrameSize,
      paletteColors,
    });
    frames.push(processed);
  }

  return frames;
}

// Stitch processed frames back into a single horizontal sprite sheet.
// Each frame is targetFrameSize x targetFrameSize PNG.
export async function composeFramesHorizontally(
  frames: string[],
  frameSize: number,
): Promise<string> {
  if (frames.length === 0) throw new Error('composeFramesHorizontally: no frames.');

  const sheetWidth = frames.length * frameSize;
  const composite = frames.map((b64, i) => ({
    input: Buffer.from(b64, 'base64'),
    left: i * frameSize,
    top: 0,
  }));

  const out = await sharp({
    create: {
      width: sheetWidth,
      height: frameSize,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(composite)
    .png()
    .toBuffer();

  return out.toString('base64');
}
