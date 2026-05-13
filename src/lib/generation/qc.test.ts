import assert from 'node:assert/strict';
import { test } from 'node:test';

import sharp from 'sharp';

import { qcFrames } from './qc';

async function makeFrame(
  width: number,
  height: number,
  fill: { left: number; top: number; width: number; height: number },
): Promise<string> {
  const frame = await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([
      {
        input: {
          create: {
            width: fill.width,
            height: fill.height,
            channels: 4,
            background: { r: 255, g: 255, b: 255, alpha: 1 },
          },
        },
        left: fill.left,
        top: fill.top,
      },
    ])
    .png()
    .toBuffer();

  return frame.toString('base64');
}

test('qcFrames edge-touch can inspect raw cells instead of normalized frames', async () => {
  const processedFrames = await Promise.all([
    makeFrame(8, 8, { left: 0, top: 0, width: 8, height: 8 }),
    makeFrame(8, 8, { left: 0, top: 0, width: 8, height: 8 }),
  ]);
  const rawFrames = await Promise.all([
    makeFrame(12, 12, { left: 2, top: 1, width: 8, height: 10 }),
    makeFrame(12, 12, { left: 2, top: 1, width: 8, height: 10 }),
  ]);

  const normalizedWarnings = await qcFrames(processedFrames);
  const rawAwareWarnings = await qcFrames(processedFrames, {
    edgeCheckFrames: rawFrames,
  });

  assert.ok(normalizedWarnings.some((warning) => warning.code === 'qc.edge_touch'));
  assert.ok(!rawAwareWarnings.some((warning) => warning.code === 'qc.edge_touch'));
});
