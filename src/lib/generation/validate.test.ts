import assert from 'node:assert/strict';
import { test } from 'node:test';

import { validateCreateBody } from './validate';

test('validateCreateBody accepts omitted style and falls back to the default style', () => {
  assert.equal(
    validateCreateBody({
      prompt: 'ice wizard',
      width: 64,
      height: 64,
    }),
    null,
  );
});

test('validateCreateBody still applies resolution checks when style is omitted', () => {
  assert.equal(
    validateCreateBody({
      prompt: 'ice wizard',
      width: 512,
      height: 512,
    }),
    'Width must be between 16 and 256. Got 512.',
  );
});

test('validateCreateBody resolves style ids before checking resolution limits', () => {
  assert.equal(
    validateCreateBody({
      prompt: 'ice wizard',
      style: 'character-pro',
      width: 32,
      height: 32,
    }),
    'Width must be between 64 and 256. Got 32.',
  );
});
