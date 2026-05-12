// Factory that returns the configured ImageGenAdapter.
//
// Two orthogonal env vars drive selection:
//
//   IMAGE_GEN_API_PROVIDER (legacy, optional)
//     gpt-image           → GptImageAdapter via api-key credentials
//     gpt-image-responses → GptImageResponsesAdapter via api-key credentials
//     gemini              → GeminiAdapter (kept for back-compat, non-mainline)
//
//   IMAGE_GEN_AUTH_MODE (new, the forward path)
//     api-key     → env OPENAI_API_KEY + OPENAI_BASE_URL
//     codex-key   → ~/.codex/auth.json OPENAI_API_KEY field
//     codex-oauth → ~/.codex/auth.json tokens.* → chatgpt.com/backend-api/codex
//     codex-auto  → env → auth.json api-key → auth.json oauth
//
// Precedence: when IMAGE_GEN_API_PROVIDER is set to `gemini` we still use
// GeminiAdapter directly (preserves the existing non-mainline path). Otherwise
// IMAGE_GEN_AUTH_MODE drives credential resolution; legacy
// `gpt-image-responses` maps to the relay-style ResponsesAdapter.
//
// Result is memoized per computed cache key so subsequent calls reuse the same
// adapter instance.

import { GeminiAdapter } from './geminiAdapter';
import { GptImageAdapter } from './gptImageAdapter';
import { GptImageResponsesAdapter } from './gptImageResponsesAdapter';
import { CodexOAuthAdapter } from './codexOAuthAdapter';
import { resolveCredential } from './auth/resolver';
import type { AuthMode, ResolvedCredential } from './auth/types';
import type { ImageGenAdapter } from './types';

export type { GenerateRequest, EditRequest, GenResult, ImageGenAdapter } from './types';

type LegacyProvider = 'gpt-image' | 'gpt-image-responses' | 'gemini';

const cache = new Map<string, ImageGenAdapter>();

export async function getImageGenAdapter(): Promise<ImageGenAdapter> {
  const legacy = parseLegacyProvider(process.env.IMAGE_GEN_API_PROVIDER);

  if (legacy === 'gemini') {
    return getOrBuild('gemini', () => new GeminiAdapter());
  }

  const authMode = resolveAuthMode(legacy);
  const cred = await resolveCredential(authMode);

  const adapterKind = pickAdapterKind(cred, legacy);
  const cacheKey = `${authMode}|${cred.endpointBase}|${adapterKind}`;
  return getOrBuild(cacheKey, () => buildAdapter(adapterKind, cred));
}

/** Test-only: clear cached adapters (e.g. when env changes between tests). */
export function resetImageGenAdapter(): void {
  cache.clear();
}

type AdapterKind = 'gpt-image' | 'gpt-image-responses' | 'codex-oauth';

function pickAdapterKind(
  cred: ResolvedCredential,
  legacy: LegacyProvider | '',
): AdapterKind {
  if (cred.kind === 'codex-oauth') return 'codex-oauth';
  if (legacy === 'gpt-image-responses') return 'gpt-image-responses';
  if (legacy === 'gpt-image') return 'gpt-image';
  if (process.env.OPENAI_RESPONSES_IMAGE_MODE?.trim()) return 'gpt-image-responses';
  if (cred.preferredTransport === 'gpt-image-responses') return 'gpt-image-responses';
  return 'gpt-image';
}

function buildAdapter(kind: AdapterKind, cred: ResolvedCredential): ImageGenAdapter {
  switch (kind) {
    case 'gpt-image':
      return new GptImageAdapter({ credential: cred });
    case 'gpt-image-responses':
      return new GptImageResponsesAdapter({ credential: cred });
    case 'codex-oauth':
      return new CodexOAuthAdapter({ credential: cred });
  }
}

function resolveAuthMode(legacy: LegacyProvider | ''): AuthMode {
  const explicit = (process.env.IMAGE_GEN_AUTH_MODE ?? '').trim();
  if (explicit) {
    if (
      explicit === 'api-key' ||
      explicit === 'codex-key' ||
      explicit === 'codex-oauth' ||
      explicit === 'codex-auto'
    ) {
      return explicit;
    }
    throw new Error(
      `Unknown IMAGE_GEN_AUTH_MODE: ${explicit}. Expected one of api-key | codex-key | codex-oauth | codex-auto.`,
    );
  }
  // Legacy values `gpt-image` and `gpt-image-responses` both map to api-key —
  // responses vs images path is decided separately.
  if (legacy === 'gpt-image' || legacy === 'gpt-image-responses') return 'api-key';
  return 'api-key';
}

function parseLegacyProvider(raw: string | undefined): LegacyProvider | '' {
  const trimmed = (raw ?? '').trim();
  if (trimmed === '') return '';
  if (
    trimmed === 'gpt-image' ||
    trimmed === 'gpt-image-responses' ||
    trimmed === 'gemini'
  ) {
    return trimmed;
  }
  throw new Error(
    `Unknown IMAGE_GEN_API_PROVIDER: ${trimmed}. Expected one of gpt-image | gpt-image-responses | gemini.`,
  );
}

function getOrBuild(key: string, build: () => ImageGenAdapter): ImageGenAdapter {
  const cached = cache.get(key);
  if (cached) return cached;
  const adapter = build();
  cache.set(key, adapter);
  return adapter;
}
