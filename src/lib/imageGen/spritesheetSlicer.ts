// Slice a multi-frame raw image into individual frames, then run each through
// postProcessSprite. Supports 2D grid layouts: the AI is asked to lay frames
// out as `cols × rows` cells in reading order, which packs ~9× more source
// pixels per frame than a single-row 1024px layout (e.g. 512px vs 170px).

import sharp from 'sharp';
import { postProcessSprite } from './postProcess';

export interface SliceLayout {
  cols: number;
  rows: number;
}

export async function detectAndSliceFrames(
  rawBase64: string,
  layout: SliceLayout,
  expectedFrameCount: number,
  targetFrameSize: number,
  paletteColors?: number,
): Promise<string[]> {
  if (expectedFrameCount < 1) {
    throw new Error(`detectAndSliceFrames: invalid frame count ${expectedFrameCount}`);
  }
  if (layout.cols * layout.rows < expectedFrameCount) {
    throw new Error(
      `detectAndSliceFrames: layout ${layout.cols}×${layout.rows} can't hold ${expectedFrameCount} frames`,
    );
  }

  const buf = Buffer.from(rawBase64, 'base64');
  const meta = await sharp(buf).metadata();
  const w = meta.width;
  const h = meta.height;
  if (!w || !h) throw new Error('detectAndSliceFrames: input has no dimensions.');

  const cellW = Math.floor(w / layout.cols);
  const cellH = Math.floor(h / layout.rows);

  const frames: string[] = [];
  for (let i = 0; i < expectedFrameCount; i++) {
    const col = i % layout.cols;
    const row = Math.floor(i / layout.cols);
    const left = col * cellW;
    const top = row * cellH;
    const width = col === layout.cols - 1 ? w - left : cellW;
    const height = row === layout.rows - 1 ? h - top : cellH;

    const sliceBuf = await sharp(buf)
      .extract({ left, top, width, height })
      .png()
      .toBuffer();

    const processed = await postProcessSprite(sliceBuf.toString('base64'), {
      targetWidth: targetFrameSize,
      targetHeight: targetFrameSize,
      paletteColors,
    });
    frames.push(processed);
  }

  return frames;
}

// Stitch processed frames into a single horizontal sprite sheet.
// Output is always horizontal (engine consumers expect single-row strips).
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
