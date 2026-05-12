import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { GptImageAdapter } from './gptImageAdapter';
import { GptImageResponsesAdapter } from './gptImageResponsesAdapter';
import { getImageGenAdapter, resetImageGenAdapter } from './index';
import { resetResolverCache } from './auth/resolver';

async function withEnv<T>(
  overrides: Record<string, string | undefined>,
  fn: () => Promise<T>,
): Promise<T> {
  const original: Record<string, string | undefined> = {};
  for (const key of Object.keys(overrides)) original[key] = process.env[key];
  try {
    for (const [key, val] of Object.entries(overrides)) {
      if (val === undefined) delete process.env[key];
      else process.env[key] = val;
    }
    resetResolverCache();
    resetImageGenAdapter();
    return await fn();
  } finally {
    for (const key of Object.keys(overrides)) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
    resetResolverCache();
    resetImageGenAdapter();
  }
}

async function withTempCodexHome<T>(
  files: Record<string, string>,
  fn: (home: string) => Promise<T>,
): Promise<T> {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'sb-img-index-'));
  try {
    for (const [name, contents] of Object.entries(files)) {
      await fs.writeFile(path.join(home, name), contents, 'utf8');
    }
    return await fn(home);
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
}

test('unknown IMAGE_GEN_API_PROVIDER throws immediately', async () => {
  await withEnv(
    {
      IMAGE_GEN_API_PROVIDER: 'not-a-provider',
      IMAGE_GEN_AUTH_MODE: undefined,
      OPENAI_API_KEY: undefined,
    },
    async () => {
      await assert.rejects(
        () => getImageGenAdapter(),
        /Unknown IMAGE_GEN_API_PROVIDER/,
      );
    },
  );
});

test('codex-key relay with wire_api=responses selects the responses adapter', async () => {
  await withTempCodexHome(
    {
      'auth.json': JSON.stringify({ OPENAI_API_KEY: 'sk-codex-key' }),
      'config.toml':
        'model_provider = "relay"\n[model_providers.relay]\nbase_url = "https://relay.example.com/v1"\nwire_api = "responses"\n',
    },
    async (home) => {
      await withEnv(
        {
          IMAGE_GEN_API_PROVIDER: undefined,
          IMAGE_GEN_AUTH_MODE: 'codex-key',
          OPENAI_API_KEY: undefined,
          OPENAI_BASE_URL: undefined,
          OPENAI_RESPONSES_IMAGE_MODE: undefined,
          CODEX_HOME: home,
        },
        async () => {
          const adapter = await getImageGenAdapter();
          assert.ok(adapter instanceof GptImageResponsesAdapter);
        },
      );
    },
  );
});

test('explicit gpt-image provider overrides relay wire_api=responses', async () => {
  await withTempCodexHome(
    {
      'auth.json': JSON.stringify({ OPENAI_API_KEY: 'sk-codex-key' }),
      'config.toml':
        'model_provider = "relay"\n[model_providers.relay]\nbase_url = "https://relay.example.com/v1"\nwire_api = "responses"\n',
    },
    async (home) => {
      await withEnv(
        {
          IMAGE_GEN_API_PROVIDER: 'gpt-image',
          IMAGE_GEN_AUTH_MODE: 'codex-key',
          OPENAI_API_KEY: undefined,
          OPENAI_BASE_URL: undefined,
          OPENAI_RESPONSES_IMAGE_MODE: undefined,
          CODEX_HOME: home,
        },
        async () => {
          const adapter = await getImageGenAdapter();
          assert.ok(adapter instanceof GptImageAdapter);
        },
      );
    },
  );
});
