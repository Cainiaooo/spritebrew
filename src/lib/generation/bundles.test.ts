import assert from 'node:assert/strict';
import { test } from 'node:test';

import { BUNDLE_PRESETS } from './bundles';
import { VALID_ACTIONS } from './validate';

test('combat and character_full bundle animations only use supported action ids', () => {
  for (const type of ['combat', 'character_full'] as const) {
    for (const step of BUNDLE_PRESETS[type]) {
      if (step.type !== 'animate') continue;
      assert.ok(step.action, `${type}:${step.name} is missing an action id`);
      assert.ok(
        (VALID_ACTIONS as readonly string[]).includes(step.action),
        `${type}:${step.name} uses unsupported action ${step.action}`,
      );
    }
  }
});

test('spell bundle emits cast animation plus projectile and impact sprites', () => {
  const emitted = BUNDLE_PRESETS.spell.filter((step) => step.emit !== false);

  assert.equal(BUNDLE_PRESETS.spell[0]?.type, 'generate');
  assert.equal(BUNDLE_PRESETS.spell[0]?.emit, false);
  assert.deepEqual(
    emitted.map((step) => ({ name: step.name, type: step.type })),
    [
      { name: 'cast', type: 'animate' },
      { name: 'projectile', type: 'generate' },
      { name: 'impact', type: 'generate' },
    ],
  );
});
