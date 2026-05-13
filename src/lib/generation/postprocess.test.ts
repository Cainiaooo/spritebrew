import assert from 'node:assert/strict';
import { test } from 'node:test';

import sharp from 'sharp';

import { removeMagentaBackground, resizeBase64Image } from './postprocess';

test('removeMagentaBackground only clears magenta connected to the border', async () => {
  const width = 5;
  const height = 5;
  const channels = 4;
  const pixels = Buffer.alloc(width * height * channels);

  for (let i = 0; i < width * height; i++) {
    const offset = i * channels;
    pixels[offset] = 255;
    pixels[offset + 1] = 0;
    pixels[offset + 2] = 255;
    pixels[offset + 3] = 255;
  }

  for (let y = 1; y <= 3; y++) {
    for (let x = 1; x <= 3; x++) {
      const offset = (y * width + x) * channels;
      pixels[offset] = 0;
      pixels[offset + 1] = 0;
      pixels[offset + 2] = 0;
    }
  }

  const center = (2 * width + 2) * channels;
  pixels[center] = 255;
  pixels[center + 1] = 0;
  pixels[center + 2] = 255;

  const input = await sharp(pixels, { raw: { width, height, channels } })
    .png()
    .toBuffer();
  const cleaned = await removeMagentaBackground(input.toString('base64'));
  const { data } = await sharp(Buffer.from(cleaned, 'base64'))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const borderAlpha = data[3];
  const centerAlpha = data[center + 3];
  const ringAlpha = data[(1 * width + 1) * channels + 3];

  assert.equal(borderAlpha, 0);
  assert.equal(centerAlpha, 255);
  assert.equal(ringAlpha, 255);
});

test('resizeBase64Image rescales images to the requested dimensions', async () => {
  const input = await sharp({
    create: {
      width: 8,
      height: 6,
      channels: 4,
      background: { r: 10, g: 20, b: 30, alpha: 1 },
    },
  })
    .png()
    .toBuffer();

  const resized = await resizeBase64Image(input.toString('base64'), 5, 7);
  const meta = await sharp(Buffer.from(resized, 'base64')).metadata();

  assert.equal(meta.width, 5);
  assert.equal(meta.height, 7);
});
