// Tests for resolveCredential — covers mode → credential mapping via real
// temp CODEX_HOME directories so we exercise codexAuthFile + codexConfigToml
// paths. No network; we only inspect ResolvedCredential shape.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { resolveCredential, resetResolverCache } from './resolver';
import { CredentialResolutionError } from './types';

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
    return await fn();
  } finally {
    for (const key of Object.keys(overrides)) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
    resetResolverCache();
  }
}

async function withTempCodexHome<T>(
  files: Record<string, string>,
  fn: (home: string) => Promise<T>,
): Promise<T> {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'sb-codex-home-'));
  try {
    for (const [name, contents] of Object.entries(files)) {
      await fs.writeFile(path.join(home, name), contents, 'utf8');
    }
    return await fn(home);
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
}

test('api-key mode throws when OPENAI_API_KEY is unset', async () => {
  await withEnv(
    { OPENAI_API_KEY: undefined, OPENAI_BASE_URL: undefined },
    async () => {
      await assert.rejects(
        () => resolveCredential('api-key'),
        (err: unknown) => {
          assert.ok(err instanceof CredentialResolutionError);
          assert.equal((err as CredentialResolutionError).mode, 'api-key');
          return true;
        },
      );
    },
  );
});

test('api-key mode returns static credential with env base_url', async () => {
  await withEnv(
    {
      OPENAI_API_KEY: 'sk-test',
      OPENAI_BASE_URL: 'https://api.openai.com/',
    },
    async () => {
      const cred = await resolveCredential('api-key');
      assert.equal(cred.kind, 'static');
      assert.equal(cred.bearer, 'sk-test');
      assert.equal(cred.endpointBase, 'https://api.openai.com');
      assert.equal(cred.resolvedFrom, 'api-key');
    },
  );
});

test('api-key mode ignores ~/.codex/config.toml by design', async () => {
  await withTempCodexHome(
    {
      'config.toml':
        'model_provider = "relay"\n[model_providers.relay]\nbase_url = "https://relay.example.com/v1"\n',
    },
    async (home) => {
      await withEnv(
        {
          OPENAI_API_KEY: 'sk-test',
          OPENAI_BASE_URL: 'https://env-wins.example.com',
          CODEX_HOME: home,
        },
        async () => {
          const cred = await resolveCredential('api-key');
          assert.equal(cred.endpointBase, 'https://env-wins.example.com');
        },
      );
    },
  );
});

test('codex-key picks up base_url from config.toml when env is unset', async () => {
  await withTempCodexHome(
    {
      'auth.json': JSON.stringify({ OPENAI_API_KEY: 'sk-codex-key' }),
      'config.toml':
        'model_provider = "relay"\n[model_providers.relay]\nbase_url = "https://relay.example.com/v1"\n',
    },
    async (home) => {
      await withEnv(
        {
          OPENAI_API_KEY: undefined,
          OPENAI_BASE_URL: undefined,
          CODEX_HOME: home,
        },
        async () => {
          const cred = await resolveCredential('codex-key');
          assert.equal(cred.kind, 'static');
          assert.equal(cred.bearer, 'sk-codex-key');
          // `/v1` is peeled so adapters' ${base}/v1/images/... path is correct.
          assert.equal(cred.endpointBase, 'https://relay.example.com');
          assert.equal(cred.preferredTransport, undefined);
          assert.equal(cred.resolvedFrom, 'codex-key');
        },
      );
    },
  );
});

test('codex-key carries responses transport hint from config.toml wire_api', async () => {
  await withTempCodexHome(
    {
      'auth.json': JSON.stringify({ OPENAI_API_KEY: 'sk-codex-key' }),
      'config.toml':
        'model_provider = "relay"\n[model_providers.relay]\nbase_url = "https://relay.example.com/v1"\nwire_api = "responses"\n',
    },
    async (home) => {
      await withEnv(
        {
          OPENAI_API_KEY: undefined,
          OPENAI_BASE_URL: undefined,
          CODEX_HOME: home,
        },
        async () => {
          const cred = await resolveCredential('codex-key');
          assert.equal(cred.endpointBase, 'https://relay.example.com');
          assert.equal(cred.preferredTransport, 'gpt-image-responses');
        },
      );
    },
  );
});

test('codex-key respects OPENAI_BASE_URL over config.toml when both are set', async () => {
  await withTempCodexHome(
    {
      'auth.json': JSON.stringify({ OPENAI_API_KEY: 'sk-codex-key' }),
      'config.toml':
        'model_provider = "codex"\n[model_providers.codex]\nbase_url = "https://from-codex-config.example.com/v1"\n',
    },
    async (home) => {
      await withEnv(
        {
          OPENAI_API_KEY: undefined,
          OPENAI_BASE_URL: 'https://env-override.example.com',
          CODEX_HOME: home,
        },
        async () => {
          const cred = await resolveCredential('codex-key');
          assert.equal(cred.endpointBase, 'https://env-override.example.com');
        },
      );
    },
  );
});

test('codex-key falls back to default api.openai.com when neither env nor config is set', async () => {
  await withTempCodexHome(
    { 'auth.json': JSON.stringify({ OPENAI_API_KEY: 'sk-codex-key' }) },
    async (home) => {
      await withEnv(
        {
          OPENAI_API_KEY: undefined,
          OPENAI_BASE_URL: undefined,
          CODEX_HOME: home,
        },
        async () => {
          const cred = await resolveCredential('codex-key');
          assert.equal(cred.endpointBase, 'https://api.openai.com');
        },
      );
    },
  );
});

test('codex-key throws when auth.json has no OPENAI_API_KEY field', async () => {
  await withTempCodexHome(
    { 'auth.json': JSON.stringify({ tokens: {} }) },
    async (home) => {
      await withEnv(
        { OPENAI_API_KEY: undefined, CODEX_HOME: home },
        async () => {
          await assert.rejects(
            () => resolveCredential('codex-key'),
            (err: unknown) => {
              assert.ok(err instanceof CredentialResolutionError);
              assert.equal((err as CredentialResolutionError).mode, 'codex-key');
              return true;
            },
          );
        },
      );
    },
  );
});

test('codex-auto env path does not consult config.toml', async () => {
  await withTempCodexHome(
    {
      'config.toml':
        'model_provider = "relay"\n[model_providers.relay]\nbase_url = "https://relay.example.com/v1"\n',
    },
    async (home) => {
      await withEnv(
        {
          OPENAI_API_KEY: 'sk-env',
          OPENAI_BASE_URL: undefined,
          CODEX_HOME: home,
        },
        async () => {
          const cred = await resolveCredential('codex-auto');
          assert.equal(cred.kind, 'static');
          assert.equal(cred.bearer, 'sk-env');
          // No env OPENAI_BASE_URL, no consult of codex config → default.
          assert.equal(cred.endpointBase, 'https://api.openai.com');
          assert.equal(cred.resolvedFrom, 'codex-auto');
        },
      );
    },
  );
});

test('codex-auto falls back to auth.json api-key + config.toml base_url', async () => {
  await withTempCodexHome(
    {
      'auth.json': JSON.stringify({ OPENAI_API_KEY: 'sk-from-auth-json' }),
      'config.toml':
        'model_provider = "relay"\n[model_providers.relay]\nbase_url = "https://relay.example.com/v1"\n',
    },
    async (home) => {
      await withEnv(
        {
          OPENAI_API_KEY: undefined,
          OPENAI_BASE_URL: undefined,
          CODEX_HOME: home,
        },
        async () => {
          const cred = await resolveCredential('codex-auto');
          assert.equal(cred.kind, 'static');
          assert.equal(cred.bearer, 'sk-from-auth-json');
          assert.equal(cred.endpointBase, 'https://relay.example.com');
          assert.equal(cred.preferredTransport, undefined);
        },
      );
    },
  );
});

test('codex-auto auth.json api-key path carries responses transport hint from config.toml', async () => {
  await withTempCodexHome(
    {
      'auth.json': JSON.stringify({ OPENAI_API_KEY: 'sk-from-auth-json' }),
      'config.toml':
        'model_provider = "relay"\n[model_providers.relay]\nbase_url = "https://relay.example.com/v1"\nwire_api = "responses"\n',
    },
    async (home) => {
      await withEnv(
        {
          OPENAI_API_KEY: undefined,
          OPENAI_BASE_URL: undefined,
          CODEX_HOME: home,
        },
        async () => {
          const cred = await resolveCredential('codex-auto');
          assert.equal(cred.endpointBase, 'https://relay.example.com');
          assert.equal(cred.preferredTransport, 'gpt-image-responses');
        },
      );
    },
  );
});

test('codex-auto falls through to OAuth when only tokens are present', async () => {
  // We can construct a structurally-valid auth.json with tokens; the
  // resolver returns an oauth credential (fetchBearer lazily refreshes —
  // we don't invoke it here).
  await withTempCodexHome(
    {
      'auth.json': JSON.stringify({
        tokens: { access_token: 'ac', refresh_token: 'rf' },
      }),
    },
    async (home) => {
      await withEnv(
        {
          OPENAI_API_KEY: undefined,
          OPENAI_BASE_URL: undefined,
          CODEX_HOME: home,
        },
        async () => {
          const cred = await resolveCredential('codex-auto');
          assert.equal(cred.kind, 'codex-oauth');
          assert.equal(cred.endpointBase, 'https://chatgpt.com/backend-api/codex');
          assert.equal(cred.extraHeaders?.Originator, 'codex-tui');
          assert.equal(typeof cred.fetchBearer, 'function');
          assert.equal(cred.bearer, undefined);
        },
      );
    },
  );
});

test('codex-auto throws when env is unset and auth.json has neither key nor tokens', async () => {
  await withTempCodexHome(
    { 'auth.json': JSON.stringify({}) },
    async (home) => {
      await withEnv(
        { OPENAI_API_KEY: undefined, CODEX_HOME: home },
        async () => {
          await assert.rejects(
            () => resolveCredential('codex-auto'),
            (err: unknown) => {
              assert.ok(err instanceof CredentialResolutionError);
              assert.equal((err as CredentialResolutionError).mode, 'codex-auto');
              return true;
            },
          );
        },
      );
    },
  );
});

test('codex-oauth throws when auth.json is missing entirely', async () => {
  await withTempCodexHome({}, async (home) => {
    await withEnv(
      { OPENAI_API_KEY: undefined, CODEX_HOME: home },
      async () => {
        await assert.rejects(
          () => resolveCredential('codex-oauth'),
          (err: unknown) => {
            assert.ok(err instanceof CredentialResolutionError);
            assert.equal((err as CredentialResolutionError).mode, 'codex-oauth');
            return true;
          },
        );
      },
    );
  });
});

test('unknown mode throws CredentialResolutionError with descriptive message', async () => {
  await assert.rejects(
    // deliberately bad input to exercise the default case
    () => resolveCredential('not-a-mode' as never),
    (err: unknown) => {
      assert.ok(err instanceof CredentialResolutionError);
      assert.match((err as Error).message, /Unknown/);
      return true;
    },
  );
});
