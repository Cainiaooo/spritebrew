// Tests for the minimal config.toml parser used for codex-key / codex-auto
// base_url resolution.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  parseConfigToml,
  readConfigToml,
  resolveCodexBaseUrl,
  resolveCodexProviderConfig,
} from './codexConfigToml';

test('parses top-level model_provider', () => {
  const cfg = parseConfigToml(`model_provider = "openai"\n`);
  assert.equal(cfg.modelProvider, 'openai');
  assert.deepEqual(cfg.providers, {});
});

test('parses [model_providers.<name>] table with base_url', () => {
  const cfg = parseConfigToml(
    [
      'model_provider = "my-relay"',
      '',
      '[model_providers.openai]',
      'name = "OpenAI"',
      'base_url = "https://api.openai.com/v1"',
      'env_key = "OPENAI_API_KEY"',
      '',
      '[model_providers.my-relay]',
      'base_url = "https://relay.example.com/v1"',
      '',
    ].join('\n'),
  );
  assert.equal(cfg.modelProvider, 'my-relay');
  assert.equal(cfg.providers['openai']?.baseUrl, 'https://api.openai.com/v1');
  assert.equal(cfg.providers['my-relay']?.baseUrl, 'https://relay.example.com/v1');
});

test('parses provider wire_api when present', () => {
  const cfg = parseConfigToml(
    [
      'model_provider = "relay"',
      '[model_providers.relay]',
      'base_url = "https://relay.example.com/v1"',
      'wire_api = "responses"',
    ].join('\n'),
  );
  assert.equal(cfg.providers['relay']?.wireApi, 'responses');
});

test('ignores comments and blank lines', () => {
  const cfg = parseConfigToml(
    [
      '# leading comment',
      '',
      'model_provider = "openai"  # inline comment with "quoted #" mark',
      '',
      '[model_providers.openai]',
      '# table comment',
      'base_url = "https://api.openai.com/v1"',
    ].join('\n'),
  );
  assert.equal(cfg.modelProvider, 'openai');
  assert.equal(cfg.providers['openai']?.baseUrl, 'https://api.openai.com/v1');
});

test('preserves # inside a quoted string value', () => {
  const cfg = parseConfigToml(
    [
      '[model_providers.hashy]',
      'base_url = "https://example.com/path#fragment"',
    ].join('\n'),
  );
  assert.equal(cfg.providers['hashy']?.baseUrl, 'https://example.com/path#fragment');
});

test('handles basic-string escape sequences', () => {
  const cfg = parseConfigToml(
    [
      '[model_providers.esc]',
      'base_url = "https://example.com/\\"quoted\\"/path"',
    ].join('\n'),
  );
  assert.equal(cfg.providers['esc']?.baseUrl, 'https://example.com/"quoted"/path');
});

test('silently drops arrays and inline tables (out of scope)', () => {
  const cfg = parseConfigToml(
    [
      'profiles = ["a", "b"]',
      'nested = { x = 1 }',
      '[model_providers.openai]',
      'base_url = "https://api.openai.com/v1"',
    ].join('\n'),
  );
  assert.equal(cfg.modelProvider, undefined);
  assert.equal(cfg.providers['openai']?.baseUrl, 'https://api.openai.com/v1');
});

test('readConfigToml returns null when file is missing', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'sb-codex-cfg-'));
  try {
    const cfg = await readConfigToml(tmp);
    assert.equal(cfg, null);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test('resolveCodexBaseUrl returns undefined when provider has no base_url', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'sb-codex-cfg-'));
  try {
    await fs.writeFile(
      path.join(tmp, 'config.toml'),
      'model_provider = "openai"\n[model_providers.openai]\nname = "OpenAI"\n',
      'utf8',
    );
    const base = await resolveCodexBaseUrl(tmp);
    assert.equal(base, undefined);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test('resolveCodexBaseUrl returns active provider base_url', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'sb-codex-cfg-'));
  try {
    await fs.writeFile(
      path.join(tmp, 'config.toml'),
      [
        'model_provider = "relay"',
        '[model_providers.openai]',
        'base_url = "https://api.openai.com/v1"',
        '[model_providers.relay]',
        'base_url = "https://relay.example.com/v1"',
        '',
      ].join('\n'),
      'utf8',
    );
    const base = await resolveCodexBaseUrl(tmp);
    assert.equal(base, 'https://relay.example.com/v1');
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test('resolveCodexProviderConfig returns active provider base_url and wire_api', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'sb-codex-cfg-'));
  try {
    await fs.writeFile(
      path.join(tmp, 'config.toml'),
      [
        'model_provider = "relay"',
        '[model_providers.relay]',
        'base_url = "https://relay.example.com/v1"',
        'wire_api = "responses"',
        '',
      ].join('\n'),
      'utf8',
    );
    const provider = await resolveCodexProviderConfig(tmp);
    assert.equal(provider?.baseUrl, 'https://relay.example.com/v1');
    assert.equal(provider?.wireApi, 'responses');
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test('resolveCodexBaseUrl returns undefined when model_provider is missing', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'sb-codex-cfg-'));
  try {
    await fs.writeFile(
      path.join(tmp, 'config.toml'),
      '[model_providers.openai]\nbase_url = "https://api.openai.com/v1"\n',
      'utf8',
    );
    const base = await resolveCodexBaseUrl(tmp);
    assert.equal(base, undefined);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
