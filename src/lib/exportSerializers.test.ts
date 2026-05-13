import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildGodotAnimationEntries,
  buildUnityAnimationClip,
  buildUnitySpriteMeta,
  createUnityGuid,
} from './exportSerializers';

test('buildGodotAnimationEntries uses relative frame durations', () => {
  const result = buildGodotAnimationEntries(
    [{ name: 'walk', startIdx: 4, count: 2, fps: 8, loop: true }],
    (frameIndex) => `SubResource("atlas_${frameIndex}")`,
  );

  assert.match(result, /"duration": 1\.0000/);
  assert.doesNotMatch(result, /0\.1250/);
  assert.match(result, /"speed": 8\.0/);
});

test('createUnityGuid is stable and 32 hex chars', () => {
  const guid = createUnityGuid('sheet:0');

  assert.equal(guid, createUnityGuid('sheet:0'));
  assert.match(guid, /^[0-9a-f]{32}$/);
});

test('buildUnityAnimationClip emits object reference curves with real guids', () => {
  const guidA = createUnityGuid('sheet:0');
  const guidB = createUnityGuid('sheet:1');
  const clip = buildUnityAnimationClip({
    clipName: 'walk',
    fps: 8,
    loop: true,
    frameGuids: [guidA, guidB],
  });

  assert.match(clip, /m_PPtrCurves:/);
  assert.match(clip, new RegExp(`guid: ${guidA}`));
  assert.match(clip, new RegExp(`guid: ${guidB}`));
  assert.doesNotMatch(clip, /guid: 0/);
  assert.doesNotMatch(clip, /spriteReference:/);
  assert.doesNotMatch(clip, /m_EditorCurves:\n\s+- curve:/);
});

test('buildUnitySpriteMeta marks frames as sprite textures', () => {
  const guid = createUnityGuid('sheet:0');
  const meta = buildUnitySpriteMeta(guid);

  assert.match(meta, new RegExp(`guid: ${guid}`));
  assert.match(meta, /TextureImporter:/);
  assert.match(meta, /spriteMode: 1/);
  assert.match(meta, /alphaIsTransparency: 1/);
});
