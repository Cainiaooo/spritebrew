import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { GENERATION_STYLES } from './styleRegistry';

test('every generation style exposes example artwork in public/', () => {
  const missingExamples = GENERATION_STYLES
    .filter((style) => !style.examplePaths?.length)
    .map((style) => style.id);

  assert.deepEqual(missingExamples, []);

  const missingFiles = GENERATION_STYLES.flatMap((style) =>
    (style.examplePaths ?? [])
      .filter((examplePath) => !existsSync(path.join(process.cwd(), 'public', examplePath.replace(/^\//, ''))))
      .map((examplePath) => `${style.id}:${examplePath}`)
  );

  assert.deepEqual(missingFiles, []);
});
